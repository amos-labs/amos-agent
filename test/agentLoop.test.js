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
