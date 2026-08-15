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
import { DesktopTaskStore, taskOwnerScope } from "../src/desktop/taskStore.js";
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

test("desktop manages private Projects and cooperative task-run stops through Platform", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const runId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const project = {
    id: projectId,
    name: "Neighborly rollout",
    maxParallelRuns: 4,
    defaultBudget: {},
    status: "active"
  };
  const remote = {
    async createProject(input) {
      calls.push(["create", input]);
      return { project };
    },
    async updateProject(id, changes) {
      calls.push(["update", id, changes]);
      return { project: { ...project, pinned: true }, changed: ["pinned"] };
    },
    async cancelTaskRun(id, reason) {
      calls.push(["cancel", id, reason]);
      return {
        run: {
          id,
          projectId,
          taskId: "33333333-3333-4333-8333-333333333333",
          stopReason: reason
        }
      };
    },
    async projectsLibrary() {
      return {
        supported: true,
        projects: [project],
        inbox: [],
        stalledCount: 0,
        projectContract: { execution_authority: false },
        runContract: { execution_proof: false }
      };
    }
  };
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-projects",
    settingsStore: settingsStore(),
    openBrowser: async () => {},
    emit: () => {}
  });
  controller.personalRemote = async () => remote;
  controller.sendRemoteState = async () => {};

  const created = await controller.createProject({ name: project.name, maxParallelRuns: 4 });
  const updated = await controller.updateProjectResource(projectId, { pinned: true });
  const stopped = await controller.cancelSupervisedTaskRun(runId, "operator_requested");

  assert.equal(created.projects.supported, true);
  assert.equal(updated.project.pinned, true);
  assert.equal(stopped.run.stopReason, "operator_requested");
  assert.deepEqual(calls, [
    ["create", { name: project.name, maxParallelRuns: 4 }],
    ["update", projectId, { pinned: true }],
    ["cancel", runId, "operator_requested"]
  ]);
  assert.equal(controller.activity.at(-1).detail.cooperative, true);
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

test("desktop prefers a newer tenant-private checkpoint from another client", async () => {
  const store = await continuityStore();
  const settings = await settingsStore().read();
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-shared-continuity",
    settingsStore: settingsStore(),
    sessionContinuityStore: store,
    openBrowser: async () => {},
    emit: () => {}
  });
  controller.identity = identity();
  controller.workingContinuity = {
    supported: true,
    available: true,
    sourceClient: "claude_code",
    manifest: {
      format: "amos.continuity_manifest",
      version: 1,
      revision: 2,
      scope: {
        boundary: "online",
        tenantId: "tenant-1",
        contextKey: "active",
        workspaceHint: "neighborly-demo"
      },
      updatedAt: "2026-08-03T10:00:00.000Z",
      transitions: [{
        at: "2026-08-03T10:00:00.000Z",
        status: "completed",
        objective: "Continue the Neighborly demo",
        outcome: "The Nuvola course is ready for review",
        actions: [],
        decisions: [],
        commitments: [],
        corrections: [],
        openLoops: [],
        artifacts: []
      }],
      handoffs: [],
      artifacts: [],
      safeguards: {
        orientationOnly: true,
        requiresFreshAuthority: true,
        replayAllowed: false
      }
    }
  };
  let prompt = "";
  const runtimeState = {
    runtime: { loop: { restoreContinuity(value) { prompt = value; return true; } } }
  };

  const restored = await controller.hydrateSessionContinuity(
    settings,
    "online",
    runtimeState
  );
  assert.equal(restored.source, "shared");
  assert.match(prompt, /Continue the Neighborly demo/);
  assert.match(prompt, /not a filesystem grant/);
});

