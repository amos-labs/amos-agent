import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentLoop,
  gatherReasoningEffortForModel,
  shouldUseGatherReasoning
} from "../src/agentLoop.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { attachModelEvidence } from "../src/model/evidence.js";

test("usage events keep OpenAI-compatible prompt and completion token names", async () => {
  const events = [];
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        return {
          message: { role: "assistant", content: "done" },
          usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 }
        };
      }
    }
  });
  await loop.run("count tokens", { onEvent: (event) => events.push(event) });
  const usage = events.find((event) => event.type === "usage");
  assert.equal(usage.inputTokens, 80);
  assert.equal(usage.outputTokens, 40);
  assert.equal(usage.totalTokens, 120);
});

test("local prompt budget learns toward the configured prefill latency target", () => {
  const loop = new AgentLoop({
    config: {
      agent: { localPromptTargetMs: 60_000 },
      model: { deployment: "local", contextTokens: 32_768 }
    },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: { chat: async () => ({ message: { role: "assistant", content: "done" } }) }
  });

  assert.equal(loop.preferredInputTokenBudget(), 8_192);
  loop.observeLocalPromptPerformance({ input_tokens: 100, prompt_eval_ms: 1_000 });
  assert.equal(loop.preferredInputTokenBudget(), 6_000);
  loop.clear();
  assert.equal(loop.preferredInputTokenBudget(), 8_192);
});

test("role handoff waits until after the current tool result", async () => {
  const registry = new ToolRegistry();
  const seen = [];
  registry.register({
    name: "desktop_handoff_role",
    handler: async () => {
      loop.queueHandoff({
        role: "implementer",
        provider: "xai",
        model: "grok-4.6",
        message: "<amos_role_handoff role=\"implementer\">build</amos_role_handoff>"
      });
      return { ok: true, queued: true, role: "implementer" };
    }
  });
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        seen.push(messages.map((message) => message.role));
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "handoff-1",
                function: { name: "desktop_handoff_role", arguments: "{\"role\":\"implementer\"}" }
              }]
            }
          };
        }
        const roles = messages.map((message) => message.role);
        const toolIndex = roles.lastIndexOf("tool");
        const handoffIndex = messages.findIndex((message) =>
          String(message.content || "").includes("<amos_role_handoff")
        );
        assert.ok(toolIndex >= 0);
        assert.ok(handoffIndex > toolIndex);
        return { message: { role: "assistant", content: "building" } };
      }
    }
  });
  assert.equal(await loop.run("plan then implement"), "building");
  assert.equal(seen.length, 2);
});

test("a completion gate prevents a coding role from silently ending", async () => {
  const seen = [];
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        seen.push(messages);
        return {
          message: {
            role: "assistant",
            content: turn === 1 ? "I will skip the checker because time is short." : "Structured stage recorded."
          }
        };
      }
    }
  });
  const answer = await loop.run("implement this", {
    completionGate: () => turn === 1
      ? {
          allow: false,
          message: "Call desktop_report_coding_stage; checking cannot be skipped.",
          state: { role: "implementer", status: "running" }
        }
      : { allow: true }
  });
  assert.equal(answer, "Structured stage recorded.");
  assert.equal(seen.length, 2);
  assert.ok(seen[1].some((message) =>
    String(message.content || "").includes("checking cannot be skipped")
  ));
});

test("each coding role gets a fresh structured-result retry after a valid stage transition", async () => {
  const registry = new ToolRegistry();
  let role = "planner";
  let terminal = false;
  registry.register({
    name: "desktop_report_coding_stage",
    handler: async ({ outcome }) => {
      if (outcome === "plan_ready") role = "implementer";
      if (outcome === "implementation_ready") role = "checker";
      if (outcome === "approved") terminal = true;
      return { ok: true, outcome, role, terminal };
    }
  });
  let turn = 0;
  const responses = [
    { role: "assistant", content: "Plan finished without a stage result." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "stage-plan",
        function: {
          name: "desktop_report_coding_stage",
          arguments: JSON.stringify({ outcome: "plan_ready" })
        }
      }]
    },
    { role: "assistant", content: "Implementation finished without a stage result." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "stage-build",
        function: {
          name: "desktop_report_coding_stage",
          arguments: JSON.stringify({ outcome: "implementation_ready" })
        }
      }]
    },
    { role: "assistant", content: "Check finished without a stage result." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "stage-check",
        function: {
          name: "desktop_report_coding_stage",
          arguments: JSON.stringify({ outcome: "approved" })
        }
      }]
    },
    { role: "assistant", content: "Verified and complete." }
  ];
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        return { message: responses[turn++] };
      }
    }
  });

  const answer = await loop.run("plan, implement, and check", {
    completionGate: () => terminal
      ? { allow: true }
      : {
          allow: false,
          message: `Report the ${role} stage.`,
          state: { role, status: "running" }
        }
  });
  assert.equal(answer, "Verified and complete.");
  assert.equal(turn, 7);
});

test("malformed tool JSON from any model is corrected and never executes", async () => {
  let calls = 0;
  let turn = 0;
  const requests = [];
  const events = [];
  const registry = new ToolRegistry();
  registry.register({ name: "danger", handler: () => { calls += 1; } });
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat(input) {
        requests.push(input);
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "call-1", function: { name: "danger", arguments: "{" } }]
            }
          };
        }
        return { message: { role: "assistant", content: "recovered" } };
      }
    }
  });

  assert.equal(await loop.run("test", { onEvent: (event) => events.push(event) }), "recovered");
  assert.equal(calls, 0);
  assert.equal(turn, 2);
  assert.ok(requests[1].messages.some((message) =>
    String(message.content || "").includes("<amos_tool_call_correction>") &&
    String(message.content || "").includes("No tool from that invalid response executed")
  ));
  assert.ok(events.some((event) =>
    event.type === "phase" && event.phase === "retrying" && /invalid tool arguments/i.test(event.summary)
  ));
});

test("alternating capability catalog calls stop when they add no usable operation", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "amos_list_engines",
    handler: async () => ({ ok: true, engines: ["growth"] })
  });
  registry.register({
    name: "amos_load_engine_tools",
    handler: async () => ({ ok: true, tools: [], note: "nothing new" })
  });
  const requests = [];
  let turn = 0;
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3,
        maxCapabilityDiscoveryCycles: 3
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat(input) {
        requests.push(input);
        turn += 1;
        if (turn <= 3) {
          const name = turn % 2 === 1 ? "amos_list_engines" : "amos_load_engine_tools";
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: `catalog-${turn}`,
                function: {
                  name,
                  arguments: name === "amos_load_engine_tools"
                    ? "{\"engine\":\"growth\",\"toolkit\":\"admin\"}"
                    : "{}"
                }
              }]
            }
          };
        }
        assert.deepEqual(input.tools, []);
        assert.ok(input.messages.some((message) =>
          /capability discovery repeated without adding a usable operation/.test(String(message.content || ""))
        ));
        return { message: { role: "assistant", content: "I could not find a usable operation." } };
      }
    }
  });

  assert.equal(
    await loop.run("create a mission without looping through catalogs"),
    "I could not find a usable operation."
  );
  assert.equal(requests.length, 4);
});

test("a successful state-changing tool resets the capability discovery streak", async () => {
  const registry = new ToolRegistry();
  let modelCalls = 0;
  let discoveryCalls = 0;
  let writes = 0;
  registry.register({
    name: "amos_list_engines",
    readOnly: true,
    handler: async () => {
      discoveryCalls += 1;
      return { ok: true, engines: ["missions"] };
    }
  });
  registry.register({
    name: "create_record",
    readOnly: false,
    handler: async () => {
      writes += 1;
      return { ok: true, record_id: `record-${writes}` };
    }
  });
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 5,
        maxConsecutiveToolErrorCycles: 3,
        maxCapabilityDiscoveryCycles: 2
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools }) {
        modelCalls += 1;
        const sequence = [
          "amos_list_engines",
          "create_record",
          "amos_list_engines",
          "create_record"
        ];
        const name = sequence[modelCalls - 1];
        if (name) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: `call-${modelCalls}`,
                function: { name, arguments: "{}" }
              }]
            }
          };
        }
        assert.ok(tools.length > 0);
        return { message: { role: "assistant", content: "Finished after two phases." } };
      }
    }
  });

  assert.equal(await loop.run("discover, write, then continue"), "Finished after two phases.");
  assert.equal(discoveryCalls, 2);
  assert.equal(writes, 2);
  assert.equal(modelCalls, 5);
});

