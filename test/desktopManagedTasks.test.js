import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DesktopController,
  missionCompileAmosClient,
  missionCreationOutcome
} from "../src/desktop/controller.js";
import {
  channelAvailability,
  defaultMissionChannels,
  emptyNotificationPreferences,
  normalizeNotificationPreferences
} from "../src/desktop/missionNotifications.js";
import { continuityScope, SessionContinuityStore } from "../src/desktop/sessionContinuity.js";
import { DesktopTaskStore, taskOwnerScope } from "../src/desktop/taskStore.js";

function codec() {
  return {
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  };
}

function settingsStore(workspace) {
  let value = {
    operatingMode: "personal",
    workspace,
    provider: "ollama",
    model: "qwen",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    reasoningEffort: "medium",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  };
  return {
    async read() { return { ...value }; },
    async write(next) { value = { ...next }; return { ...value }; }
  };
}

test("a new conversation opens without a prompt and adopts its first objective", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-new-conversation-"));
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });
  const settings = settingsStore(root);
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settings,
    taskStore: tasks,
    openBrowser() {},
    emit() {}
  });
  controller.sendRemoteState = async () => {};
  controller.state = async () => ({
    activeContextKey: controller.activeContextKey,
    activeTaskRecordId: controller.activeTaskRecordId
  });

  const opened = await controller.startNewConversation({ kind: "general" });
  assert.equal(opened.launch.title, "New conversation");
  assert.equal(opened.launch.objective, "Start a new conversation with AMOS.");

  await controller.adoptConversationObjective(
    "Research the multi-location enterprise market and identify the strongest wedge",
    await settings.read()
  );
  const owner = taskOwnerScope({ boundary: "personal", workspace: root });
  const [conversation] = await tasks.list(owner);
  assert.equal(
    conversation.title,
    "Research the multi-location enterprise market and identify the strongest wedge"
  );
  assert.equal(
    conversation.objective,
    "Research the multi-location enterprise market and identify the strongest wedge"
  );
});

test("an ordinary first message materializes a durable conversation and exposes typed fork state", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-auto-conversation-"));
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });
  const continuity = new SessionContinuityStore({
    filePath: join(root, "continuity.json"),
    ...codec(),
    now: () => new Date("2026-08-10T12:01:00.000Z")
  });
  const settings = settingsStore(root);
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settings,
    taskStore: tasks,
    sessionContinuityStore: continuity,
    openBrowser() {},
    emit() {}
  });
  controller.executeRun = async () => ({ answer: "Hello", taskEventId: "run:test" });

  const result = await controller.run({ text: "Hello AMOS" });
  const owner = taskOwnerScope({ boundary: "personal", workspace: root });
  const [conversation] = await tasks.list(owner);
  assert.equal(conversation.objective, "Hello AMOS");
  assert.equal(controller.activeTaskRecordId, conversation.id);
  assert.equal(result.taskRecordId, conversation.id);

  let library = await controller.tasksState(await settings.read());
  assert.deepEqual(library.activeForkCapability, {
    canFork: false,
    reason: "no_persisted_milestone",
    latestMilestoneId: "",
    milestoneCount: 0
  });

  await continuity.appendTurn(
    continuityScope({
      boundary: "personal",
      workspace: root,
      contextKey: conversation.contextKey
    }),
    {
      eventId: "turn:hello",
      objective: "Hello AMOS",
      answer: "Hello"
    }
  );
  library = await controller.tasksState(await settings.read());
  assert.deepEqual(library.activeForkCapability, {
    canFork: true,
    reason: "ready",
    latestMilestoneId: "turn:hello",
    milestoneCount: 1
  });
});

