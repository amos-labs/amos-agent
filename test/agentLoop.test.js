import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../src/agentLoop.js";
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

test("malformed tool JSON is returned as an error and never executes", async () => {
  let calls = 0;
  let turn = 0;
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
      async chat() {
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

  assert.equal(await loop.run("test"), "recovered");
  assert.equal(calls, 0);
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

test("agent loop hides internal tool-turn narration and cancels an active tool", async () => {
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
  assert.equal(events.some((event) => event.type === "assistant_delta" && event.text === "Working"), false);
  assert.ok(events.some((event) => event.type === "phase" && event.phase === "acting"));
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
  assert.equal(loop.messages.filter((message) => message.role === "tool").length, 2);
  assert.ok(loop.messages.some((message) =>
    message.role === "assistant" && /Earlier tool activity was compacted/.test(message.content)
  ));
  assertCompleteToolBlocks(loop.messages);
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
    config: { agent: {} },
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
  assert.ok(events.some((event) => event.type === "phase" && event.phase === "interrupted"));
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
  assert.ok(loop.messages.length <= 10);
  assert.ok(loop.messages.some((message) => String(message.content).includes("Complete task 29")));
  assert.ok(!loop.messages.some((message) => String(message.content).includes("Complete task 0\n")));
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
  assert.ok(loop.messages.length <= 13);
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
      async chat({ tools }) {
        calls += 1;
        if (tools.length === 0) {
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
});

function toolNames(tools) {
  return tools.map((tool) => tool.function.name);
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