test("an output-limited model response is explained and retried automatically", async () => {
  const requests = [];
  const loop = new AgentLoop({
    config: { agent: { maxModelTransientRetries: 1 } },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat(input) {
        requests.push(input);
        if (requests.length === 1) {
          const error = new Error("OpenAI response was incomplete");
          error.code = "AMOS_MODEL_INCOMPLETE_RESPONSE";
          error.stopReason = "max_output_tokens";
          error.truncated = true;
          throw error;
        }
        return { message: { role: "assistant", content: "Recovered automatically." } };
      }
    }
  });

  assert.equal(await loop.run("Finish the task"), "Recovered automatically.");
  assert.equal(requests.length, 2);
  assert.ok(requests[1].messages.some((message) =>
    String(message.content || "").includes("<amos_model_output_correction>") &&
    String(message.content || "").includes("provider output limit was reached") &&
    String(message.content || "").includes("No tool from that incomplete response executed")
  ));
});

test("transient visual tool evidence reaches the next model turn but not public tool events", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "observe_visual",
    handler: async () => attachModelEvidence(
      { ok: true, frame_id: "frame-1", frame_sha256: "a".repeat(64) },
      [{
        type: "image_url",
        image_url: { url: "data:image/png;base64,cG5n", detail: "high" }
      }]
    )
  });
  const observed = [];
  const events = [];
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        observed.push(messages);
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "visual-1", function: { name: "observe_visual", arguments: "{}" } }]
            }
          };
        }
        const visualMessage = messages.find((message) => message.amosEphemeralEvidence === true);
        assert.ok(visualMessage);
        assert.equal(visualMessage.content.some((part) => part.type === "image_url"), true);
        return { message: { role: "assistant", content: "I inspected the transient frame." } };
      }
    }
  });
  assert.equal(await loop.run("Inspect the visual", { onEvent: (event) => events.push(event) }), "I inspected the transient frame.");
  assert.equal(JSON.stringify(events).includes("data:image/png"), false);
  assert.equal(JSON.stringify(observed[0]).includes("data:image/png"), false);
});

test("custom operating prompt survives a cleared session", () => {
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3
      }
    },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    systemPrompt: "LOCAL ONLY",
    kimiClient: { chat: async () => ({ message: { role: "assistant", content: "" } }) }
  });
  loop.messages.push({ role: "user", content: "test" });
  loop.clear();
  assert.deepEqual(loop.messages, [{ role: "system", content: "LOCAL ONLY" }]);
});

test("encrypted continuity can rehydrate an otherwise fresh loop only once", () => {
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    systemPrompt: "LOCAL ONLY",
    kimiClient: { chat: async () => ({ message: { role: "assistant", content: "" } }) }
  });
  assert.equal(loop.restoreContinuity("Previous safe milestone"), true);
  assert.deepEqual(loop.messages, [
    { role: "system", content: "LOCAL ONLY" }
  ]);
  assert.deepEqual(loop.prepareMessagesForModel(), [
    { role: "system", content: "LOCAL ONLY" }
  ]);
  assert.equal(loop.restoreContinuity("Duplicate"), false);
});

test("compiled continuity uses the same standard message contract across providers", async () => {
  for (const provider of ["openai-compatible", "kimi", "ollama"]) {
    const loop = new AgentLoop({
      config: {
        agent: {},
        model: { provider, model: `${provider}-model` }
      },
      registry: new ToolRegistry(),
      approvals: {},
      amosClient: {},
      kimiClient: {
        async chat({ messages }) {
          assert.deepEqual(messages.map((message) => message.role), [
            "system",
            "user"
          ]);
          assert.match(messages[1].content, /amos\.continuity_manifest/);
          assert.match(messages[1].content, /Continue safely/);
          assert.deepEqual(Object.keys(messages[1]).sort(), ["content", "role"]);
          return { message: { role: "assistant", content: "continued" } };
        }
      }
    });
    assert.equal(
      loop.restoreContinuity('<amos_continuity format="amos.continuity_manifest" />'),
      true
    );
    assert.equal(await loop.run("Continue safely"), "continued");
    assert.equal(loop.lastContextReceipt.provider, provider);
    assert.ok(loop.lastContextReceipt.continuityChars > 0);
  }
});

test("restored continuity keeps follow-up model transcripts user-first", async () => {
  const observed = [];
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    systemPrompt: "LOCAL ONLY",
    kimiClient: {
      async chat({ messages }) {
        observed.push(messages);
        assert.equal(messages[0].role, "system");
        assert.equal(messages[1].role, "user");
        assert.match(messages[1].content, /Previous safe milestone/);
        assert.equal(
          messages.slice(1).findIndex((message) => message.role === "user"),
          0
        );
        return { message: { role: "assistant", content: `Answer ${observed.length}` } };
      }
    }
  });

  assert.equal(loop.restoreContinuity("Previous safe milestone"), true);
  assert.equal(await loop.run("hello"), "Answer 1");
  assert.equal(await loop.run("what sort of things can you do?"), "Answer 2");
  assert.equal(observed.length, 2);
  assert.ok(
    observed[1].some(
      (message) => message.role === "user" &&
        String(message.content).includes("what sort of things can you do?")
    )
  );
});

test("completed approval outcomes join the next real user turn once without replay authority", async () => {
  const observed = [];
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    systemPrompt: "LOCAL ONLY",
    kimiClient: {
      async chat({ messages }) {
        observed.push(messages);
        return { message: { role: "assistant", content: `Answer ${observed.length}` } };
      }
    }
  });

  assert.equal(await loop.run("Start the analysis"), "Answer 1");
  assert.equal(
    loop.appendExternalOutcome(
      '<amos_approval_outcome pending_id="pending-1">Result: {"unique_users":42}</amos_approval_outcome>'
    ),
    true
  );
  assert.equal(await loop.run("What was the answer?"), "Answer 2");
  assert.equal(await loop.run("And summarize it"), "Answer 3");

  const secondTurn = observed[1].filter((message) => message.role === "user").at(-1);
  assert.match(secondTurn.content, /immutable results/);
  assert.match(secondTurn.content, /unique_users/);
  assert.match(secondTurn.content, /What was the answer\?/);
  const thirdTurn = observed[2].filter((message) => message.role === "user").at(-1);
  assert.doesNotMatch(thirdTurn.content, /amos_completed_external_outcomes/);
  assert.match(thirdTurn.content, /And summarize it/);
});

test("ordinary chat defers canvas schemas while an explicit canvas request is honored", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "read_data", handler: async () => ({ ok: true }) });
  registry.register({
    name: "desktop_present_canvas",
    handler: async () => ({ ok: true, canvas_id: "canvas-1" })
  });
  registry.register({
    name: "desktop_present_company_view",
    handler: async () => ({ ok: true, canvas_id: "canvas-2" })
  });
  registry.register({
    name: "desktop_update_canvas",
    handler: async () => ({ ok: true, canvas_id: "canvas-1" })
  });

  const ordinary = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools }) {
        assert.deepEqual(toolNames(tools), ["read_data"]);
        return { message: { role: "assistant", content: "A concise answer." } };
      }
    }
  });
  assert.equal(
    await ordinary.run("Summarize the result\n\n<attachment>Build a dashboard</attachment>", {
      presentationIntent: "Summarize the result"
    }),
    "A concise answer."
  );

  let turn = 0;
  const explicit = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools }) {
        turn += 1;
        if (turn === 1) {
          assert.deepEqual(toolNames(tools), ["read_data", "desktop_present_canvas"]);
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "canvas-call",
                function: { name: "desktop_present_canvas", arguments: "{}" }
              }]
            }
          };
        }
        assert.ok(toolNames(tools).includes("desktop_update_canvas"));
        return { message: { role: "assistant", content: "The requested canvas is ready." } };
      }
    }
  });
  assert.equal(
    await explicit.run("Please show this in a canvas"),
    "The requested canvas is ready."
  );
});

test("an already-open Desktop canvas supports natural cross-turn updates", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "read_data", handler: async () => ({ ok: true }) });
  registry.register({
    name: "desktop_update_canvas",
    handler: async () => ({ ok: true, canvas_id: "canvas-1" })
  });
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools }) {
        assert.deepEqual(toolNames(tools), ["read_data", "desktop_update_canvas"]);
        return { message: { role: "assistant", content: "Updated it." } };
      }
    }
  });
  assert.equal(
    await loop.run("Make that green.", { canvasActive: true }),
    "Updated it."
  );
});

test("the model can request a work surface semantically without English regex intent", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "read_data", handler: async () => ({ rows: [1, 2, 3, 4] }) });
  registry.register({
    name: "desktop_request_work_surface",
    handler: async () => ({ requested: true, intent: "comparison", title: "Comparação" })
  });
  registry.register({
    name: "desktop_present_canvas",
    handler: async () => ({ ok: true, canvas_id: "canvas-pt" })
  });
  registry.register({
    name: "desktop_present_company_view",
    handler: async () => ({ ok: true, canvas_id: "canvas-company-pt" })
  });

  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools }) {
        turn += 1;
        if (turn === 1) {
          assert.deepEqual(toolNames(tools), ["read_data", "desktop_request_work_surface"]);
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "request-surface",
                function: {
                  name: "desktop_request_work_surface",
                  arguments: JSON.stringify({
                    intent: "comparison",
                    reason: "A estrutura visual torna as diferenças materiais mais claras."
                  })
                }
              }]
            }
          };
        }
        assert.ok(toolNames(tools).includes("desktop_present_canvas"));
        assert.ok(toolNames(tools).includes("desktop_present_company_view"));
        return { message: { role: "assistant", content: "A comparação está pronta." } };
      }
    }
  });

  assert.equal(
    await loop.run("Mostre as diferenças mais importantes entre as unidades."),
    "A comparação está pronta."
  );
});