test("Desktop opens and forks durable tasks without replaying a model or tool call", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-managed-tasks-"));
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });
  const continuity = new SessionContinuityStore({
    filePath: join(root, "continuity.json"),
    ...codec(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });
  const settings = settingsStore(root);
  const owner = taskOwnerScope({ boundary: "personal", workspace: root });
  const parentId = "11111111-1111-4111-8111-111111111111";
  const parentContext = `task:${parentId}`;
  const canvas = {
    id: "canvas-1",
    version: "1",
    title: "Scorecard",
    subtitle: "",
    generatedAt: "2026-08-10T12:00:00.000Z",
    state: { kind: "ready", message: "" },
    source: {
      kind: "local",
      label: "Test",
      refreshedAt: "2026-08-10T12:00:00.000Z",
      staleAt: "",
      references: []
    },
    blocks: [{
      id: "note",
      type: "markdown",
      title: "",
      content: "Deterministic result",
      provenance: { kind: "local", observedAt: "2026-08-10T12:00:00.000Z", references: [] }
    }],
    revision: 1,
    presentedAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z"
  };
  await tasks.create(owner, {
    id: parentId,
    contextKey: parentContext,
    title: "Neighborly scorecard",
    objective: "Find the KPI gap",
    workspace: { localPath: root, label: "managed-tasks" },
    canvasState: { activeCanvasId: canvas.id, canvases: [canvas] }
  });
  const parentContinuity = continuityScope({
    boundary: "personal",
    workspace: root,
    contextKey: parentContext
  });
  await continuity.appendTurn(parentContinuity, {
    eventId: "turn:kpi-gap",
    objective: "Find the KPI gap",
    answer: "The margin gap is concentrated in seven locations"
  });

  let modelRuns = 0;
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settings,
    taskStore: tasks,
    sessionContinuityStore: continuity,
    openBrowser() {},
    emit() {}
  });
  controller.sendRemoteState = async () => {};
  controller.state = async () => ({
    activeContextKey: controller.activeContextKey,
    activeTaskRecordId: controller.activeTaskRecordId,
    sessionContinuity: await controller.sessionContinuityState(),
    ...controller.canvases.state()
  });
  controller.getRuntime = async () => {
    modelRuns += 1;
    throw new Error("model must not run during task navigation");
  };

  await assert.rejects(
    controller.forkTaskResource({
      taskId: parentId,
      name: "Invalid milestone",
      objective: "This must not fork",
      sourceEventId: "turn:not-present",
      contextScope: "from_here",
      workspaceMode: "context_only"
    }),
    /milestone is no longer available/
  );

  const opened = await controller.openTask(parentId);
  assert.equal(opened.replayed, false);
  assert.equal(controller.canvases.active().title, "Scorecard");
  assert.equal(modelRuns, 0);

  const originalRun = controller.runManager.launch({
    id: "run-original",
    taskRecordId: parentId,
    contextKey: parentContext,
    settings: await settings.read(),
    activeContextKey: parentContext,
    activeTaskRecordId: parentId,
    activity: controller.activity,
    attachments: controller.attachments,
    canvases: controller.canvases,
    canvasResults: controller.canvasResults,
    approvals: controller.approvals,
    activeTask: {
      id: "run-original",
      startedAt: "2026-08-10T12:01:00.000Z",
      objective: "Keep researching",
      phase: "thinking"
    }
  }, async () => new Promise(() => {}));
  controller.runManager.select(originalRun.lane.id);
  controller.runManager.transition(originalRun.lane.id, "running", {
    phase: "thinking",
    summary: "Continuing the original task"
  });

  const forked = await controller.forkTaskResource({
    taskId: parentId,
    name: "Margin intervention",
    objective: "Design the location intervention",
    sourceEventId: "turn:kpi-gap",
    contextScope: "from_here",
    workspaceMode: "context_only"
  });

  assert.equal(forked.replayed, false);
  assert.equal(forked.continuedInBackground, true);
  assert.equal(controller.runManager.get(originalRun.lane.id).status, "running");
  assert.equal(forked.task.parentTaskId, parentId);
  assert.equal(forked.task.workspaceMode, "context_only");
  assert.equal(forked.forkManifest.safeguards.replayAllowed, false);
  assert.equal(controller.activeTaskRecordId, forked.task.id);
  assert.equal(controller.canvases.active().title, "Scorecard");
  assert.equal(forked.continuity.turns[0].id, "turn:kpi-gap");
  assert.equal(modelRuns, 0);

  controller.getRuntime = DesktopController.prototype.getRuntime.bind(controller);
  const contextRuntime = await controller.getRuntime({
    requireAmos: false,
    boundary: "personal"
  });
  const contextTools = contextRuntime.runtime.registry.list();
  assert.equal(contextRuntime.contextOnly, true);
  assert.equal(contextTools.some((tool) => tool.name === "run_bash"), false);
  assert.equal(contextTools.some((tool) => tool.name === "read_file"), false);
  assert.equal(contextTools.some((tool) => tool.name === "apply_patch"), false);
  assert.equal(contextTools.some((tool) => tool.name === "desktop_create_document"), false);
});

test("a Project conversation is created already assigned to that workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-project-conversation-"));
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });
  const settings = settingsStore(root);
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settings,
    taskStore: tasks,
    openBrowser() {},
    emit() {}
  });
  controller.sendRemoteState = async () => {};
  controller.state = async () => ({
    activeContextKey: controller.activeContextKey,
    activeTaskRecordId: controller.activeTaskRecordId
  });

  const projectId = "11111111-1111-4111-8111-111111111111";
  controller.projects = {
    supported: true,
    projects: [{ id: projectId, name: "amos website", status: "active", archived: false }]
  };
  const opened = await controller.startNewConversation({
    kind: "general",
    projectId
  });
  const owner = taskOwnerScope({ boundary: "personal", workspace: root });
  const [conversation] = await tasks.list(owner);
  assert.equal(conversation.projectId, projectId);
  assert.equal(opened.launch.task.projectId, projectId);
  assert.equal(opened.launch.title, "Talk in amos website");
  assert.equal(opened.launch.objective, "Start a conversation in the amos website Project.");
});

test("a Project goal starts in the background without stealing Operator", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-autonomous-goal-"));
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });
  const settings = settingsStore(root);
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settings,
    taskStore: tasks,
    openBrowser() {},
    emit() {}
  });
  controller.sendRemoteState = async () => {};
  controller.state = async () => ({
    activeContextKey: controller.activeContextKey,
    activeTaskRecordId: controller.activeTaskRecordId
  });
  controller.projects = {
    supported: true,
    projects: [{
      id: "22222222-2222-4222-8222-222222222222",
      name: "Enterprise rollout",
      status: "active",
      archived: false
    }]
  };

  const opened = await controller.startNewConversation({ kind: "general" });
  assert.equal(opened.launch.title, "New conversation");
  const selectedId = controller.activeTaskRecordId;
  const selectedKey = controller.activeContextKey;

  let runCalls = 0;
  controller.executeRun = async (input) => {
    runCalls += 1;
    assert.equal(input.text, "Ship the first-location scorecard");
    assert.notEqual(controller.activeTaskRecordId, selectedId);
    return { answer: "Working", taskEventId: "run:goal" };
  };

  const started = await controller.startLocalMission({
    projectId: "22222222-2222-4222-8222-222222222222",
    objective: "Ship the first-location scorecard"
  });

  assert.equal(started.started, true);
  assert.equal(controller.activeTaskRecordId, selectedId);
  assert.equal(controller.activeContextKey, selectedKey);
  const owner = taskOwnerScope({ boundary: "personal", workspace: root });
  const library = await tasks.list(owner);
  const goal = library.find((task) => task.kind === "goal_pursuit");
  assert.ok(goal);
  assert.equal(goal.projectId, "22222222-2222-4222-8222-222222222222");
  assert.equal(goal.objective, "Ship the first-location scorecard");
  assert.equal(goal.title, "Ship the first-location scorecard");
  assert.notEqual(goal.id, selectedId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runCalls, 1);
});

