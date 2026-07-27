import test from "node:test";
import assert from "node:assert/strict";
import { DesktopController } from "../src/desktop/controller.js";
import {
  onlineTaskSource,
  TaskCheckpointStore
} from "../src/desktop/taskCheckpoint.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function settingsStore() {
  const value = {
    operatingMode: "online",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  };
  return {
    read: async () => value,
    write: async () => value
  };
}

function identity() {
  return {
    principal_type: "user",
    sub: "user-1",
    tenant_id: "tenant-1",
    tenant_slug: "northwind",
    role: "owner"
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
    phase: "acting",
    summary: "Running work"
  };
  const result = await controller.cancelTask("task-2");
  assert.equal(result.canceled, true);
  assert.equal(abortController.signal.aborted, true);
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