test("explicit code, app, and course preview requests reveal the canvas safely", async () => {
  for (const prompt of [
    "Show me the code in a canvas.",
    "Preview the app page.",
    "Display the generated course."
  ]) {
    const registry = new ToolRegistry();
    registry.register({ name: "read_data", handler: async () => ({ ok: true }) });
    registry.register({
      name: "desktop_present_canvas",
      handler: async () => ({ ok: true, canvas_id: "canvas-preview" })
    });
    const loop = new AgentLoop({
      config: { agent: {} },
      registry,
      approvals: {},
      amosClient: {},
      kimiClient: {
        async chat({ tools }) {
          assert.ok(toolNames(tools).includes("desktop_present_canvas"), prompt);
          return { message: { role: "assistant", content: "Preview ready." } };
        }
      }
    });
    assert.equal(await loop.run(prompt), "Preview ready.");
  }
});

test("dense captured company results progressively reveal only the deterministic view tool", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "amos_company_metrics",
    handler: async () => ({
      rows: [
        { month: "2026-01", revenue: 10 },
        { month: "2026-02", revenue: 12 },
        { month: "2026-03", revenue: 15 },
        { month: "2026-04", revenue: 18 }
      ]
    })
  });
  registry.register({ name: "desktop_present_canvas", handler: async () => ({ ok: true }) });
  registry.register({
    name: "desktop_present_company_view",
    handler: async () => ({ ok: true, canvas_id: "company-view" })
  });
  registry.register({ name: "desktop_update_canvas", handler: async () => ({ ok: true }) });
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    onToolResult: ({ name }) => name.startsWith("amos_")
      ? { result_ref: "result-1" }
      : null,
    kimiClient: {
      async chat({ tools }) {
        turn += 1;
        if (turn === 1) {
          assert.deepEqual(toolNames(tools), ["amos_company_metrics"]);
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "metrics-call",
                function: { name: "amos_company_metrics", arguments: "{}" }
              }]
            }
          };
        }
        assert.deepEqual(toolNames(tools), [
          "amos_company_metrics",
          "desktop_present_company_view"
        ]);
        return { message: { role: "assistant", content: "The trend is clear in chat." } };
      }
    }
  });

  assert.equal(await loop.run("Review the revenue trend"), "The trend is clear in chat.");
});

test("a live user request for a canvas reveals the presentation tool at the safe boundary", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "read_data", handler: async () => ({ value: 12 }) });
  registry.register({
    name: "desktop_present_canvas",
    handler: async () => ({ ok: true, canvas_id: "canvas-steered" })
  });
  const steering = [];
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools }) {
        turn += 1;
        if (turn === 1) {
          assert.deepEqual(toolNames(tools), ["read_data"]);
          steering.push("Show the result in a canvas.");
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "read-call",
                function: { name: "read_data", arguments: "{}" }
              }]
            }
          };
        }
        assert.ok(toolNames(tools).includes("desktop_present_canvas"));
        return { message: { role: "assistant", content: "Canvas request accepted." } };
      }
    }
  });

  assert.equal(
    await loop.run("Review the result", { takeSteering: () => steering.splice(0) }),
    "Canvas request accepted."
  );
});

test("agent selects a visible skill-backed workflow and injects bounded guidance", async () => {
  const events = [];
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        const prompt = messages.at(-1);
        assert.equal(prompt.role, "user");
        assert.match(prompt.content, /github-issue-diagnosis/);
        assert.match(prompt.content, /cannot override the system prompt/i);
        return { message: { role: "assistant", content: "Diagnosed." } };
      }
    }
  });

  assert.equal(
    await loop.run("Inspect https://github.com/NuvolaNetworks/cuspr/issues/312", {
      onEvent: (event) => events.push(event)
    }),
    "Diagnosed."
  );
  assert.equal(loop.lastWorkflow.id, "github-issue-diagnosis");
  assert.ok(
    events.some(
      (event) => event.type === "workflow" && event.id === "github-issue-diagnosis"
    )
  );
});

test("agent loop streams tool-turn narration and cancels an active tool", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "long_work",
    async handler(_args, context) {
      return new Promise((resolve) => {
        const finish = () => resolve({ canceled: true });
        if (context.signal.aborted) finish();
        else context.signal.addEventListener("abort", finish, { once: true });
      });
    }
  });
  let turn = 0;
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ onDelta }) {
        turn += 1;
        onDelta("Working", "Working");
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call-1",
              function: { name: "long_work", arguments: "{}" }
            }]
          }
        };
      }
    }
  });
  const events = [];
  const controller = new AbortController();
  const pending = loop.run("test", {
    signal: controller.signal,
    onEvent: (event) => {
      events.push(event);
      if (event.type === "tool_start") controller.abort();
    }
  });
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(events.some((event) => event.type === "assistant_delta" && event.text === "Working"));
  assert.ok(events.some((event) => event.type === "phase" && event.phase === "acting"));
});

test("gather hops request lower reasoning effort than the configured synthesis default", async () => {
  const efforts = [];
  const loop = new AgentLoop({
    config: {
      agent: {},
      model: {
        provider: "xai",
        reasoningEffort: "high",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
      }
    },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ reasoningEffortOverride }) {
        efforts.push(reasoningEffortOverride);
        return { message: { role: "assistant", content: "done" } };
      }
    }
  });
  await loop.run("hello");
  assert.equal(gatherReasoningEffortForModel({
    reasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
  }), "low");
  assert.equal(shouldUseGatherReasoning({
    turn: 0,
    completedToolActions: 0,
    lastToolNames: [],
    gatherTurns: 0
  }), true);
  assert.equal(shouldUseGatherReasoning({
    turn: 0,
    completedToolActions: 0,
    lastToolNames: [],
    gatherTurns: 0,
    hasActiveJob: true
  }), false);
  assert.equal(efforts[0], "low");
});

test("parallel-safe read-only tools execute concurrently and preserve transcript order", async () => {
  const registry = new ToolRegistry();
  let active = 0;
  let maximum = 0;
  for (const name of ["read_one", "read_two"]) {
    registry.register({
      name,
      readOnly: true,
      parallelSafe: true,
      async handler() {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return { ok: true, name };
      }
    });
  }
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        turn += 1;
        return turn === 1
          ? {
              message: {
                role: "assistant",
                content: "I will read both sources now.",
                tool_calls: [
                  { id: "one", function: { name: "read_one", arguments: "{}" } },
                  { id: "two", function: { name: "read_two", arguments: "{}" } }
                ]
              }
            }
          : { message: { role: "assistant", content: "Done." } };
      }
    }
  });

  assert.equal(await loop.run("read both"), "Done.");
  assert.equal(maximum, 2);
  assert.deepEqual(
    loop.messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
    ["one", "two"]
  );
});

test("task routing is reused across continuation turns", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "inspect", handler: () => ({ ok: true }) });
  const routed = [];
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ preclassifiedRouting }) {
        routed.push(preclassifiedRouting);
        turn += 1;
        return turn === 1
          ? {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [{ id: "inspect", function: { name: "inspect", arguments: "{}" } }]
              }
            }
          : { message: { role: "assistant", content: "Done." } };
      }
    }
  });
  const routingDecision = { minimumClass: "balanced", workflow: "outcome-execution" };

  await loop.run("inspect", { routingDecision });
  assert.deepEqual(routed, [routingDecision, routingDecision]);
});

test("older raw tool evidence is compacted while the two newest result blocks remain exact", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "large_read", handler: (args) => ({ ok: true, id: args.id, body: "x".repeat(9_000) }) });
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: { maxRawToolEvidenceChars: 8_000 } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        turn += 1;
        return turn <= 3
          ? {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [{
                  id: `large-${turn}`,
                  function: { name: "large_read", arguments: JSON.stringify({ id: turn }) }
                }]
              }
            }
          : { message: { role: "assistant", content: "Done." } };
      }
    }
  });

  await loop.run("read the large sources");
  assert.equal(loop.messages.filter((message) => message.role === "tool").length, 3);
  assert.equal(loop.lastCompactionDecision.liveTranscriptRetained, true);
  assertCompleteToolBlocks(loop.messages);
});

test("raw tool evidence defers compaction when one future turn cannot repay the prefix rebuild", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "large_read", handler: (args) => ({ ok: true, id: args.id, body: "x".repeat(9_000) }) });
  let turn = 0;
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRawToolEvidenceChars: 8_000,
        compactionExpectedFutureTurns: 1
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        turn += 1;
        return turn <= 3
          ? {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [{
                  id: `large-${turn}`,
                  function: { name: "large_read", arguments: JSON.stringify({ id: turn }) }
                }]
              }
            }
          : { message: { role: "assistant", content: "Done." } };
      }
    }
  });

  await loop.run("read the large sources");
  assert.equal(loop.messages.filter((message) => message.role === "tool").length, 3);
  assert.equal(loop.lastCompactionDecision.applied, false);
  assert.equal(loop.lastCompactionDecision.reason, "cache_rebuild_cost");
});