test("a hosted Mission compiles in the background without creating or opening a conversation", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-hosted-mission-"));
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-09-02T12:00:00.000Z")
  });
  const settings = settingsStore(root);
  await settings.write({ ...(await settings.read()), operatingMode: "online" });
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settings,
    taskStore: tasks,
    openBrowser() {},
    emit() {}
  });
  controller.sendRemoteState = async () => {};
  controller.state = async () => ({
    activeContextKey: controller.activeContextKey,
    activeTaskRecordId: controller.activeTaskRecordId
  });
  controller.identity = { principal_type: "user", tenant_id: "tenant", sub: "user" };
  controller.personalRemote = async () => {
    throw new Error("Platform offline in this test");
  };

  const opened = await controller.startNewConversation({ kind: "general" });
  const selectedId = controller.activeTaskRecordId;
  const selectedKey = controller.activeContextKey;
  assert.ok(opened.launch.taskId);

  const runInputs = [];
  controller.executeRun = async (input) => {
    runInputs.push(input);
    assert.notEqual(controller.activeTaskRecordId, selectedId);
    return { answer: "Proposed a Run Contract", taskEventId: "run:mission" };
  };

  const started = await controller.startHostedMission({
    objective: "Build 500 qualified VAR/MSP prospects",
    missionKind: "finite"
  });

  assert.equal(started.started, true);
  assert.equal(started.executionLocation, "hosted");
  assert.equal(started.conversationOpened, false);
  assert.equal(started.missionKind, "finite");
  assert.ok(started.builderTaskId);
  // Operator's selected conversation is untouched.
  assert.equal(controller.activeTaskRecordId, selectedId);
  assert.equal(controller.activeContextKey, selectedKey);
  assert.notEqual(started.builderTaskId, selectedId);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runInputs.length, 1);
  assert.equal(runInputs[0].select, false);
  assert.equal(runInputs[0].isolate, true);
  assert.equal(runInputs[0].missionCreation, true);

  // The compiler run is retained as internal evidence, not offered as a conversation.
  const library = await controller.tasksState();
  const builder = library.tasks.find((task) => task.id === started.builderTaskId);
  assert.ok(builder);
  assert.equal(builder.missionBuilder, true);
  assert.equal(builder.active, false);
  assert.match(builder.title, /^Create Mission:/);
  const conversation = library.tasks.find((task) => task.id === selectedId);
  assert.equal(conversation.missionBuilder, false);
  assert.equal(conversation.active, true);
});

async function hostedMissionController(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-09-02T12:00:00.000Z")
  });
  const settings = settingsStore(root);
  await settings.write({ ...(await settings.read()), operatingMode: "online" });
  const emitted = [];
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settings,
    taskStore: tasks,
    openBrowser() {},
    emit(channel, payload) { emitted.push({ channel, payload }); }
  });
  controller.sendRemoteState = async () => {};
  controller.state = async () => ({
    activeContextKey: controller.activeContextKey,
    activeTaskRecordId: controller.activeTaskRecordId
  });
  controller.identity = { principal_type: "user", tenant_id: "tenant", sub: "user" };
  controller.personalRemote = async () => {
    throw new Error("Platform offline in this test");
  };
  await controller.startNewConversation({ kind: "general" });
  return { controller, emitted };
}

async function settled() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("an owner-authorized create_mission result replaces the compile with the Mission id, keyed by builder task", async () => {
  const { controller, emitted } = await hostedMissionController("amos-hosted-mission-authorized-");
  const compilation = {
    objective: "Build 500 qualified VAR/MSP prospects",
    allowed_operations: [{ verb: "search_prospects" }, { verb: "enrich_contact" }],
    prohibitions: ["send_email"],
    effective_limits: { max_tool_calls: 120, max_cost_usd: 25 },
    limit_sources: { max_tool_calls: "project_cap" },
    admission: { decision: "admitted" },
    bound_resources: [{ name: "Apollo connector" }]
  };
  controller.executeRun = async () => {
    // A create_mission that executed immediately (platform PR #706): no pending approval exists.
    controller.observeMissionCreationEvent({ type: "tool_start", name: "amos_create_mission" });
    controller.observeMissionCreationEvent({
      type: "tool_end",
      name: "amos_create_mission",
      result: {
        ok: true,
        mission_id: "33333333-3333-4333-8333-333333333333",
        name: "VAR/MSP prospect list",
        contract_id: "contract-1",
        contract_sha256: "abc123",
        expires_at: "2026-09-09T12:00:00.000Z",
        _amos_mission_compilation: compilation
      }
    });
    return { answer: "Mission created", taskEventId: "run:mission" };
  };

  const started = await controller.startHostedMission({
    objective: "Build 500 qualified VAR/MSP prospects",
    missionKind: "finite"
  });
  await settled();

  const outcomes = controller.missionCompileState();
  assert.equal(outcomes.length, 1);
  const [outcome] = outcomes;
  assert.equal(outcome.builderTaskId, started.builderTaskId);
  assert.equal(outcome.runId, started.runId);
  assert.equal(outcome.kind, "authorized");
  assert.equal(outcome.missionId, "33333333-3333-4333-8333-333333333333");
  assert.equal(outcome.missionName, "VAR/MSP prospect list");
  assert.equal(outcome.contractId, "contract-1");
  assert.equal(outcome.expiresAt, "2026-09-09T12:00:00.000Z");
  assert.equal(outcome.contract.source, "compilation");
  assert.deepEqual(outcome.contract.operations, ["search_prospects", "enrich_contact"]);
  assert.deepEqual(outcome.contract.prohibitions, ["send_email"]);
  assert.deepEqual(outcome.contract.effectiveLimits, { max_tool_calls: 120, max_cost_usd: 25 });
  assert.deepEqual(outcome.contract.limitSources, { max_tool_calls: "project_cap" });
  assert.deepEqual(outcome.contract.admission, { decision: "admitted" });
  assert.deepEqual(outcome.contract.boundResources, ["Apollo connector"]);

  // The renderer learns the outcome from the run lane while it is alive and from the bounded
  // record afterwards; neither depends on elapsed time.
  const laneUpdate = emitted.find((event) =>
    event.channel === "desktop-runs:changed" &&
    event.payload.some((lane) => lane.taskRecordId === started.builderTaskId && lane.missionOutcome)
  );
  assert.ok(laneUpdate, "the compile lane carries its outcome while it is still running");
  const lane = laneUpdate.payload.find((item) => item.taskRecordId === started.builderTaskId);
  assert.equal(lane.missionOutcome.kind, "authorized");
  assert.equal(lane.missionOutcome.missionId, "33333333-3333-4333-8333-333333333333");
  const pushed = emitted.filter((event) => event.channel === "mission-compiles:changed");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].payload[0].kind, "authorized");
  // The lane's later completion does not overwrite the authorized outcome with "ended".
  assert.equal(controller.missionCompileState()[0].kind, "authorized");
  assert.equal(controller.runManager.active().length, 0);
});