test("typed consultative confirm is an application operation, not renderer inference", async () => {
  const store = await continuityStore();
  const settings = await settingsStore().read();
  const currentScope = continuityScope({
    identity: identity(),
    boundary: "online",
    workspace: settings.workspace
  });
  await store.appendTurn(currentScope, {
    eventId: "turn:one",
    objective: "Inspect Stripe and QBO",
    answer: "Mapped the current invoice path",
    consultativeState: {
      objective: {
        id: "obj-1",
        kind: "objective",
        statement: "Stop duplicate books",
        status: "inferred",
        source: "inference",
        sourceEventId: "turn:one",
        observedAt: "2026-08-14T12:00:00.000Z",
        confidence: 0.7
      }
    }
  });
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-consultative-confirm",
    settingsStore: settingsStore(),
    sessionContinuityStore: store,
    openBrowser: async () => {},
    emit: () => {}
  });
  controller.identity = identity();
  controller.sendRemoteState = async () => {};
  let captured = null;
  controller.captureSharedConsultativeState = async (_settings, record) => {
    captured = record;
    return { supported: true, available: true, revision: 2 };
  };
  controller.workingContinuity = { revision: 1, available: true };

  const confirmed = await controller.confirmConsultativeAssertion({ assertionId: "obj-1" });
  assert.equal(confirmed.consultativeState.objective.status, "confirmed");
  assert.equal(confirmed.consultativeState.objective.source, "application");
  assert.equal(captured.consultativeState.objective.status, "confirmed");
});

test("propose then confirm survives a later completed turn", async () => {
  const store = await continuityStore();
  const settings = await settingsStore().read();
  const currentScope = continuityScope({
    identity: identity(),
    boundary: "online",
    workspace: settings.workspace
  });
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-consultative-e2e",
    settingsStore: settingsStore(),
    sessionContinuityStore: store,
    openBrowser: async () => {},
    emit: () => {}
  });
  controller.identity = identity();
  controller.sendRemoteState = async () => {};
  controller.captureSharedConsultativeState = async (_settings, record) => {
    return { supported: true, available: true, revision: record.revision, manifest: record.manifest };
  };
  controller.workingContinuity = { revision: 0, available: false };

  const proposed = await controller.proposeConsultativeUpdate({
    objective: { statement: "Stop duplicate books", confidence: 0.8 }
  });
  assert.equal(proposed.consultativeState.objective.status, "inferred");
  assert.ok(proposed.consultativeState.objective.sourceEventId);
  assert.ok(proposed.consultativeState.objective.observedAt);

  const confirmed = await controller.confirmConsultativeAssertion({
    assertionId: proposed.consultativeState.objective.id
  });
  assert.equal(confirmed.consultativeState.objective.status, "confirmed");

  await controller.saveSessionContinuity({
    settings,
    boundary: "online",
    objective: "Recommend the next move",
    answer: "Recommended a governed customer-identity rule",
    artifacts: [],
    receipt: null
  });
  const afterTurn = await store.load(currentScope);
  assert.equal(afterTurn.consultativeState.objective.status, "confirmed");
  assert.equal(afterTurn.turns.length, 1);

  const runtimeState = {
    runtime: { loop: { restoreContinuity() { return true; } } }
  };
  const restored = await controller.hydrateSessionContinuity(settings, "online", runtimeState);
  assert.equal(
    restored.consultativeState?.objective?.status || restored.manifest?.consultativeState?.objective?.status,
    "confirmed"
  );
});