test("agent turns reuse one opaque prompt session and expose prefix telemetry", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "inspect", handler: () => ({ ok: true }) });
  const requests = [];
  const receipts = [];
  const waitingForModel = [];
  let turn = 0;
  const loop = new AgentLoop({
    config: {
      agent: {},
      model: {
        provider: "openai-compatible",
        protocol: "openai-chat-completions",
        deployment: "local",
        model: "qwen3.8-27b",
        reasoningEffort: "medium"
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat(input) {
        requests.push(input);
        turn += 1;
        return turn === 1
          ? {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [{ id: "inspect-1", function: { name: "inspect", arguments: "{}" } }]
              },
              usage: { prompt_tokens: 100, completion_tokens: 10 }
            }
          : {
              message: { role: "assistant", content: "Done." },
              usage: { prompt_tokens: 120, completion_tokens: 10, cache_read_input_tokens: 80 }
            };
      }
    }
  });

  await loop.run("inspect", {
    promptSession: {
      key: "task-123",
      tenantBoundary: { tenantId: "tenant-secret" },
      authorityBoundary: { workspace: "/private/customer" }
    },
    onEvent: (event) => {
      if (event.type === "context_compiled") receipts.push(event);
      if (event.type === "phase" && /Waiting for the model/.test(event.summary || "")) {
        waitingForModel.push(event);
      }
    }
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].promptSessionId, requests[1].promptSessionId);
  assert.match(requests[0].promptSessionId, /^amos-[a-f0-9]{48}$/);
  assert.equal(requests[0].promptContractHash, requests[1].promptContractHash);
  assert.equal(receipts[0].prefixCache.contractReused, false);
  assert.equal(receipts[1].prefixCache.contractReused, true);
  assert.equal(waitingForModel.length, 2);
  assert.match(waitingForModel[0].summary, /Waiting for the model to think and respond/);
  assert.equal(receipts[1].prefixCache.sharedMessageCount, 2);
  assert.ok(receipts[1].prefixCache.reusableInputTokens > 0);
  assert.doesNotMatch(JSON.stringify(receipts), /tenant-secret|\/private\/customer/);
});

test("changing or omitting a prompt session clears stale prefix state", () => {
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: { chat: async () => ({ message: { role: "assistant", content: "done" } }) }
  });
  loop.configurePromptSession({ key: "first", tenantBoundary: { id: "one" } });
  loop.lastPromptCacheState = { contractSha256: "cached", messages: [] };
  loop.lastPromptCacheUsage = { cachedInputTokens: 10 };

  loop.configurePromptSession({ key: "second", tenantBoundary: { id: "one" } });
  assert.equal(loop.lastPromptCacheState, null);
  assert.equal(loop.lastPromptCacheUsage, null);
  assert.ok(loop.activePromptSessionId);

  loop.configurePromptSession(null);
  assert.equal(loop.activePromptSessionId, null);
  assert.equal(loop.promptBoundary, null);
});

test("productive work continues beyond the former eight-cycle limit", async () => {
  const registry = new ToolRegistry();
  const executed = [];
  registry.register({
    name: "inspect_part",
    async handler(args) {
      executed.push(args.part);
      return { ok: true, part: args.part };
    }
  });
  let turn = 0;
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        turn += 1;
        if (turn <= 10) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: `call-${turn}`,
                function: {
                  name: "inspect_part",
                  arguments: JSON.stringify({ part: turn })
                }
              }]
            }
          };
        }
        return { message: { role: "assistant", content: "All ten parts inspected." } };
      }
    }
  });

  assert.equal(await loop.run("Inspect every part"), "All ten parts inspected.");
  assert.deepEqual(executed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("a model timeout after completed tools exposes recoverable progress", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "write_part",
    async handler() {
      return { ok: true, path: "finished.txt" };
    }
  });
  let turn = 0;
  const events = [];
  const loop = new AgentLoop({
    config: { agent: {}, model: { deployment: "local" } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ onDelta }) {
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "write-1",
                function: { name: "write_part", arguments: "{}" }
              }]
            }
          };
        }
        onDelta("Partial", "Partial result");
        throw new Error("xAI / Grok request timed out");
      }
    }
  });

  await assert.rejects(
    loop.run("build it", { onEvent: (event) => events.push(event) }),
    (error) => {
      assert.equal(error.code, "AMOS_MODEL_TIMEOUT_AFTER_PROGRESS");
      assert.equal(error.completedToolActions, 1);
      assert.equal(error.partialResponse, "Partial result");
      return true;
    }
  );
  assert.equal(turn, 2);
  assert.ok(events.some((event) => event.type === "phase" && event.phase === "interrupted"));
});

test("a hosted timeout after tool progress continues remaining work once", async () => {
  const registry = new ToolRegistry();
  let writes = 0;
  registry.register({
    name: "write_part",
    async handler() {
      writes += 1;
      return { ok: true, path: "finished.txt" };
    }
  });
  let turn = 0;
  const events = [];
  const loop = new AgentLoop({
    config: {
      agent: { maxModelTransientRetries: 0 },
      model: { deployment: "customer-cloud", displayName: "Amazon Bedrock" }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "write-1",
                function: { name: "write_part", arguments: "{}" }
              }]
            }
          };
        }
        if (turn === 3) {
          assert.match(JSON.stringify(messages), /amos_timeout_continuation/);
        }
        throw new Error("Amazon Bedrock (Claude Fable 5) request timed out after becoming inactive");
      }
    }
  });

  await assert.rejects(
    loop.run("build it", { onEvent: (event) => events.push(event) }),
    (error) => {
      assert.equal(error.code, "AMOS_MODEL_TIMEOUT_AFTER_PROGRESS");
      assert.equal(error.completedToolActions, 1);
      return true;
    }
  );
  assert.equal(writes, 1);
  assert.equal(turn, 3);
  assert.ok(events.some((event) => /continuing remaining work/.test(event.summary || "")));
});

test("a stalled empty model response retries the same turn without replaying completed tools", async () => {
  const registry = new ToolRegistry();
  let writes = 0;
  registry.register({
    name: "write_part",
    async handler() {
      writes += 1;
      return { ok: true, path: "finished.txt" };
    }
  });
  let turn = 0;
  const events = [];
  const loop = new AgentLoop({
    config: { agent: { maxModelTransientRetries: 2 } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "write-1",
                function: { name: "write_part", arguments: "{}" }
              }]
            }
          };
        }
        if (turn === 2) {
          throw new Error("xAI / Grok streaming response did not include content or tool calls");
        }
        if (turn === 3) {
          throw new Error("fetch failed");
        }
        return { message: { role: "assistant", content: "Finished the remaining work." } };
      }
    }
  });

  assert.equal(await loop.run("build it", { onEvent: (event) => events.push(event) }), "Finished the remaining work.");
  assert.equal(writes, 1);
  assert.equal(turn, 4);
  assert.equal(events.filter((event) => event.type === "phase" && event.phase === "retrying").length, 2);
});

test("invalid streamed tool arguments are explained to the model and retried without replay", async () => {
  const registry = new ToolRegistry();
  const writes = [];
  registry.register({
    name: "write_part",
    async handler(args) {
      writes.push(args.part);
      return { ok: true, part: args.part };
    }
  });
  const requests = [];
  const events = [];
  const loop = new AgentLoop({
    config: { agent: { maxModelTransientRetries: 2 } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat(input) {
        requests.push(input);
        if (requests.length === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "write-1",
                function: { name: "write_part", arguments: "{\"part\":1}" }
              }]
            }
          };
        }
        if (requests.length === 2) {
          const error = new Error(
            "Amazon Bedrock returned incomplete streamed tool arguments after reaching max_tokens"
          );
          error.code = "AMOS_MODEL_INVALID_TOOL_ARGUMENTS";
          error.stopReason = "max_tokens";
          error.toolName = "write_part";
          error.truncated = true;
          throw error;
        }
        if (requests.length === 3) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "write-2",
                function: { name: "write_part", arguments: "{\"part\":2}" }
              }]
            }
          };
        }
        return { message: { role: "assistant", content: "Both parts are complete." } };
      }
    }
  });

  const answer = await loop.run("Write both parts", {
    onEvent: (event) => events.push(event)
  });

  assert.equal(answer, "Both parts are complete.");
  assert.deepEqual(writes, [1, 2]);
  assert.equal(requests.length, 4);
  assert.ok(requests[2].messages.some((message) => (
    String(message.content || "").includes("<amos_tool_call_correction>") &&
    String(message.content || "").includes("No tool from that invalid response executed") &&
    String(message.content || "").includes("incomplete when the output limit was reached")
  )));
  assert.equal(requests[3].messages.some((message) =>
    String(message.content || "").includes("<amos_tool_call_correction>")
  ), false);
  assert.ok(events.some((event) => (
    event.type === "phase" &&
    event.phase === "retrying" &&
    /no tool from that response executed/i.test(event.summary)
  )));
});