test("a parked create_mission keeps the authorization path, and a compiler rejection surfaces its corrective message", async () => {
  const { controller: pendingController } = await hostedMissionController("amos-hosted-mission-pending-");
  pendingController.executeRun = async () => {
    pendingController.observeMissionCreationEvent({
      type: "tool_end",
      name: "amos_create_mission",
      result: {
        ok: true,
        status: "pending_approval",
        pending_id: "pending-77",
        approval_url: "https://app.amoslabs.com/approvals/pending-77",
        review_summary: "Create Mission: 500 prospects",
        allowed_operations: [{ verb: "search_prospects" }],
        max_tool_calls: 80
      }
    });
    return { answer: "Proposed a Run Contract", taskEventId: "run:mission" };
  };
  const pending = await pendingController.startHostedMission({ objective: "Build 500 prospects" });
  await settled();
  const [parked] = pendingController.missionCompileState();
  assert.equal(parked.builderTaskId, pending.builderTaskId);
  assert.equal(parked.kind, "pending_approval");
  assert.equal(parked.pendingId, "pending-77");
  assert.equal(parked.approvalUrl, "https://app.amoslabs.com/approvals/pending-77");
  assert.equal(parked.missionId, "");
  assert.equal(parked.contract.source, "result");
  assert.deepEqual(parked.contract.operations, ["search_prospects"]);
  assert.deepEqual(parked.contract.effectiveLimits, { max_tool_calls: 80 });

  const { controller: failedController } = await hostedMissionController("amos-hosted-mission-failed-");
  const rejection = "InvalidParams: The Run Contract is not executable: no allowed operation can advance it. No Mission was created.";
  failedController.executeRun = async () => {
    // The MCP client normalizes an isError result into { ok: false, error }, which the agent loop
    // reports as a failed tool_end; the controller reads the message straight from it.
    failedController.observeMissionCreationEvent({
      type: "tool_end",
      name: "amos_create_mission",
      result: { ok: false, error: rejection }
    });
    return { answer: "I could not create the Mission", taskEventId: "run:mission" };
  };
  const failed = await failedController.startHostedMission({ objective: "Do something impossible" });
  await settled();
  const [rejected] = failedController.missionCompileState();
  assert.equal(rejected.builderTaskId, failed.builderTaskId);
  assert.equal(rejected.kind, "failed");
  assert.equal(rejected.message, rejection);
  assert.equal(rejected.missionId, "");
  assert.equal(rejected.pendingId, "");
});

test("a compile run that dies without any create_mission result settles as ended with its last error", async () => {
  const { controller, emitted } = await hostedMissionController("amos-hosted-mission-ended-");
  controller.executeRun = async () => {
    controller.observeMissionCreationEvent({
      type: "tool_end",
      name: "amos_list_missions",
      result: { ok: true, missions: [] }
    });
    throw new Error("Model provider returned 502");
  };
  const started = await controller.startHostedMission({ objective: "Build 500 prospects" });
  await settled();
  const [outcome] = controller.missionCompileState();
  assert.equal(outcome.builderTaskId, started.builderTaskId);
  assert.equal(outcome.kind, "ended");
  assert.equal(outcome.runStatus, "failed");
  assert.equal(outcome.message, "Model provider returned 502");
  assert.ok(emitted.some((event) => event.channel === "mission-compiles:changed"));
  // An ordinary conversation run never produces a Mission outcome record.
  assert.equal(controller.missionCompileState().length, 1);
});

