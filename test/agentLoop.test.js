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
    config: { agent: { maxToolTurns: 2 } },
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
    config: { agent: { maxToolTurns: 1 } },
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
    config: { agent: { maxToolTurns: 2 } },
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
