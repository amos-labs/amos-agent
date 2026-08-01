import test from "node:test";
import assert from "node:assert/strict";
import { DesktopController } from "../src/desktop/controller.js";
import {
  onlineTaskSource,
  TaskCheckpointStore
} from "../src/desktop/taskCheckpoint.js";
import {
  continuityScope,
  SessionContinuityStore
} from "../src/desktop/sessionContinuity.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function settingsStore() {
  const value = {
    operatingMode: "online",
    amosMcpUrl: "https://app.amoslabs.com/mcp",
    workspace: "/tmp/amos-workspace"
  };
  return {
    read: async () => value,
    write: async () => value
  };
}

async function continuityStore() {
  const root = await mkdtemp(join(tmpdir(), "amos-controller-continuity-"));
  return new SessionContinuityStore({
    filePath: join(root, "continuity.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  });
}

function identity(overrides = {}) {
  return {
    principal_type: "user",
    sub: "user-1",
    tenant_id: "tenant-1",
    tenant_slug: "northwind",
    role: "owner",
    ...overrides
  };
}

function snapshot(customers = 12) {
  return {
    generated_at: "2026-07-26T10:00:00.000Z",
    identity: { company: "Northwind" },
    company_state: { customers },
    authority: { role: "owner" }
  };
}

async function checkpointStore() {
  const root = await mkdtemp(join(tmpdir(), "amos-controller-task-"));
  return new TaskCheckpointStore({
    filePath: join(root, "tasks.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
    createId: () => "task-1"
  });
}

test("desktop revalidates interrupted work and only loads a continuation prompt", async () => {
  const taskStore = await checkpointStore();
  const checkpoint = await taskStore.start({
    objective: "Improve qualified signups",
    source: onlineTaskSource({ identity: identity(), snapshot: snapshot() })
  });
  await taskStore.update(checkpoint.id, {
    status: "interrupted",
    completedStep: "Completed inspect_campaign"
  });
  const emitted = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-task",
    settingsStore: settingsStore(),
    taskCheckpointStore: taskStore,
    openBrowser: async () => {},
    emit: (channel, payload) => emitted.push({ channel, payload })
  });
  controller.personalRemote = async () => ({
    identity: async () => identity(),
    companySnapshot: async () => snapshot(14),
    approvals: async () => ({
      available: true,
      pending_operations: [{ status: "pending" }]
    })
  });

  const result = await controller.prepareTaskCheckpoint(checkpoint.id);
  assert.equal(result.executionStarted, false);
  assert.match(result.prompt, /fresh validation/i);
  assert.match(result.prompt, /Do not repeat an action/i);
  assert.deepEqual(result.checkpoint.reconciliation.changedSections, ["company_state"]);
  assert.equal(result.checkpoint.reconciliation.pendingApprovalCount, 1);
  assert.ok(emitted.some((event) => event.channel === "task-checkpoints:changed"));
});

test("desktop cancellation aborts the active task signal and pending local approval", async () => {
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-cancel",
    settingsStore: settingsStore(),
    openBrowser: async () => {},
    emit: () => {}
  });
  const abortController = new AbortController();
  controller.activeTask = {
    id: "task-2",
    abortController,
    checkpointed: false,
    acceptingSteering: true,
    phase: "acting",
    summary: "Running work"
  };
  const result = await controller.cancelTask("task-2");
  assert.equal(result.canceled, true);
  assert.equal(abortController.signal.aborted, true);
});

test("desktop queues user steering on the active task and records the direction", async () => {
  const emitted = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-steer",
    settingsStore: settingsStore(),
    openBrowser: async () => {},
    emit: (channel, payload) => emitted.push({ channel, payload })
  });
  controller.activeTask = {
    id: "task-steer",
    abortController: new AbortController(),
    checkpointed: false,
    acceptingSteering: true,
    objective: "Inspect issue 312",
    steeringQueue: [],
    steeringCount: 0,
    receiptEvents: [],
    phase: "acting",
    summary: "Inspecting the issue"
  };

  const result = await controller.steerTask(
    "task-steer",
    "Also compare the Plumbline release."
  );

  assert.equal(result.queued, true);
  assert.equal(controller.activeTask.steeringQueue.length, 1);
  assert.equal(
    controller.activeTask.steeringQueue[0].content,
    "Also compare the Plumbline release."
  );
  assert.match(controller.activeTask.objective, /User steering/);
  assert.ok(
    emitted.some(
      (event) =>
        event.channel === "agent:event" &&
        event.payload.phase === "steering_queued"
    )
  );
});

test("desktop demo skips user-bound restart checkpoints without blocking the task", async () => {
  const taskStore = await checkpointStore();
  const emitted = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-demo-task",
    settingsStore: settingsStore(),
    taskCheckpointStore: taskStore,
    openBrowser: async () => {},
    emit: (channel, payload) => emitted.push({ channel, payload })
  });
  controller.oauthFor = () => ({
    status: async () => ({
      access_token: "demo-token",
      demo: true,
      expires_at: Date.now() + 60_000
    })
  });
  controller.activeTask = {
    id: "demo-task-1",
    abortController: new AbortController(),
    checkpointed: false,
    phase: "starting",
    summary: "Preparing the task"
  };

  const result = await controller.startOnlineTaskCheckpoint({
    id: "demo-task-1",
    prompt: "Brief me on Northwind",
    references: [],
    settings: await settingsStore().read()
  });

  assert.equal(result, null);
  assert.equal(controller.activeTask.checkpointed, false);
  assert.deepEqual(await taskStore.list(), []);
  assert.ok(
    emitted.some(
      (event) =>
        event.channel === "agent:event" &&
        event.payload.phase === "checkpoint_unavailable" &&
        /Short-lived demo tasks/.test(event.payload.summary)
    )
  );
});

test("desktop rehydrates only the matching user, tenant, and workspace continuity", async () => {
  const store = await continuityStore();
  const settings = await settingsStore().read();
  const matchingScope = continuityScope({
    identity: identity(),
    boundary: "online",
    workspace: settings.workspace
  });
  await store.appendTurn(matchingScope, {
    objective: "Fix the download page",
    answer: "Updated amos-website/app/downloads/page.tsx",
    artifacts: ["amos-website/app/downloads/page.tsx"]
  });
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-continuity",
    settingsStore: settingsStore(),
    sessionContinuityStore: store,
    openBrowser: async () => {},
    emit: () => {}
  });
  controller.identity = identity();
  let restored = "";
  const runtimeState = {
    runtime: {
      loop: {
        restoreContinuity(value) {
          restored = value;
          return true;
        }
      }
    }
  };

  const record = await controller.hydrateSessionContinuity(
    settings,
    "online",
    runtimeState
  );
  assert.equal(record.turns.length, 1);
  assert.match(restored, /amos-website\/app\/downloads\/page\.tsx/);
  assert.match(restored, /Reinspect the listed local artifacts/i);

  controller.identity = identity({ tenant_id: "tenant-2" });
  const otherRuntime = { runtime: { loop: { restoreContinuity: () => true } } };
  assert.equal(
    await controller.hydrateSessionContinuity(settings, "online", otherRuntime),
    null
  );
});