test("missionCreationOutcome classifies create_mission results without consulting time", () => {
  assert.equal(missionCreationOutcome({ type: "tool_end", name: "amos_search", result: { ok: true } }), null);
  assert.equal(missionCreationOutcome({ type: "tool_start", name: "amos_create_mission" }), null);
  assert.deepEqual(
    missionCreationOutcome({ type: "tool_error", name: "create_mission", error: "boom" }),
    { kind: "failed", message: "boom" }
  );
  assert.equal(
    missionCreationOutcome({ type: "tool_end", name: "amos_create_mission", result: { ok: true, status: "pending_approval", pending_id: "p1" } }).kind,
    "pending_approval"
  );
  const authorized = missionCreationOutcome({
    type: "tool_end",
    name: "amos_create_mission",
    result: { ok: true, mission_id: "m1", contract_id: "c1", expires_at: "2026-09-09T00:00:00Z" }
  });
  assert.equal(authorized.kind, "authorized");
  assert.equal(authorized.missionId, "m1");
  assert.equal(authorized.contractId, "c1");
  // A result that is neither parked nor a Mission leaves the lane to settle as "ended".
  assert.equal(
    missionCreationOutcome({ type: "tool_end", name: "amos_create_mission", result: { ok: true, text: "noted" } }),
    null
  );
  // Optimization Missions correlate on create_goal instead.
  assert.equal(missionCreationOutcome({ type: "tool_end", name: "amos_create_goal", result: { ok: true, goal_id: "g1" } }, "finite"), null);
  assert.equal(
    missionCreationOutcome({ type: "tool_end", name: "amos_create_goal", result: { ok: true, goal_id: "g1" } }, "optimization").missionId,
    "g1"
  );
});

const compiledDryRun = {
  ok: true,
  status: "compiled",
  requires_confirmation: true,
  confirmation_token: "tok-1",
  confirmation_expires_at: "2099-01-01T00:00:00.000Z",
  ai_next_step: "Review the guessed spend limit, then start the Mission from Missions.",
  contract: {
    name: "VAR/MSP prospect list",
    objective: "Build 500 qualified VAR/MSP prospects",
    completion_condition: { kind: "work_exhausted" },
    allowed_operations: [
      { verb: "search_prospects", role: "advancing" },
      { verb: "get_prospect", consequence: { is_read: true } },
      { verb: "pause_mission", role: "control" }
    ],
    effective_limits: { max_tool_calls: 80, max_cost_microusd: 5_000_000, max_wall_time_seconds: 3600 },
    limit_sources: { max_tool_calls: "user", max_cost_microusd: "default", max_wall_time_seconds: "project_cap" },
    prohibitions: ["send_email"],
    bound_resources: [{ name: "Apollo connector" }],
    admission: { decision: "admitted" },
    contract_sha256: "sha-1"
  }
};

const missionSpec = {
  name: "VAR/MSP prospect list",
  objective: "Build 500 qualified VAR/MSP prospects",
  allowed_operations: [{ verb: "search_prospects" }, { verb: "get_prospect" }, { verb: "pause_mission" }],
  max_tool_calls: 80
};

test("the Missions-page compile dry-runs create_mission and records the compiled Run Contract with its spec", async () => {
  const { controller, emitted } = await hostedMissionController("amos-hosted-mission-compiled-");
  controller.executeRun = async () => {
    // The agent loop reports the dry-run result as tool_end, then hands args to onToolResult.
    controller.observeMissionCreationEvent({ type: "tool_end", name: "amos_create_mission", result: compiledDryRun });
    controller.attachMissionCompileSpec({
      name: "amos_create_mission",
      args: { ...missionSpec, dry_run: true },
      result: compiledDryRun,
      failed: false
    });
    return { answer: "Compiled the Run Contract", taskEventId: "run:mission" };
  };
  const started = await controller.startHostedMission({ objective: "Build 500 qualified VAR/MSP prospects" });
  await settled();

  const [record] = controller.missionCompileState();
  assert.equal(record.builderTaskId, started.builderTaskId);
  assert.equal(record.kind, "compiled");
  assert.equal(record.requiresConfirmation, true);
  assert.equal(record.confirmationToken, "tok-1");
  assert.equal(record.confirmationExpiresAt, "2099-01-01T00:00:00.000Z");
  assert.equal(record.missionName, "VAR/MSP prospect list");
  assert.equal(record.contractSha256, "sha-1");
  assert.deepEqual(record.spec, missionSpec, "the spec is kept without dry_run");
  assert.equal(record.contract.name, "VAR/MSP prospect list");
  assert.deepEqual(record.contract.completionCondition, { kind: "work_exhausted" });
  assert.deepEqual(record.contract.operationGroups, {
    advancing: ["search_prospects"],
    observing: ["get_prospect"],
    control: ["pause_mission"]
  });
  assert.deepEqual(record.contract.effectiveLimits, { max_tool_calls: 80, max_cost_microusd: 5_000_000, max_wall_time_seconds: 3600 });
  assert.equal(record.contract.limitSources.max_cost_microusd, "default");
  assert.deepEqual(record.contract.prohibitions, ["send_email"]);
  assert.deepEqual(record.contract.boundResources, ["Apollo connector"]);
  // Nothing was created: the lane's completion does not turn the compiled contract into "ended".
  assert.equal(controller.missionCompileState()[0].kind, "compiled");
  assert.ok(emitted.filter((event) => event.channel === "mission-compiles:changed").length >= 2);
});

async function compiledMissionController(prefix, remoteCalls, remoteBehaviour) {
  const { controller } = await hostedMissionController(prefix);
  controller.personalRemote = async () => ({
    async compileMission(spec) {
      remoteCalls.push({ tool: "compileMission", spec });
      return remoteBehaviour.compile(spec);
    },
    async createMission(spec, token) {
      remoteCalls.push({ tool: "createMission", spec, token });
      return remoteBehaviour.create(spec, token);
    }
  });
  controller.refreshMissions = async () => ({ supported: true, missions: [], count: 0 });
  controller.recordMissionCompileOutcome(
    { taskRecordId: "builder-1", id: "run-1", status: "completed" },
    { ...missionCreationOutcome({ type: "tool_end", name: "create_mission", result: compiledDryRun }), spec: missionSpec }
  );
  return controller;
}

