import assert from "node:assert/strict";
import test from "node:test";

import { DesktopRunManager, DesktopRunSupervisor } from "../src/desktop/runManager.js";

test("DesktopRunManager executes isolated lanes concurrently", async () => {
  let nextId = 0;
  const manager = new DesktopRunManager({ createId: () => `run-${++nextId}` });
  const gates = new Map();
  const observed = [];

  const launched = [1, 2, 3, 4].map((number) => manager.launch({
    taskRecordId: `task-${number}`,
    contextKey: `task:task-${number}`,
    marker: number
  }, async (lane) => {
    assert.equal(manager.current(), lane);
    observed.push(`start:${lane.marker}`);
    await new Promise((resolve) => gates.set(lane.id, resolve));
    observed.push(`finish:${manager.current().marker}`);
    return lane.marker;
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.active().length, 4);
  assert.deepEqual(observed, ["start:1", "start:2", "start:3", "start:4"]);
  for (const { lane } of launched.reverse()) gates.get(lane.id)();
  assert.deepEqual((await Promise.all(launched.map(({ promise }) => promise))).sort(), [1, 2, 3, 4]);
  assert.deepEqual(observed.slice(4), ["finish:4", "finish:3", "finish:2", "finish:1"]);
});

test("DesktopRunManager targets cancellation and rejects duplicate task workers", async () => {
  const manager = new DesktopRunManager();
  const abortController = new AbortController();
  const first = manager.launch({
    id: "run-one",
    taskRecordId: "task-one",
    contextKey: "task:task-one",
    abortController
  }, async () => new Promise((_resolve, reject) => {
    abortController.signal.addEventListener("abort", () => {
      const error = new Error("Task canceled");
      error.code = "AMOS_TASK_CANCELED";
      reject(error);
    }, { once: true });
  }));

  assert.throws(() => manager.launch({
    id: "run-two",
    taskRecordId: "task-one",
    contextKey: "task:task-one"
  }, async () => {}), /already has a running Desktop worker/);
  abortController.abort();
  await assert.rejects(first.promise, /Task canceled/);
  assert.equal(manager.get("run-one").status, "cancelled");
});

test("DesktopRunSupervisor admits once and reports cumulative bounded usage", async () => {
  const reports = [];
  let heartbeat = null;
  const remote = {
    async startTaskRun(input) {
      assert.equal(input.sourceClient, "amos_desktop");
      return {
        accepted: true,
        continue: true,
        run: { id: "platform-run", sequence: 0, status: "running" }
      };
    },
    async reportTaskRun(input) {
      reports.push(input);
      return {
        accepted: true,
        continue: true,
        run: { id: "platform-run", sequence: input.sequence, status: input.status }
      };
    }
  };
  const supervisor = new DesktopRunSupervisor({
    remote,
    abortController: new AbortController(),
    reportThrottleMs: 60_000,
    now: () => 1,
    setIntervalImpl: (callback) => {
      heartbeat = callback;
      return { unref() {} };
    },
    clearIntervalImpl: () => {}
  });

  await supervisor.admit({ sourceClient: "amos_desktop" });
  supervisor.observe({ type: "usage", totalTokens: 7 });
  supervisor.observe({ type: "usage", totalTokens: 5 });
  supervisor.observe({ type: "tool_end", name: "read_file" });
  await supervisor.finish("completed", "Finished safely");

  assert.equal(typeof heartbeat, "function");
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], {
    runId: "platform-run",
    sequence: 1,
    status: "completed",
    phase: "starting",
    progressSummary: "Preparing the task",
    resultSummary: "Finished safely",
    tokensUsed: 12,
    costUsedMicrousd: 0,
    toolCallsUsed: 1
  });
});