test("a repeated empty response after tool progress falls back to low-reasoning no-tools synthesis", async () => {
  const registry = new ToolRegistry();
  let writes = 0;
  registry.register({
    name: "write_part",
    async handler() {
      writes += 1;
      return { ok: true, path: "finished.txt" };
    }
  });
  const requests = [];
  let turn = 0;
  const events = [];
  const loop = new AgentLoop({
    config: { agent: { maxModelTransientRetries: 2 } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat(input) {
        requests.push(input);
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "write-1", function: { name: "write_part", arguments: "{}" } }]
            }
          };
        }
        if (turn <= 3) {
          const error = new Error("Amazon Bedrock response did not include content or tool calls");
          error.code = "AMOS_MODEL_REASONING_ONLY_RESPONSE";
          error.stopReason = "max_tokens";
          throw error;
        }
        return {
          message: { role: "assistant", content: "Recovered the completed work." },
          usage: { input_tokens: 30, output_tokens: 10 }
        };
      }
    }
  });

  const answer = await loop.run("build it", { onEvent: (event) => events.push(event) });
  assert.equal(answer, "Recovered the completed work.");
  assert.equal(writes, 1);
  assert.equal(turn, 4);
  assert.deepEqual(requests[3].tools, []);
  assert.equal(requests[3].reasoningEffortOverride, "low");
  assert.ok(requests[3].messages.some((message) =>
    String(message.content || "").includes("amos_empty_response_recovery")
  ));
  assert.ok(events.some((event) =>
    event.type === "phase" && event.phase === "synthesizing" && /recovering/i.test(event.summary)
  ));
});

test("a timed research checkpoint lets the user synthesize without another tool call", async () => {
  const registry = new ToolRegistry();
  let now = 0;
  let reads = 0;
  registry.register({
    name: "inspect_model",
    async handler() {
      reads += 1;
      now = 61_000;
      return { ok: true, mrr: 7100 };
    }
  });
  const requests = [];
  const decisions = [];
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {
      async ask(question, options) {
        decisions.push({ question, options });
        return { answered: true, answer: "Synthesize now" };
      }
    },
    amosClient: {},
    now: () => now,
    kimiClient: {
      async chat(input) {
        requests.push(input);
        if (input.messages.some((message) =>
          String(message.content || "").includes("amos_research_checkpoint_assessment")
        )) {
          return {
            message: {
              role: "assistant",
              content: "MRR is established; partner economics remain uncertain; more research may improve channel assumptions."
            }
          };
        }
        if (requests.length === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "read-1", function: { name: "inspect_model", arguments: "{}" } }]
            }
          };
        }
        return { message: { role: "assistant", content: "Here is the supported plan." } };
      }
    }
  });

  const answer = await loop.run("Analyze the financial model", {
    researchCheckpoint: { enabled: true, afterMs: 60_000, extensionMs: 300_000 }
  });
  assert.equal(answer, "Here is the supported plan.");
  assert.equal(reads, 1);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].options.decisionType, "research-checkpoint");
  assert.deepEqual(requests[1].tools, []);
  assert.equal(requests[1].reasoningEffortOverride, "low");
  assert.match(decisions[0].options.context, /partner economics remain uncertain/i);
  assert.deepEqual(requests[2].tools, []);
  assert.ok(requests[2].messages.some((message) =>
    String(message.content || "").includes("amos_research_checkpoint_synthesis")
  ));
});

test("research checkpoint synthesis retries a transient provider failure without replaying tools", async () => {
  const registry = new ToolRegistry();
  let now = 0;
  let reads = 0;
  registry.register({
    name: "inspect_once",
    async handler() {
      reads += 1;
      now = 61_000;
      return { ok: true, evidence: "retained" };
    }
  });
  let request = 0;
  const events = [];
  const loop = new AgentLoop({
    config: { agent: { maxModelTransientRetries: 2 } },
    registry,
    approvals: {
      async ask() {
        return { answered: true, answer: "Synthesize now" };
      }
    },
    amosClient: {},
    now: () => now,
    kimiClient: {
      async chat(input) {
        request += 1;
        if (request === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "read-1", function: { name: "inspect_once", arguments: "{}" } }]
            }
          };
        }
        if (input.messages.some((message) =>
          String(message.content || "").includes("amos_research_checkpoint_assessment")
        )) {
          return { message: { role: "assistant", content: "Enough evidence is available." } };
        }
        if (request === 3) {
          const error = new Error("Service temporarily unavailable");
          error.status = 503;
          throw error;
        }
        return { message: { role: "assistant", content: "Recovered supported answer." } };
      }
    }
  });

  const answer = await loop.run("Research once", {
    researchCheckpoint: { enabled: true, afterMs: 60_000, extensionMs: 300_000 },
    onEvent: (event) => events.push(event)
  });

  assert.equal(answer, "Recovered supported answer.");
  assert.equal(reads, 1);
  assert.equal(request, 4);
  assert.ok(events.some((event) => (
    event.type === "phase" && event.phase === "retrying" && /preserved evidence/i.test(event.summary)
  )));
});

test("a work-step checkpoint prevents varied tools from running indefinitely", async () => {
  const registry = new ToolRegistry();
  let reads = 0;
  registry.register({
    name: "inspect_next_source",
    async handler() {
      reads += 1;
      return { ok: true, source: reads };
    }
  });
  let mainTurns = 0;
  let decisions = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {
      async ask() {
        decisions += 1;
        return { answered: true, answer: "Synthesize now" };
      }
    },
    amosClient: {},
    now: () => 0,
    kimiClient: {
      async chat(input) {
        if (input.messages.some((message) =>
          String(message.content || "").includes("amos_research_checkpoint_assessment")
        )) {
          return { message: { role: "assistant", content: "Two sources are enough to answer." } };
        }
        if (input.messages.some((message) =>
          String(message.content || "").includes("amos_research_checkpoint_synthesis")
        )) {
          return { message: { role: "assistant", content: "Here is the bounded result." } };
        }
        mainTurns += 1;
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: `read-${mainTurns}`,
              function: { name: "inspect_next_source", arguments: JSON.stringify({ source: mainTurns }) }
            }]
          }
        };
      }
    }
  });

  const answer = await loop.run("Research the opportunity", {
    researchCheckpoint: {
      enabled: true,
      afterMs: 60 * 60_000,
      extensionMs: 300_000,
      afterToolCycles: 2
    }
  });
  assert.equal(answer, "Here is the bounded result.");
  assert.equal(reads, 2);
  assert.equal(decisions, 1);
});

test("a research checkpoint can extend work or remove later timed interruptions", async () => {
  const registry = new ToolRegistry();
  let now = 0;
  let reads = 0;
  registry.register({
    name: "inspect_model",
    async handler() {
      reads += 1;
      now = reads === 1 ? 61_000 : 400_000;
      return { ok: true };
    }
  });
  let decisionCount = 0;
  let mainTurn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {
      async ask() {
        decisionCount += 1;
        return {
          answered: true,
          answer: decisionCount === 1
            ? "Research 5 more minutes"
            : "Keep working autonomously"
        };
      }
    },
    amosClient: {},
    now: () => now,
    kimiClient: {
      async chat(input) {
        if (input.messages.some((message) =>
          String(message.content || "").includes("amos_research_checkpoint_assessment")
        )) {
          return { message: { role: "assistant", content: "Progress brief." } };
        }
        mainTurn += 1;
        if (mainTurn <= 2) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: `read-${mainTurn}`,
                function: { name: "inspect_model", arguments: "{}" }
              }]
            }
          };
        }
        now = 3_600_000;
        return { message: { role: "assistant", content: "Autonomous result." } };
      }
    }
  });

  assert.equal(await loop.run("Research deeply", {
    researchCheckpoint: { enabled: true, afterMs: 60_000, extensionMs: 300_000 }
  }), "Autonomous result.");
  assert.equal(decisionCount, 2);
  assert.equal(reads, 2);
});

test("internal compaction evidence cannot masquerade as the completed user result", async () => {
  const registry = new ToolRegistry();
  let reads = 0;
  registry.register({
    name: "inspect_current_state",
    async handler() {
      reads += 1;
      return { ok: true, status: "current" };
    }
  });
  let turn = 0;
  const events = [];
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "inspect-1",
                function: { name: "inspect_current_state", arguments: "{}" }
              }]
            }
          };
        }
        if (turn === 2) {
          return {
            message: {
              role: "assistant",
              content: "Earlier tool evidence was compacted to fit this model's context window. - inspect_current_state: current"
            }
          };
        }
        assert.ok(messages.some((message) =>
          String(message.content || "").includes("amos_user_facing_result_required")
        ));
        return {
          message: {
            role: "assistant",
            content: "The current state is verified. The next step is to implement the remaining portal route."
          }
        };
      }
    }
  });

  const answer = await loop.run("Finish the portal plan", {
    onEvent: (event) => events.push(event)
  });

  assert.equal(reads, 1);
  assert.equal(turn, 3);
  assert.match(answer, /current state is verified/i);
  assert.ok(events.some((event) =>
    event.type === "phase" && event.phase === "retrying" && /internal context/i.test(event.summary)
  ));
});