test("Start Mission passes the dry-run confirmation token and lands on the authorized correlation path", async () => {
  const calls = [];
  const controller = await compiledMissionController("amos-compiled-start-", calls, {
    compile: () => { throw new Error("no re-compile expected"); },
    create: () => ({ ok: true, mission_id: "44444444-4444-4444-8444-444444444444", contract_id: "c-1" })
  });
  const response = await controller.startCompiledMission({ builderTaskId: "builder-1", limits: {} });
  assert.deepEqual(calls.map((call) => call.tool), ["createMission"]);
  assert.equal(calls[0].token, "tok-1");
  assert.deepEqual(calls[0].spec, missionSpec);
  assert.equal(response.started, true);
  assert.equal(response.outcome.kind, "authorized");
  assert.equal(response.outcome.missionId, "44444444-4444-4444-8444-444444444444");
  assert.equal(response.outcome.builderTaskId, "builder-1");
  assert.equal(response.missionCompiles[0].kind, "authorized");
  assert.ok(response.missions);
});

test("editing a limit re-runs the dry run so the token matches the new contract digest", async () => {
  const calls = [];
  const controller = await compiledMissionController("amos-compiled-edit-", calls, {
    compile: (spec) => ({
      ...compiledDryRun,
      confirmation_token: "tok-2",
      contract: {
        ...compiledDryRun.contract,
        effective_limits: { ...compiledDryRun.contract.effective_limits, max_cost_microusd: spec.max_cost_microusd },
        limit_sources: { ...compiledDryRun.contract.limit_sources, max_cost_microusd: "user" },
        contract_sha256: "sha-2"
      }
    }),
    create: () => ({ ok: true, status: "pending_approval", pending_id: "pending-9" })
  });
  const response = await controller.startCompiledMission({
    builderTaskId: "builder-1",
    limits: { max_cost_microusd: 12_000_000 }
  });
  assert.deepEqual(calls.map((call) => call.tool), ["compileMission", "createMission"]);
  assert.equal(calls[0].spec.max_cost_microusd, 12_000_000);
  assert.equal(calls[1].token, "tok-2");
  assert.equal(calls[1].spec.max_cost_microusd, 12_000_000);
  assert.equal(response.started, true);
  assert.equal(response.outcome.kind, "pending_approval");
  assert.equal(response.outcome.pendingId, "pending-9");

  await assert.rejects(
    controller.startCompiledMission({ builderTaskId: "builder-1" }),
    /no longer waiting to start/
  );
  await assert.rejects(
    compiledMissionController("amos-compiled-bad-limit-", [], {}).then((next) =>
      next.startCompiledMission({ builderTaskId: "builder-1", limits: { max_cost_microusd: -3 } })
    ),
    /must be a positive whole number/
  );
});

test("a server without dry_run support creates the Mission on the re-compile call itself", async () => {
  const calls = [];
  const controller = await compiledMissionController("amos-compiled-legacy-", calls, {
    compile: () => ({ ok: true, mission_id: "55555555-5555-4555-8555-555555555555" }),
    create: () => { throw new Error("must not be called twice"); }
  });
  const response = await controller.startCompiledMission({
    builderTaskId: "builder-1",
    limits: { max_tool_calls: 120 }
  });
  assert.deepEqual(calls.map((call) => call.tool), ["compileMission"]);
  assert.equal(response.outcome.kind, "authorized");
  assert.equal(response.outcome.missionId, "55555555-5555-4555-8555-555555555555");
});

test("a compiler rejection while starting surfaces the corrective message on the record", async () => {
  const calls = [];
  const controller = await compiledMissionController("amos-compiled-reject-", calls, {
    compile: () => { throw new Error("unexpected"); },
    create: () => ({ ok: false, error: "InvalidParams: no allowed operation can advance it. No Mission was created." })
  });
  const response = await controller.startCompiledMission({ builderTaskId: "builder-1" });
  assert.equal(response.started, false);
  assert.equal(response.outcome.kind, "failed");
  assert.match(response.outcome.message, /No Mission was created/);
});

test("missionCompileAmosClient forces dry_run on create_mission and leaves other tools alone", async () => {
  const seen = [];
  const client = {
    label: "mcp",
    async callTool(name, args, options) { seen.push({ name, args, options }); return { ok: true }; },
    async listTools() { return [this.label]; }
  };
  const wrapped = missionCompileAmosClient(client);
  await wrapped.callTool("amos_create_mission", { objective: "x", confirmation_token: "stale" }, { signal: null });
  await wrapped.callTool("call_engine_tool", { engine: "company", tool: "create_mission", arguments: { objective: "y" } });
  await wrapped.callTool("amos_search", { query: "q" });
  assert.deepEqual(seen[0].args, { objective: "x", dry_run: true });
  assert.deepEqual(seen[1].args, { engine: "company", tool: "create_mission", arguments: { objective: "y", dry_run: true } });
  assert.deepEqual(seen[2].args, { query: "q" });
  assert.deepEqual(await wrapped.listTools(), ["mcp"]);
  assert.equal(wrapped.label, "mcp");

  const compiled = missionCreationOutcome({ type: "tool_end", name: "amos_create_mission", result: compiledDryRun });
  assert.equal(compiled.kind, "compiled");
  assert.equal(compiled.requiresConfirmation, true);
  const awaiting = missionCreationOutcome({
    type: "tool_end",
    name: "amos_create_mission",
    result: { ok: true, status: "compiled_awaiting_confirmation", contract: { objective: "o" } }
  });
  assert.equal(awaiting.kind, "compiled");
  assert.equal(awaiting.requiresConfirmation, true);
  assert.equal(awaiting.confirmationToken, "");
});