test("consultative mutations project an operating-plan canvas and honor reject/reopen", async () => {
  const store = await continuityStore();
  const events = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-consultative-canvas",
    settingsStore: settingsStore(),
    sessionContinuityStore: store,
    openBrowser: async () => {},
    emit(channel, payload) {
      events.push({ channel, payload });
    }
  });
  controller.identity = identity();
  controller.sendRemoteState = async () => {};
  controller.captureSharedConsultativeState = async (_settings, record) => ({
    supported: true,
    available: true,
    revision: record.revision,
    manifest: record.manifest
  });
  controller.workingContinuity = { revision: 0, available: false };

  const proposed = await controller.proposeConsultativeUpdate({
    objective: { statement: "Stop duplicate books", confidence: 0.8 },
    assertions: [{
      kind: "system",
      statement: "QBO owns the ledger",
      confidence: 0.7
    }]
  });
  const plan = controller.canvases.list().find((canvas) =>
    canvas.blocks.some((block) => block.type === "operating_plan")
  );
  assert.ok(plan);
  assert.equal(plan.title, "Operating plan");
  assert.ok(events.some((event) => event.channel === "canvas:changed"));
  const objectiveId = proposed.consultativeState.objective.id;
  const confirmed = await controller.confirmConsultativeAssertion({ assertionId: objectiveId });
  assert.equal(confirmed.consultativeState.objective.status, "confirmed");
  const confirmedItem = controller.canvases.active().blocks[0].sections
    .flatMap((section) => section.items)
    .find((item) => item.id === objectiveId);
  assert.equal(confirmedItem.status, "confirmed");
  assert.deepEqual(confirmedItem.actions, ["correct", "reopen"]);

  const rejected = await controller.rejectConsultativeAssertion({
    assertionId: proposed.consultativeState.currentState.systems[0].id
  });
  assert.equal(rejected.consultativeState.currentState.systems[0].status, "superseded");
  const reopened = await controller.reopenConsultativeAssertion({
    assertionId: objectiveId
  });
  assert.equal(reopened.consultativeState.objective.status, "inferred");
  assert.equal(reopened.consultativeState.objective.source, "user");
});

test("openTask applies newer shared continuity before canvas actions", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-controller-shared-open-"));
  const settings = settingsStore();
  const currentSettings = await settings.read();
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  });
  const store = new SessionContinuityStore({
    filePath: join(root, "continuity.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
    now: () => new Date("2026-08-14T12:00:00.000Z")
  });
  const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const owner = taskOwnerScope({
    identity: identity(),
    boundary: "online",
    workspace: currentSettings.workspace
  });
  await tasks.create(owner, {
    id: taskId,
    remoteId: taskId,
    contextKey: "task:consultative",
    title: "Invoice path",
    objective: "Inspect Stripe and QBO",
    workspaceMode: "context_only"
  });
  const localScope = continuityScope({
    identity: identity(),
    boundary: "online",
    workspace: currentSettings.workspace,
    contextKey: "task:consultative"
  });
  await store.appendTurn(localScope, {
    eventId: "turn:local",
    objective: "Inspect Stripe and QBO",
    answer: "Local stale snapshot",
    consultativeState: {
      objective: {
        id: "obj-local",
        kind: "objective",
        statement: "Stale local books",
        status: "inferred",
        source: "inference",
        sourceEventId: "turn:local",
        observedAt: "2026-08-14T12:00:00.000Z",
        confidence: 0.7
      }
    }
  });
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settings,
    sessionContinuityStore: store,
    taskStore: tasks,
    openBrowser: async () => {},
    emit: () => {}
  });
  controller.identity = identity();
  controller.sendRemoteState = async () => {};
  let captured = null;
  controller.captureSharedConsultativeState = async (_settings, record) => {
    captured = record;
    return {
      supported: true,
      available: true,
      revision: 6,
      manifest: record.manifest
    };
  };
  controller.personalRemote = async () => ({
    resumeTask: async () => ({
      task: { id: taskId },
      continuity: {
        supported: true,
        available: true,
        revision: 5,
        manifest: {
          format: "amos.continuity_manifest",
          version: 1,
          revision: 5,
          scope: {
            boundary: "online",
            tenantId: "tenant-1",
            contextKey: "task:consultative",
            workspaceHint: "workspace"
          },
          updatedAt: "2026-08-14T13:00:00.000Z",
          transitions: [{
            at: "2026-08-14T13:00:00.000Z",
            status: "completed",
            objective: "Inspect Stripe and QBO",
            outcome: "Newer shared snapshot"
          }],
          consultativeState: {
            schemaVersion: 1,
            status: "active",
            objective: {
              id: "obj-shared",
              kind: "objective",
              statement: "Newer shared books",
              status: "inferred",
              source: "inference",
              sourceEventId: "turn:shared",
              observedAt: "2026-08-14T13:00:00.000Z",
              confidence: 0.8
            },
            currentState: {
              systems: [{
                id: "sys-shared",
                kind: "system",
                statement: "Stripe is cash authority",
                status: "inferred",
                source: "inference",
                sourceEventId: "turn:shared",
                observedAt: "2026-08-14T13:00:00.000Z",
                confidence: 0.7
              }]
            }
          },
          safeguards: {
            orientationOnly: true,
            requiresFreshAuthority: true,
            replayAllowed: false,
            clientReported: true,
            credentialsIncluded: false,
            companyMemory: false
          }
        }
      },
      events: [],
      children: []
    })
  });

  await controller.openTask(taskId);
  const plan = controller.canvases.list().find((canvas) =>
    canvas.blocks.some((block) => block.type === "operating_plan")
  );
  const statements = plan.blocks[0].sections.flatMap((section) =>
    section.items.map((item) => item.statement)
  );
  assert.ok(statements.includes("Newer shared books"));
  assert.ok(statements.includes("Stripe is cash authority"));
  assert.equal(statements.includes("Stale local books"), false);

  const confirmed = await controller.confirmConsultativeAssertion({ assertionId: "obj-shared" });
  assert.equal(confirmed.consultativeState.objective.statement, "Newer shared books");
  assert.equal(confirmed.consultativeState.currentState.systems[0].id, "sys-shared");
  assert.equal(captured.consultativeState.currentState.systems[0].statement, "Stripe is cash authority");
  assert.equal(captured.consultativeState.objective.status, "confirmed");
});