test("a recover-the-thread announcement is not a completed answer", async () => {
  const events = [];
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    scratchpad: {
      currentJob: "Update tax_behavior to inclusive on these three Stripe prices",
      jobs: [{ title: "Update tax_behavior to inclusive on these three Stripe prices", status: "current" }]
    },
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "I'll pick up where we left off. Let me check the current state of your Stripe merchant account and your QuickBooks connection before touching tax settings or the integration."
            }
          };
        }
        assert.ok(messages.some((message) =>
          String(message.content || "").includes("amos_user_facing_result_required")
        ));
        assert.ok(messages.some((message) =>
          /Continuing the current job without restarting/.test(String(message.content || ""))
        ));
        return {
          message: {
            role: "assistant",
            content: "Updating inclusive tax_behavior on the three Stripe prices now."
          }
        };
      }
    }
  });

  const answer = await loop.run("this issue should be fixed...lets try it again", {
    onEvent: (event) => events.push(event)
  });
  assert.equal(turn, 2);
  assert.match(answer, /Updating inclusive tax_behavior/);
  assert.ok(events.some((event) =>
    event.type === "phase" && event.phase === "retrying" && /recovery instead of acting/i.test(event.summary)
  ));
});

test("a long reframe-the-plan recap is not a completed answer", async () => {
  const events = [];
  let turn = 0;
  const recap = [
    "You're right — let me reframe around the actual live plans and separate what I've verified from what I haven't.",
    "",
    "What's verified (live Stripe account, AMOS Labs)",
    "Starter $99 unspecified — not taxed. Pro $349 unspecified — not taxed.",
    "The fix for task 1 (proposed, not yet applied)",
    "Set tax_behavior to exclusive on the two live prices.",
    "x".repeat(1_500)
  ].join("\n");
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    scratchpad: {
      currentJob: "Fix tax_behavior on the three Stripe prices",
      jobs: [{ title: "Fix tax_behavior on the three Stripe prices", status: "current" }],
      notes: "LANDED POST /v1/prices/price_1Tn0fPGlkubafVtvDNckoZPh → 200 tax_behavior=exclusive"
    },
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        if (turn === 1) {
          return { message: { role: "assistant", content: recap } };
        }
        assert.ok(messages.some((message) =>
          String(message.content || "").includes("amos_user_facing_result_required")
        ));
        assert.ok(messages.some((message) =>
          /Do not recover, reframe/.test(String(message.content || ""))
        ));
        return {
          message: {
            role: "assistant",
            content: "Starter and Pro already landed exclusive tax. Next is the QBO accounts."
          }
        };
      }
    }
  });

  const answer = await loop.run("ok...yes...lets do the tax calls", {
    onEvent: (event) => events.push(event)
  });
  assert.equal(turn, 2);
  assert.match(answer, /already landed exclusive tax/);
  assert.ok(events.some((event) =>
    event.type === "phase" && event.phase === "retrying" && /recovery instead of acting/i.test(event.summary)
  ));
});

test("a denied company decision is injected into an active turn without hopping the job", async () => {
  const loop = new AgentLoop({
    config: { agent: {} },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    scratchpad: {
      currentJob: "Fix tax_behavior on the three Stripe prices",
      jobs: [{ title: "Fix tax_behavior on the three Stripe prices", status: "current" }]
    },
    kimiClient: {
      async chat() {
        return { message: { role: "assistant", content: "waiting" } };
      }
    }
  });
  loop.workingObjective = "Fix tax_behavior on the three Stripe prices";
  loop.activeTaskMessage = { role: "user", content: "apply exclusive tax" };
  const injected = await loop.notifyDecisionOutcome({
    id: "33333333-3333-3333-3333-333333333333",
    status: "denied",
    verb: "connection_call",
    review_summary: "Create AMS Subscriptions - Core 99",
    args: {
      connection: "quickbooks",
      method: "POST",
      path: "/v3/company/{realm_id}/account"
    }
  });
  assert.equal(injected, "active_turn");
  assert.equal(loop.workingObjective, "Fix tax_behavior on the three Stripe prices");
  assert.match(loop.scratchpad.notes, /DENIED POST \/v3\/company\/\{realm_id\}\/account/);
  assert.equal(loop.flushPendingDecisionEvidence(), 1);
  const evidence = loop.messages.at(-1);
  assert.equal(evidence.role, "user");
  assert.match(evidence.content, /DENIED by a human/);
  assert.match(evidence.content, /was not executed/);
  assert.equal(loop.workingObjective, "Fix tax_behavior on the three Stripe prices");
});

test("a successful Stripe write is remembered and the identical call is not sent again", async () => {
  const registry = new ToolRegistry();
  let sent = 0;
  registry.register({
    name: "connection_call",
    async handler() {
      sent += 1;
      return {
        ok: true,
        status: 200,
        body: {
          id: "price_1Tn0fPGlkubafVtvDNckoZPh",
          tax_behavior: "exclusive"
        }
      };
    }
  });
  let phase = "first";
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        if (phase === "first") {
          phase = "replay";
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "tax-1",
                function: {
                  name: "connection_call",
                  arguments: JSON.stringify({
                    connection: "stripe",
                    method: "POST",
                    path: "/v1/prices/price1Tn0fPGlkubafVtvDNckoZPh",
                    body: { taxbehavior: "exclusive" }
                  })
                }
              }]
            }
          };
        }
        if (phase === "replay") {
          phase = "done";
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "tax-2",
                function: {
                  name: "connection_call",
                  arguments: JSON.stringify({
                    connection: "stripe",
                    method: "POST",
                    path: "/v1/prices/price_1Tn0fPGlkubafVtvDNckoZPh",
                    body: { tax_behavior: "exclusive" }
                  })
                }
              }]
            }
          };
        }
        return {
          message: {
            role: "assistant",
            content: "Exclusive tax already landed on Starter. Next is QuickBooks accounts."
          }
        };
      }
    }
  });

  const answer = await loop.run("apply exclusive tax to the $99 plan");
  assert.equal(sent, 1);
  assert.match(loop.scratchpad.notes, /LANDED POST \/v1\/prices\/price_1Tn0fPGlkubafVtvDNckoZPh → 200/);
  assert.match(answer, /already landed/);
});

test("message-limit compaction keeps tool evidence from before the latest follow-up", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "connection_call",
    async handler() {
      return { status: 403, ok: false, path: "/v1/prices/price_1ABC", body: "403 Forbidden" };
    }
  });
  let phase = "seed";
  const loop = new AgentLoop({
    config: {
      agent: { maxModelMessages: 18, completedHistoryMessages: 400 },
      model: { contextTokens: 32_768, maxCompletionTokens: 256, provider: "amos-hosted" }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        if (phase === "seed") {
          return { message: { role: "assistant", content: "ack" } };
        }
        if (phase === "tax") {
          phase = "tax-result";
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "price-1",
                function: { name: "connection_call", arguments: "{\"path\":\"/v1/prices/price_1ABC\"}" }
              }]
            }
          };
        }
        if (phase === "tax-result") {
          phase = "follow";
          return { message: { role: "assistant", content: "Stripe returned 403 on price_1ABC." } };
        }
        const text = messages.map((message) => String(message.content || "")).join("\n");
        assert.match(text, /403/);
        assert.match(text, /price_1ABC/);
        assert.ok(messages.some((message) => message.role === "tool"));
        return { message: { role: "assistant", content: "Retrying the inclusive tax write." } };
      }
    }
  });

  for (let index = 0; index < 16; index += 1) {
    await loop.run(`seed ${index} ${"n".repeat(80)}`);
  }
  phase = "tax";
  await loop.run("Update tax_behavior to inclusive on price_1ABC");
  const answer = await loop.run("this issue should be fixed...lets try it again");
  assert.match(answer, /Retrying the inclusive tax write/);
});

test("exhausted transient retries after progress surface recoverable progress", async () => {
  const registry = new ToolRegistry();
  let writes = 0;
  registry.register({
    name: "write_part",
    async handler() {
      writes += 1;
      return { ok: true };
    }
  });
  let turn = 0;
  const events = [];
  const loop = new AgentLoop({
    config: { agent: { maxModelTransientRetries: 1 } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "w1", function: { name: "write_part", arguments: "{}" } }]
            }
          };
        }
        throw new Error("fetch failed");
      }
    }
  });
  const failure = await loop.run("build it", { onEvent: (event) => events.push(event) }).then(
    () => null,
    (error) => error
  );
  assert.equal(writes, 1);
  assert.equal(turn, 3); // tool turn, one retry, then the exhausted failing turn
  assert.equal(failure.code, "AMOS_MODEL_TRANSIENT_AFTER_PROGRESS");
  assert.equal(failure.completedToolActions, 1);
  assert.ok(events.some((event) => event.type === "phase" && event.phase === "retrying"));
  assert.ok(events.some((event) => event.type === "phase" && event.phase === "interrupted"));
});