test("a local Mission accepts optional Project context and requires an outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-autonomous-goal-guard-"));
  const tasks = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: settingsStore(root),
    taskStore: tasks,
    openBrowser() {},
    emit() {}
  });
  controller.sendRemoteState = async () => {};
  controller.state = async () => ({
    activeContextKey: controller.activeContextKey,
    activeTaskRecordId: controller.activeTaskRecordId
  });
  controller.projects = {
    supported: true,
    projects: [{
      id: "22222222-2222-4222-8222-222222222222",
      name: "Enterprise rollout",
      status: "paused",
      archived: false
    }]
  };

  await assert.rejects(
    controller.startLocalMission({
      projectId: "22222222-2222-4222-8222-222222222222",
      objective: ""
    }),
    /Mission needs an outcome/
  );
  await assert.rejects(
    controller.startLocalMission({
      projectId: "22222222-2222-4222-8222-222222222222",
      objective: "Do the work"
    }),
    /Resume the Project/
  );
});

// ---- Per-Mission notification channels ----

function verifiedSmsPreferences() {
  return normalizeNotificationPreferences({
    preferences: {
      channels: { desktop_inapp: true, sms: true, secure_mobile_web: false },
      sms_number: "+15551234567",
      sms_number_verified: true,
      quiet_hours: null,
      timezone: "America/Chicago",
      utc_offset_minutes: -300
    },
    channels_available: ["desktop_inapp", "sms", "secure_mobile_web"]
  });
}

test("the Missions-page form's channel choice rides the compile lane, every dry-run create_mission, and Start", async () => {
  const { controller } = await hostedMissionController("amos-mission-channels-");
  controller.notificationPreferences = verifiedSmsPreferences();
  const seen = [];
  controller.executeRun = async () => {
    const lane = controller.runManager.current();
    assert.deepEqual(lane.missionNotifications, { channels: ["in_app", "sms"] });
    // The compile lane wraps its AMOS client exactly like ensureRuntime does; the model's own
    // create_mission args never carry the choice, Desktop injects it.
    const client = missionCompileAmosClient(
      { async callTool(name, args) { seen.push({ name, args }); return compiledDryRun; } },
      { notifications: lane.missionNotifications }
    );
    const result = await client.callTool("amos_create_mission", { ...missionSpec, notifications: { channels: ["discord"] } });
    controller.observeMissionCreationEvent({ type: "tool_end", name: "amos_create_mission", result });
    controller.attachMissionCompileSpec({ name: "amos_create_mission", args: seen[0].args, result, failed: false });
    return { answer: "Compiled", taskEventId: "run:mission" };
  };
  const started = await controller.startHostedMission({
    objective: "Build 500 qualified VAR/MSP prospects",
    notifications: { channels: ["in_app", "sms"] }
  });
  assert.deepEqual(started.notifications, { channels: ["in_app", "sms"] });
  await settled();

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].args, { ...missionSpec, dry_run: true, notifications: { channels: ["in_app", "sms"] } });
  const [record] = controller.missionCompileState();
  assert.equal(record.kind, "compiled");
  assert.deepEqual(record.spec, { ...missionSpec, notifications: { channels: ["in_app", "sms"] } });

  // Start passes the same spec, so create_mission receives notifications unchanged.
  const calls = [];
  controller.personalRemote = async () => ({
    async compileMission() { throw new Error("no re-compile expected"); },
    async createMission(spec, token) {
      calls.push({ spec, token });
      return { ok: true, mission_id: "66666666-6666-4666-8666-666666666666" };
    }
  });
  controller.refreshMissions = async () => ({ supported: true, missions: [], count: 0 });
  const response = await controller.startCompiledMission({ builderTaskId: started.builderTaskId, limits: {} });
  assert.equal(response.outcome.kind, "authorized");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].spec.notifications, { channels: ["in_app", "sms"] });
  assert.equal(calls[0].token, "tok-1");
});

test("a channel the user has not set up is refused before any compile starts, pointing at Settings", async () => {
  const { controller } = await hostedMissionController("amos-mission-channels-unconfigured-");
  controller.notificationPreferences = normalizeNotificationPreferences({
    preferences: { channels: { desktop_inapp: true, sms: true }, sms_number: "+15551234567", sms_number_verified: false },
    channels_available: ["desktop_inapp", "sms"]
  });
  let runs = 0;
  controller.executeRun = async () => { runs += 1; return { answer: "", taskEventId: "run:x" }; };
  await assert.rejects(
    controller.startHostedMission({ objective: "Build prospects", notifications: { channels: ["in_app", "sms"] } }),
    /SMS: Verify your phone number\. Set it up in Settings → Notifications/
  );
  await assert.rejects(
    controller.startHostedMission({ objective: "Build prospects", notifications: { channels: ["discord"] } }),
    /Discord: Coming with the platform update\./
  );
  await assert.rejects(
    controller.startHostedMission({ objective: "Build prospects", notifications: { channels: ["fax"] } }),
    /Choose at least one place to send Mission updates/
  );
  assert.equal(runs, 0, "no compile run may start for an unusable channel choice");
});