test("DesktopRunSupervisor recovers after a transient report failure and honors stop", async () => {
  const abortController = new AbortController();
  let attempt = 0;
  const supervisor = new DesktopRunSupervisor({
    abortController,
    reportThrottleMs: 0,
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
    remote: {
      async startTaskRun() {
        return {
          accepted: true,
          continue: true,
          run: { id: "platform-run", sequence: 0, status: "running" }
        };
      },
      async reportTaskRun(input) {
        attempt += 1;
        if (attempt === 1) throw new Error("temporary network failure");
        return {
          accepted: true,
          continue: false,
          run: { id: "platform-run", sequence: input.sequence, status: "cancel_requested" }
        };
      }
    }
  });

  await supervisor.admit({});
  await assert.rejects(supervisor.report("running"), /temporary network failure/);
  await supervisor.report("running");
  assert.equal(attempt, 2);
  assert.equal(abortController.signal.aborted, true);
  assert.equal(supervisor.stopReason, "run_stop_requested");
});

test("DesktopRunSupervisor preserves an exact Platform budget stop reason", async () => {
  const abortController = new AbortController();
  const supervisor = new DesktopRunSupervisor({
    abortController,
    reportThrottleMs: 0,
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
    remote: {
      async startTaskRun() {
        return {
          accepted: true,
          continue: true,
          run: { id: "platform-run", sequence: 0, status: "running" }
        };
      },
      async reportTaskRun(input) {
        return {
          accepted: true,
          continue: false,
          reason: "wall_time_budget_exhausted",
          run: {
            id: "platform-run",
            sequence: input.sequence,
            status: "interrupted",
            stopReason: "wall_time_budget_exhausted"
          }
        };
      }
    }
  });

  await supervisor.admit({});
  await supervisor.report("running");
  assert.equal(supervisor.stopReason, "wall_time_budget_exhausted");
  assert.equal(abortController.signal.reason, "wall_time_budget_exhausted");
});

test("four Desktop workers run concurrently under two independent Project limits", async () => {
  const manager = new DesktopRunManager({ maxRuns: 8 });
  const running = new Map();
  const maximum = new Map();
  const gates = new Map();
  let nextPlatformRun = 0;
  const remote = {
    async startTaskRun(input) {
      const count = running.get(input.projectId) || 0;
      if (count >= 2) return { accepted: false, continue: false, run: null };
      running.set(input.projectId, count + 1);
      maximum.set(input.projectId, Math.max(maximum.get(input.projectId) || 0, count + 1));
      return {
        accepted: true,
        continue: true,
        run: {
          id: `platform-run-${++nextPlatformRun}`,
          projectId: input.projectId,
          sequence: 0,
          status: "running"
        }
      };
    },
    async reportTaskRun(input) {
      const lane = manager.nonTerminal().find((item) => item.platformRunId === input.runId);
      if (["completed", "failed", "cancelled", "interrupted"].includes(input.status)) {
        running.set(lane.projectId, (running.get(lane.projectId) || 1) - 1);
      }
      return {
        accepted: true,
        continue: true,
        run: {
          id: input.runId,
          projectId: lane.projectId,
          sequence: input.sequence,
          status: input.status
        }
      };
    }
  };

  const launched = [
    ["project-a", "task-a1"],
    ["project-a", "task-a2"],
    ["project-b", "task-b1"],
    ["project-b", "task-b2"]
  ].map(([projectId, taskRecordId]) => manager.launch({
    projectId,
    taskRecordId,
    contextKey: `task:${taskRecordId}`
  }, async (lane) => {
    lane.abortController = new AbortController();
    lane.supervisor = new DesktopRunSupervisor({
      remote,
      abortController: lane.abortController,
      reportThrottleMs: 60_000,
      setIntervalImpl: () => ({ unref() {} }),
      clearIntervalImpl: () => {}
    });
    const admitted = await lane.supervisor.admit({
      projectId,
      sourceClient: "amos_desktop"
    });
    lane.platformRunId = admitted.run.id;
    await new Promise((resolve) => gates.set(lane.id, resolve));
    await lane.supervisor.finish("completed", "done");
  }));

  while (gates.size < 4) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.active().length, 4);
  assert.deepEqual(Object.fromEntries(maximum), { "project-a": 2, "project-b": 2 });
  for (const { lane } of launched) gates.get(lane.id)();
  await Promise.all(launched.map(({ promise }) => promise));
  assert.deepEqual(Object.fromEntries(running), { "project-a": 0, "project-b": 0 });
});