test("desktop automatically offers completed online state to the shared continuity lane", async () => {
  const store = await continuityStore();
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-continuity-capture",
    settingsStore: settingsStore(),
    sessionContinuityStore: store,
    openBrowser: async () => {},
    emit: () => {}
  });
  controller.identity = identity();
  let captured = null;
  controller.captureSharedContinuity = async (_settings, record) => {
    captured = record;
    return { supported: true, available: true };
  };

  await controller.saveSessionContinuity({
    settings: await settingsStore().read(),
    boundary: "online",
    objective: "Prepare the demo",
    answer: "The course view is ready",
    artifacts: ["demo/course-42"],
    receipt: null
  });
  assert.equal(captured.manifest.transitions.at(-1).objective, "Prepare the demo");
});

test("clear session removes local and shared continuity without resurrecting either", async () => {
  const store = await continuityStore();
  const settings = await settingsStore().read();
  const currentIdentity = identity();
  const currentScope = continuityScope({
    identity: currentIdentity,
    boundary: "online",
    workspace: settings.workspace
  });
  await store.appendTurn(currentScope, {
    objective: "Private task",
    answer: "Private outcome"
  });
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-continuity-clear",
    settingsStore: settingsStore(),
    sessionContinuityStore: store,
    openBrowser: async () => {},
    emit: () => {}
  });
  controller.identity = currentIdentity;
  controller.workingContinuity = { available: true, manifest: { scope: {} } };
  let sharedClearCalled = false;
  controller.clearSharedContinuity = async () => {
    sharedClearCalled = true;
    return { attempted: true, supported: true, available: false, cleared: true };
  };
  let loopCleared = false;
  controller.runtime = {
    continuityKey: "old-checkpoint",
    runtime: { loop: { clear() { loopCleared = true; } } }
  };

  const result = await controller.clear();
  assert.equal(result.ok, true);
  assert.equal(result.sharedContinuity.cleared, true);
  assert.equal(sharedClearCalled, true);
  assert.equal(loopCleared, true);
  assert.equal(controller.runtime.continuityKey, null);
  assert.equal(controller.workingContinuity, null);
  assert.equal(await store.load(currentScope), null);

  await store.appendTurn(currentScope, {
    objective: "Second private task",
    answer: "Second private outcome"
  });
  controller.clearSharedContinuity = async () => {
    throw new Error("platform unavailable");
  };
  const degraded = await controller.clear();
  assert.equal(degraded.ok, true);
  assert.match(degraded.sharedContinuity.error, /platform unavailable/);
  assert.equal(await store.load(currentScope), null);
});