test("a user cancel still stops immediately and does not retry", async () => {
  const loop = new AgentLoop({
    config: { agent: { maxModelTransientRetries: 2 } },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        const error = new Error("Task canceled");
        error.name = "AbortError";
        error.code = "AMOS_TASK_CANCELED";
        throw error;
      }
    }
  });
  await assert.rejects(loop.run("continue"), /Task canceled/);
});

test("completed task history stays below the provider message ceiling", async () => {
  const observedLengths = [];
  const loop = new AgentLoop({
    config: {
      agent: {
        completedHistoryMessages: 8,
        maxModelMessages: 12
      }
    },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        observedLengths.push(messages.length);
        assert.ok(messages.length <= 12);
        assert.equal(messages[0].role, "system");
        assert.equal(messages[1].role, "user");
        return { message: { role: "assistant", content: "Done." } };
      }
    }
  });

  for (let task = 0; task < 30; task += 1) {
    assert.equal(await loop.run(`Complete task ${task}`), "Done.");
  }

  assert.ok(observedLengths.every((length) => length <= 12));
  assert.ok(loop.messages.some((message) => String(message.content).includes("Complete task 0")));
  assert.ok(loop.messages.some((message) => String(message.content).includes("Complete task 29")));
  assert.ok(loop.messages.filter((message) => message.role === "user").length >= 30);
});

test("a follow-up turn still sees the original conversation objective", async () => {
  const seen = [];
  const loop = new AgentLoop({
    config: {
      agent: {
        completedHistoryMessages: 8,
        maxModelMessages: 10
      },
      model: { contextTokens: 4_096, maxCompletionTokens: 256 }
    },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        seen.push(messages.map((message) => String(message.content || "")));
        return {
          message: {
            role: "assistant",
            content: `ack ${seen.length}\n${"x".repeat(8_000)}`
          }
        };
      }
    }
  });

  const first = await loop.run("Update tax_behavior to inclusive on these three Stripe prices");
  assert.match(first, /^ack 1/);
  for (let turn = 0; turn < 12; turn += 1) {
    await loop.run(`status ${turn}`);
  }
  await loop.run("this issue should be fixed...lets try it again");

  const lastPrompt = seen.at(-1).join("\n");
  assert.match(lastPrompt, /Update tax_behavior to inclusive/);
  assert.match(lastPrompt, /lets try it again/);
  const inspected = await loop.registry.execute(
    "desktop_inspect_conversation",
    { query: "tax_behavior" },
    {}
  );
  assert.equal(inspected.ok, true);
  assert.ok(inspected.matches.length >= 1);
});

test("a conversation scratch pad tracks job hops and is always in the model window", async () => {
  const persisted = [];
  const seen = [];
  const loop = new AgentLoop({
    config: { agent: {}, model: { contextTokens: 32_768, maxCompletionTokens: 256 } },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    onScratchpadChange: (pad) => persisted.push(structuredClone(pad)),
    kimiClient: {
      async chat({ messages }) {
        seen.push(messages.map((message) => String(message.content || "")).join("\n"));
        return { message: { role: "assistant", content: `ack ${seen.length}` } };
      }
    }
  });

  await loop.run("Help me build a Stripe to QuickBooks integration for AMOS Labs");
  await loop.run("We need to add these accounts to QBO");
  await loop.run("Fix tax_behavior on the three Stripe prices");
  await loop.run("try again");

  assert.equal(loop.scratchpad.currentJob, "Fix tax_behavior on the three Stripe prices");
  assert.equal(loop.scratchpad.jobs.length, 3);
  assert.equal(loop.scratchpad.jobs[0].status, "parked");
  assert.ok(persisted.length >= 3);
  assert.match(seen.at(-1), /<amos_scratchpad>/);
  assert.match(seen.at(-1), /Stripe to QuickBooks integration/);
  assert.match(seen.at(-1), /add these accounts to QBO/);
  assert.match(seen.at(-1), /try again/);
  assert.match(seen[0], /<amos_scratchpad>/);

  const restoredSeen = [];
  const restored = new AgentLoop({
    config: { agent: {}, model: { contextTokens: 32_768 } },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    scratchpad: persisted.at(-1),
    kimiClient: {
      async chat({ messages }) {
        restoredSeen.push(messages.map((message) => String(message.content || "")).join("\n"));
        return {
          message: {
            role: "assistant",
            content: "The Stripe tax work remains the current priority."
          }
        };
      }
    }
  });
  const replayed = await restored.run("is it live");
  assert.match(restoredSeen.at(-1), /Fix tax_behavior on the three Stripe prices/);
  assert.match(restoredSeen.at(-1), /Stripe to QuickBooks integration/);
  assert.doesNotMatch(replayed, /scratch\s*pad|job\s*pad/i);
  assert.equal(restored.workingObjective, "Fix tax_behavior on the three Stripe prices");
});

test("an active tool-heavy task keeps its objective and complete recent tool blocks", async () => {
  const registry = new ToolRegistry();
  const executed = [];
  let turn = 0;
  registry.register({
    name: "inspect_part",
    async handler(args) {
      executed.push(args.part);
      return { ok: true, part: args.part };
    }
  });
  const loop = new AgentLoop({
    config: {
      agent: {
        maxModelMessages: 12,
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        assert.ok(messages.length <= 12);
        assert.equal(messages[0].role, "system");
        assert.ok(
          messages.some(
            (message) => message.role === "user" &&
              String(message.content).includes("Inspect all twelve parts")
          )
        );
        assertCompleteToolBlocks(messages);
        turn += 1;
        if (turn <= 12) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: `call-${turn}`,
                function: {
                  name: "inspect_part",
                  arguments: JSON.stringify({ part: turn })
                }
              }]
            }
          };
        }
        return { message: { role: "assistant", content: "All twelve parts inspected." } };
      }
    }
  });

  assert.equal(await loop.run("Inspect all twelve parts"), "All twelve parts inspected.");
  assert.deepEqual(executed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(loop.messages.filter((message) => message.role === "tool").length >= 12);
  assert.equal(loop.lastCompactionDecision.scope, "active_history");
  assert.equal(loop.lastCompactionDecision.applied, true);
  assert.ok(loop.lastCompactionDecision.rebuildTokens > 0);
});

test("successful AMOS results receive a short-lived desktop canvas reference", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "amos_company_overview",
    async handler() {
      return { revenue: 125000 };
    }
  });
  let turn = 0;
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    onToolResult({ name, result }) {
      assert.equal(name, "amos_company_overview");
      assert.equal(result.revenue, 125000);
      return { result_ref: "result-1" };
    },
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call-1",
                function: { name: "amos_company_overview", arguments: "{}" }
              }]
            }
          };
        }
        const toolResult = JSON.parse(messages.at(-1).content);
        assert.equal(toolResult.desktop_result_ref, "result-1");
        return { message: { role: "assistant", content: "Company view is ready." } };
      }
    }
  });

  assert.equal(await loop.run("Show the company"), "Company view is ready.");
});

test("queued steering is applied to the same task at a safe tool boundary", async () => {
  const registry = new ToolRegistry();
  const steering = [];
  const events = [];
  let turn = 0;
  registry.register({
    name: "inspect_issue",
    async handler() {
      steering.push({ content: "Also compare the pinned Plumbline version." });
      return { ok: true, issue: 312 };
    }
  });
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        if (turn === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call-1",
                function: { name: "inspect_issue", arguments: "{}" }
              }]
            }
          };
        }
        assert.equal(messages.at(-1).role, "user");
        assert.equal(messages.at(-1).content, "Also compare the pinned Plumbline version.");
        return { message: { role: "assistant", content: "Issue and version compared." } };
      }
    }
  });

  const answer = await loop.run("Inspect issue 312", {
    takeSteering: () => steering.splice(0),
    onEvent: (event) => events.push(event)
  });

  assert.equal(answer, "Issue and version compared.");
  assert.ok(
    events.some(
      (event) => event.type === "phase" && event.phase === "steering_applied"
    )
  );
});

test("steering received during a final model response continues the active task", async () => {
  const steering = [];
  let turn = 0;
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3
      }
    },
    registry: new ToolRegistry(),
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages }) {
        turn += 1;
        if (turn === 1) {
          steering.push("Focus the answer on the release mismatch.");
          return { message: { role: "assistant", content: "Initial answer." } };
        }
        assert.equal(messages.at(-1).content, "Focus the answer on the release mismatch.");
        return { message: { role: "assistant", content: "Release mismatch analyzed." } };
      }
    }
  });

  const answer = await loop.run("Analyze the issue", {
    takeSteering: () => steering.splice(0)
  });

  assert.equal(answer, "Release mismatch analyzed.");
  assert.equal(turn, 2);
});