test("without an explicit choice a hosted Mission takes the user's saved defaults, and In-app alone without any", async () => {
  const { controller } = await hostedMissionController("amos-mission-channels-defaults-");
  controller.executeRun = async () => ({ answer: "", taskEventId: "run:x" });
  controller.notificationPreferences = verifiedSmsPreferences();
  const withDefaults = await controller.startHostedMission({ objective: "Build prospects" });
  assert.deepEqual(withDefaults.notifications, { channels: ["in_app", "sms"] });
  await settled();

  controller.notificationPreferences = emptyNotificationPreferences();
  const bare = await controller.startHostedMission({ objective: "Build more prospects" });
  assert.deepEqual(bare.notifications, { channels: ["in_app"] });
  // Optimization Missions are create_goal, not create_mission: no channel contract is sent.
  const optimization = await controller.startHostedMission({ objective: "Raise reply rate", missionKind: "optimization" });
  assert.equal(optimization.notifications, null);
});

test("Change channels validates against preferences and reports a Platform without the verb as not available yet", async () => {
  const { controller } = await hostedMissionController("amos-mission-channels-change-");
  controller.notificationPreferences = verifiedSmsPreferences();
  const missionId = "77777777-7777-4777-8777-777777777777";
  controller.missions = {
    supported: true,
    missions: [{ id: missionId, name: "Prospects", objective: "Build prospects", status: "running", notifications: { channels: ["in_app"] } }],
    optimizationMissions: [], templates: [], count: 1, scheduler: null, stale: false, refreshError: ""
  };
  let sent = null;
  controller.personalRemote = async () => ({
    async setMissionNotificationChannels(id, notifications) {
      sent = { id, notifications };
      if (notifications.channels.includes("sms") && notifications.channels.length === 2) {
        return { missionId: id, notifications };
      }
      const unsupported = new Error("Changing a Mission's channels is not available yet on this AMOS company");
      unsupported.code = "unsupported";
      throw unsupported;
    }
  });
  await assert.rejects(
    controller.setMissionNotificationChannels(missionId, { channels: ["in_app", "discord"] }),
    /Discord: Coming with the platform update\./
  );
  assert.equal(sent, null, "an unconfigured channel never reaches the Platform");

  const changed = await controller.setMissionNotificationChannels(missionId, { channels: ["sms", "in_app"] });
  assert.deepEqual(sent, { id: missionId, notifications: { channels: ["sms", "in_app"] } });
  assert.deepEqual(changed.notifications, { channels: ["sms", "in_app"] });
  assert.deepEqual(changed.missions.missions[0].notifications, { channels: ["sms", "in_app"] });

  await assert.rejects(
    controller.setMissionNotificationChannels(missionId, { channels: ["in_app"] }),
    (error) => error.code === "unsupported" && /not available yet/.test(error.message)
  );
});

test("Settings saves notification preferences and walks the phone verification flow without granting authority", async () => {
  const { controller } = await hostedMissionController("amos-notification-settings-");
  let remoteState = 0;
  controller.sendRemoteState = async () => { remoteState += 1; };
  const calls = [];
  const unverified = {
    preferences: {
      channels: { desktop_inapp: true, sms: true, secure_mobile_web: false },
      sms_number: "+15551234567",
      sms_number_verified: false,
      quiet_hours: { start: "22:00", end: "07:00" },
      timezone: "America/Chicago",
      utc_offset_minutes: -300
    },
    channels_available: ["desktop_inapp", "sms", "secure_mobile_web"]
  };
  controller.personalRemote = async () => ({
    async setNotificationPreferences(input) {
      calls.push({ tool: "set_notification_preferences", input });
      return { preferences: normalizeNotificationPreferences(unverified), verification: { sms_verification: "code_sent" } };
    },
    async verifyNotificationPhone(code) {
      calls.push({ tool: "verify_notification_phone", code });
      if (code !== "123456") throw new Error("that code is wrong or expired; set sms_number again to receive a new one");
      return {
        verified: true,
        preferences: normalizeNotificationPreferences({
          ...unverified,
          preferences: { ...unverified.preferences, sms_number_verified: true }
        })
      };
    },
    async getNotificationPreferences() {
      calls.push({ tool: "get_notification_preferences" });
      return normalizeNotificationPreferences(unverified);
    }
  });

  const saved = await controller.setNotificationPreferences({
    channels: { in_app: true, sms: true },
    smsNumber: "+1 (555) 123-4567",
    quietHours: { start: "22:00", end: "07:00" },
    utcOffsetMinutes: -300,
    timezone: "America/Chicago"
  });
  assert.deepEqual(saved.verification, { sms_verification: "code_sent" });
  assert.equal(saved.preferences.smsNumber, "+15551234567");
  assert.equal(saved.preferences.smsNumberVerified, false);
  assert.deepEqual(saved.preferences.quietHours, { start: "22:00", end: "07:00" });
  // Unverified: SMS is still not a usable Mission channel.
  assert.equal(channelAvailability("sms", controller.notificationPreferences).configured, false);
  assert.deepEqual(defaultMissionChannels(controller.notificationPreferences), ["in_app"]);

  await assert.rejects(controller.verifyNotificationPhone("000000"), /wrong or expired/);
  const verified = await controller.verifyNotificationPhone("123456");
  assert.equal(verified.verified, true);
  assert.equal(controller.notificationPreferences.smsNumberVerified, true);
  assert.equal(channelAvailability("sms", controller.notificationPreferences).configured, true);
  assert.deepEqual(defaultMissionChannels(controller.notificationPreferences), ["in_app", "sms"]);
  assert.deepEqual(calls.map((call) => call.tool), [
    "set_notification_preferences", "verify_notification_phone", "verify_notification_phone"
  ]);
  assert.ok(remoteState >= 2, "the renderer learns about every preference change");

  const fresh = await controller.getNotificationPreferences();
  assert.equal(fresh.available, true);
  assert.equal(calls.at(-1).tool, "get_notification_preferences");
});
