import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DesktopController, missionCreationOutcome } from "../src/desktop/controller.js";
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