test("a repeating tool loop ends with a useful synthesis instead of a turn-limit error", async () => {
  const registry = new ToolRegistry();
  const events = [];
  let synthesisMessages = [];
  let calls = 0;
  registry.register({
    name: "inspect_issue",
    async handler() {
      return { ok: true, state: "unchanged", updated_at: `volatile-${calls}` };
    }
  });
  const loop = new AgentLoop({
    config: {
      agent: {
        maxRepeatedToolCycles: 3,
        maxConsecutiveToolErrorCycles: 3
      }
    },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ messages, tools }) {
        calls += 1;
        if (tools.length === 0) {
          synthesisMessages = messages;
          return {
            message: {
              role: "assistant",
              content: "The issue is unchanged; inspect the receipt formula next."
            }
          };
        }
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: `call-${calls}`,
              function: { name: "inspect_issue", arguments: "{}" }
            }]
          }
        };
      }
    }
  });

  const answer = await loop.run("Diagnose the issue", {
    onEvent: (event) => events.push(event)
  });

  assert.equal(answer, "The issue is unchanged; inspect the receipt formula next.");
  assert.equal(calls, 4);
  assert.ok(events.some((event) => event.phase === "synthesizing"));
  assert.doesNotMatch(answer, /Stopped after/i);
  assert.equal(loop.messages.filter((message) => message.role === "system").length, 1);
  assert.equal(synthesisMessages[0].role, "system");
  assert.equal(synthesisMessages.filter((message) => message.role === "system").length, 1);
  assert.equal(synthesisMessages.at(-1).role, "user");
  assert.match(synthesisMessages.at(-1).content, /Do not call another tool/);
});

test("an identical read-only status request synthesizes despite changing receipt metadata", async () => {
  const registry = new ToolRegistry();
  let modelCalls = 0;
  let toolCalls = 0;
  registry.register({
    name: "get_mission",
    readOnly: true,
    parallelSafe: true,
    async handler() {
      toolCalls += 1;
      return {
        ok: true,
        status: "queued",
        providerCreditsUsed: 0,
        updatedAt: `2026-09-01T00:00:0${toolCalls}Z`,
        receiptId: `receipt-${toolCalls}`,
        diagnostics: { trace_id: `trace-${toolCalls}` }
      };
    }
  });
  const loop = new AgentLoop({
    config: { agent: { maxRepeatedToolCycles: 3 } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools }) {
        modelCalls += 1;
        if (tools.length === 0) {
          return {
            message: {
              role: "assistant",
              content: "The Mission is queued and has used zero Apollo credits; it has not begun prospecting."
            }
          };
        }
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: `mission-${modelCalls}`,
              function: {
                name: "get_mission",
                arguments: JSON.stringify({ mission_id: "mission-1" })
              }
            }]
          }
        };
      }
    }
  });

  const answer = await loop.run("What is the Mission status?");

  assert.equal(toolCalls, 2);
  assert.equal(modelCalls, 3);
  assert.match(answer, /queued/i);
  assert.match(answer, /zero Apollo credits/i);
});

test("a scratchpad update cannot replace a live campaign status answer", async () => {
  const registry = new ToolRegistry();
  const events = [];
  let modelCalls = 0;
  let scratchpadCalls = 0;
  let statusCalls = 0;
  registry.register({
    name: "desktop_update_scratchpad",
    async handler() {
      scratchpadCalls += 1;
      return {
        ok: true,
        bookkeeping_only: true,
        user_facing_evidence: false
      };
    }
  });
  registry.register({
    name: "get_prospecting_campaign",
    readOnly: true,
    parallelSafe: true,
    async handler() {
      statusCalls += 1;
      return {
        ok: true,
        status: "active",
        next_page: 1,
        credits_used: 0,
        qualified: 0,
        updated_at: "2026-09-01T15:51:32Z"
      };
    }
  });
  const loop = new AgentLoop({
    config: { agent: {} },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat() {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            message: {
              role: "assistant",
              content: "The campaign details are captured and I can check its first batch next.",
              tool_calls: [{
                id: "scratchpad-1",
                function: {
                  name: "desktop_update_scratchpad",
                  arguments: JSON.stringify({ note: "Check the first batch" })
                }
              }]
            }
          };
        }
        if (modelCalls === 2) {
          return {
            message: {
              role: "assistant",
              content: "Job pad updated. Say the word and I'll re-poll now for the first batch."
            }
          };
        }
        if (modelCalls === 3) {
          return {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "status-1",
                function: {
                  name: "get_prospecting_campaign",
                  arguments: JSON.stringify({ campaign_id: "campaign-1" })
                }
              }]
            }
          };
        }
        return {
          message: {
            role: "assistant",
            content: "The campaign exists but is not processing: it remains on page 1 with 0 qualified prospects and 0 credits used."
          }
        };
      }
    }
  });

  const answer = await loop.run("Can you confirm this is running?", {
    onEvent: (event) => events.push(event)
  });

  assert.equal(scratchpadCalls, 1);
  assert.equal(statusCalls, 1);
  assert.equal(modelCalls, 4);
  assert.match(answer, /not processing/i);
  assert.match(answer, /0 credits used/i);
  assert.doesNotMatch(answer, /job pad|scratchpad/i);
  assert.ok(events.some((event) =>
    event.phase === "retrying" && /Private bookkeeping/i.test(event.summary)
  ));
});

test("paraphrased read-only discovery cannot evade the guard and synthesis routes one tier higher", async () => {
  const registry = new ToolRegistry();
  let modelCalls = 0;
  let discoveryCalls = 0;
  let synthesisRouting = null;
  registry.register({
    name: "amos_resolve_capabilities",
    readOnly: true,
    parallelSafe: true,
    async handler() {
      discoveryCalls += 1;
      return { ok: true, operation_count: 0, operations: [] };
    }
  });
  const events = [];
  const loop = new AgentLoop({
    config: { agent: { maxRepeatedToolCycles: 3, maxCapabilityDiscoveryCycles: 3 } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools, preclassifiedRouting }) {
        modelCalls += 1;
        if (tools.length === 0) {
          synthesisRouting = preclassifiedRouting;
          return {
            message: {
              role: "assistant",
              content: "No matching capability exists. Ask the user for the missing connection."
            }
          };
        }
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: `discovery-${modelCalls}`,
              function: {
                name: "amos_resolve_capabilities",
                arguments: JSON.stringify({ outcome: `paraphrase ${modelCalls}` })
              }
            }]
          }
        };
      }
    }
  });

  const answer = await loop.run("Create a Mission", {
    routingDecision: { minimumClass: "balanced", source: "test" },
    onEvent: (event) => events.push(event)
  });

  assert.equal(discoveryCalls, 2);
  assert.equal(modelCalls, 3);
  assert.equal(synthesisRouting.minimumClass, "deep");
  assert.match(answer, /missing connection/i);
  assert.ok(events.some((event) =>
    event.type === "guard" && event.escalatedRoutingClass === "deep"
  ));
});

test("an unclassified repeated request cannot evade the loop guard with changing results", async () => {
  const registry = new ToolRegistry();
  let modelCalls = 0;
  let toolCalls = 0;
  registry.register({
    name: "remote_operation",
    async handler() {
      toolCalls += 1;
      return { ok: true, state: "unchanged", receipt_id: `receipt-${toolCalls}` };
    }
  });
  const loop = new AgentLoop({
    config: { agent: { maxRepeatedToolCycles: 3 } },
    registry,
    approvals: {},
    amosClient: {},
    kimiClient: {
      async chat({ tools }) {
        modelCalls += 1;
        if (tools.length === 0) {
          return { message: { role: "assistant", content: "The remote operation made no progress." } };
        }
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: `remote-${modelCalls}`,
              function: { name: "remote_operation", arguments: "{\"value\":1}" }
            }]
          }
        };
      }
    }
  });

  const answer = await loop.run("Run the remote operation");

  assert.equal(toolCalls, 3);
  assert.equal(modelCalls, 4);
  assert.match(answer, /no progress/i);
});

function toolNames(tools) {
  return tools
    .map((tool) => tool.function.name)
    .filter((name) =>
      name !== "desktop_inspect_conversation"
      && name !== "desktop_read_scratchpad"
      && name !== "desktop_update_scratchpad"
    );
}

function assertCompleteToolBlocks(messages) {
  let pending = new Set();
  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls?.length > 0) {
      assert.equal(pending.size, 0);
      pending = new Set(message.tool_calls.map((call) => call.id));
      continue;
    }
    if (message.role === "tool") {
      assert.ok(pending.has(message.tool_call_id));
      pending.delete(message.tool_call_id);
      continue;
    }
    assert.equal(pending.size, 0);
  }
  assert.equal(pending.size, 0);
}
