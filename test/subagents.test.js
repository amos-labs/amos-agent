import test from "node:test";
import assert from "node:assert/strict";
import { createSubagentTools } from "../src/tools/subagents.js";

test("subagent tools stay local and do not widen authority", async () => {
  const calls = [];
  const tools = Object.fromEntries(createSubagentTools({
    handoff: async (input) => {
      calls.push(["handoff", input]);
      return { ok: true, role: input.role };
    },
    spawn: async (input) => {
      calls.push(["spawn", input]);
      return { ok: true, task_id: "child-1", workspace_mode: input.workspaceMode };
    },
    list: async () => ({ children: [] }),
    collect: async (input) => ({ ok: true, task_id: input.taskId, running: false }),
    reportStage: async (input) => {
      calls.push(["stage", input]);
      return { ok: true, outcome: input.outcome };
    }
  }).map((tool) => [tool.name, tool]));

  assert.equal(tools.desktop_spawn_subagent.source, "local");
  assert.deepEqual(
    await tools.desktop_handoff_role.handler({ role: "implementer", summary: "Plan ready" }),
    { ok: true, role: "implementer" }
  );
  const spawned = await tools.desktop_spawn_subagent.handler({
    objective: "Fix the receipt test",
    name: "receipt-test"
  });
  assert.equal(spawned.workspace_mode, "new_worktree");
  assert.equal((await tools.desktop_collect_subagent.handler({ task_id: "child-1" })).task_id, "child-1");
  assert.deepEqual(
    await tools.desktop_report_coding_stage.handler({
      outcome: "plan_ready",
      summary: "Plan ready",
      evidence: ["Inspected the relevant files"]
    }),
    { ok: true, outcome: "plan_ready" }
  );
  assert.deepEqual(calls[1][1].role, "implementer");
  assert.equal(calls.at(-1)[0], "stage");
});
