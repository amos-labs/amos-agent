import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../src/agentLoop.js";
import { ToolRegistry } from "../src/tools/registry.js";

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

test("agent loop exposes streaming progress and cancels an active tool", async () => {
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
      return { ok: true, state: "unchanged" };
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
