import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DesktopController } from "../src/desktop/controller.js";
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
