import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { taskProgressFromEvent, taskProgressStatus } from "../src/desktop/taskProgress.js";

const renderer = await readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8");

function rendererFunction(name) {
  const start = renderer.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `${name} must exist in the renderer`);
  const rest = renderer.slice(start);
  const next = rest.slice(1).search(/^\n(?:async )?function /m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function cancelHarness(cancel) {
  const messages = [];
  const finished = [];
  const button = { disabled: false, textContent: "Stop safely" };
  const context = vm.createContext({
    running: true,
    currentTaskId: "run-a",
    activeUiRunToken: 1,
    state: { activeTaskRecordId: "task-a", activeContextKey: "context-a" },
    elements: { cancelButton: button },
    api: { cancelTask: cancel },
    toast: (...args) => messages.push(args),
    finishCanceledRunInUi: id => finished.push(id),
    eventMatchesActiveTask: value => !value.taskRecordId || value.taskRecordId === context.state.activeTaskRecordId,
    updateChatRunStatus: () => {}
  });
  vm.runInContext(`"use strict";\n${rendererFunction("cancelTask")}`, context);
  return { context, button, messages, finished, cancel: () => context.cancelTask() };
}

test("Stop can be retried after an IPC failure instead of remaining disabled", async () => {
  let calls = 0;
  const run = cancelHarness(async () => {
    calls += 1;
    if (calls === 1) throw new Error("IPC disconnected");
    return { canceled: true, detached: true, taskId: "run-a" };
  });
  await run.cancel();
  assert.equal(run.button.disabled, false);
  assert.equal(run.button.textContent, "Stop safely");
  assert.equal(run.context.running, true, "a rejected stop is not a completed run");
  assert.match(run.messages[0][0], /IPC disconnected/);
  await run.cancel();
  assert.deepEqual(run.finished, ["run-a"]);
});

test("an unconfirmed stop restores its retry control", async () => {
  const run = cancelHarness(async () => ({ canceled: false, message: "Could not find the active run" }));
  await run.cancel();
  assert.equal(run.button.disabled, false);
  assert.equal(run.button.textContent, "Stop safely");
  assert.deepEqual(run.finished, []);
});

test("an accepted cooperative stop stays pending until termination is reported", async () => {
  const run = cancelHarness(async () => ({ canceled: true, detached: false }));
  await run.cancel();
  assert.equal(run.button.disabled, true);
  assert.equal(run.button.textContent, "Stopping…");
  assert.deepEqual(run.finished, []);
});

test("a late cancellation response cannot stop the next visible run", async () => {
  let resolve;
  const run = cancelHarness(() => new Promise(done => { resolve = done; }));
  const pending = run.cancel();
  run.context.activeUiRunToken += 1;
  run.context.currentTaskId = "run-b";
  resolve({ canceled: true, detached: true, taskId: "run-a" });
  await pending;
  assert.deepEqual(run.finished, []);
});

test("a late IPC failure cannot reset another run's pending Stop", async () => {
  let reject;
  const run = cancelHarness(() => new Promise((_, fail) => { reject = fail; }));
  const pending = run.cancel();
  run.context.activeUiRunToken += 1;
  run.context.currentTaskId = "run-b";
  reject(new Error("Old request failed"));
  await pending;
  assert.equal(run.button.disabled, true);
  assert.equal(run.button.textContent, "Stopping…");
  assert.deepEqual(run.messages, []);
});

function element() {
  const classes = new Set();
  return {
    textContent: "",
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, add) => add ? classes.add(name) : classes.delete(name)
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    replaceChildren: () => {}
  };
}

function progressHarness() {
  const elements = Object.fromEntries([
    "chatRunStatus", "chatRunStatusText", "chatRunProgressDetail", "liveEvents",
    "activityStreamTitle", "runningIndicator"
  ].map(name => [name, element()]));
  const diagnostics = [];
  const context = vm.createContext({
    taskProgress: null, runTerminalState: "running", running: true,
    taskProgressFromEvent, taskProgressStatus, elements, activeCanvasId: null,
    humanizeTool: name => name,
    captureGovernedUiActions: () => {},
    hideInlineThoughtSnippet: () => {},
    setPanelBadge: () => {},
    failedToolResultEvent: event => event.type === "tool_end" && event.failed === true,
    updateStreamingThought: () => {},
    updateStreamingDraft: () => {},
    liveEventCopy: event => { diagnostics.push(event); return { skipCard: true }; }
  });
  for (const name of ["updateChatRunStatus", "renderTaskProgress", "chatStatusForEvent", "renderLiveEvent", "finishInlineActivity"]) {
    vm.runInContext(`"use strict";\n${rendererFunction(name)}`, context);
  }
  return { context, elements, diagnostics, event: event => context.renderLiveEvent(event) };
}

test("concrete artifact progress survives routing, model thinking, and tool chatter", () => {
  const run = progressHarness();
  run.event({ type: "task_progress", stage: "checking", summary: "Draft saved; checking the form", checks: [
    { label: "Saved revision", status: "passed" }, { label: "Lead contract", status: "pending" }
  ] });
  const savedStatus = run.elements.chatRunStatusText.textContent;
  for (const event of [
    { type: "routing", tier: "frontier" },
    { type: "context_compiled" },
    { type: "assistant_delta", channel: "thinking", thinking: "Considering checks" },
    { type: "assistant_delta", channel: "tool", toolName: "site_status" },
    { type: "tool_start", name: "site_status" },
    { type: "tool_end", name: "site_status" },
    { type: "assistant_delta", text: "Reviewing the saved page" }
  ]) {
    run.event(event);
    assert.equal(run.elements.chatRunStatusText.textContent, savedStatus);
  }
  assert.match(savedStatus, /Draft saved/);
  assert.match(run.elements.chatRunProgressDetail.textContent, /1\/2 checks passed.*1 pending/);
  assert.ok(run.diagnostics.some(event => event.type === "tool_end"), "tool evidence remains in activity");
  run.event({ type: "task_progress", stage: "repairing", summary: "Adding required form fields", checks: [
    { label: "Lead contract", status: "failed" }
  ] });
  assert.match(run.elements.chatRunStatusText.textContent, /Adding required form fields/);
  assert.match(run.elements.chatRunProgressDetail.textContent, /1 need attention/);
});

test("input waits are visible and resume to the concrete artifact stage", () => {
  const run = progressHarness();
  run.event({ type: "task_progress", stage: "building", summary: "Editing the saved page" });
  run.event({ type: "phase", phase: "waiting", summary: "Choose a destination" });
  assert.equal(run.elements.chatRunStatusText.textContent, "Choose a destination");
  assert.equal(run.elements.chatRunStatus.classList.contains("waiting"), true);
  run.event({ type: "phase", phase: "thinking", summary: "Waiting for the model" });
  assert.match(run.elements.chatRunStatusText.textContent, /Editing the saved page/);
  assert.equal(run.elements.chatRunStatus.classList.contains("active"), true);
});

test("partial artifact checks are not relabelled Completed by the normal run ending", () => {
  const run = progressHarness();
  run.event({ type: "task_progress", stage: "partial", summary: "Draft saved; browser review remains", checks: [
    { label: "Browser review", status: "pending" }
  ] });
  run.event({ type: "phase", phase: "completed" });
  run.event({ type: "agent_outcome", outcome: { status: "completed", verified: false } });
  run.context.finishInlineActivity();
  assert.match(run.elements.chatRunStatusText.textContent, /^Checks remain/);
  assert.doesNotMatch(run.elements.chatRunStatusText.textContent, /Completed/);
  assert.equal(run.elements.chatRunStatus.classList.contains("waiting"), true);
});

test("an interruption overrides an earlier artifact-ready message", () => {
  const run = progressHarness();
  run.event({ type: "task_progress", stage: "ready", summary: "Draft ready for review" });
  run.event({ type: "agent_outcome", outcome: { status: "interrupted", reason: "budget_exhausted" } });
  run.context.finishInlineActivity();
  assert.match(run.elements.chatRunStatusText.textContent, /interrupted/);
  assert.doesNotMatch(run.elements.chatRunStatusText.textContent, /Ready for review/);
});

test("simple questions retain direct status updates with no artifact lifecycle", () => {
  const run = progressHarness();
  run.event({ type: "assistant_delta", channel: "thinking", thinking: "Answering" });
  assert.equal(run.elements.chatRunStatusText.textContent, "Thinking…");
  run.event({ type: "assistant_delta", text: "Hello" });
  assert.equal(run.elements.chatRunStatusText.textContent, "Writing the response…");
  assert.equal(run.context.taskProgress, null);
});

test("progress ignores unknown stages and does not expose raw artifact data", () => {
  assert.equal(taskProgressFromEvent({ type: "task_progress", stage: "constructor" }), null);
  const progress = taskProgressFromEvent({
    type: "task_progress", stage: "checking", summary: "Saved\nchecking" + "x".repeat(200),
    detail: "d".repeat(300), artifact: { html: "private html", previewUrl: "secret url" },
    checks: [{ label: "Evidence", status: "passed" }, { label: "Invented", status: "success" }]
  });
  assert.equal(progress.summary.length, 180);
  assert.equal(progress.detail.length, 240);
  assert.equal(progress.checks.length, 1);
  assert.equal(Object.hasOwn(progress, "artifact"), false);
  assert.doesNotMatch(JSON.stringify(taskProgressStatus(progress)), /private html|secret url/);
});

test("opening another conversation clears progress and invalidates pending UI requests", () => {
  const run = progressHarness();
  run.event({ type: "task_progress", stage: "partial", summary: "Old draft", detail: "Old checks" });
  Object.assign(run.elements, { messages: element(), panelActivityCount: element() });
  Object.assign(run.context, {
    activeUiRunToken: 4, continuityConversationRestored: true,
    state: {}, pendingUiActions: [], pendingGenericConnectCalls: 0,
    canvasSidecarOpen: true, panelUserClosed: true, currentPanelTab: "activity",
    updateAttachments: () => {}, clearInlineApproval: () => {}, renderCanvas: () => {},
    renderStarterActions: () => {}, renderConversationChrome: () => {}
  });
  vm.runInContext(`"use strict";\n${rendererFunction("resetSessionView")}`, run.context);
  run.context.resetSessionView();
  assert.equal(run.context.activeUiRunToken, 5);
  assert.equal(run.context.taskProgress, null);
  assert.equal(run.elements.chatRunProgressDetail.textContent, "");
  assert.equal(run.elements.chatRunStatus.classList.contains("hidden"), true);
});

function conversationHarness() {
  const run = progressHarness();
  Object.assign(run.elements, Object.fromEntries([
    "messages", "panelActivityCount", "runButton", "cancelButton", "attachButton", "promptInput", "loading", "app"
  ].map(name => [name, element()])));
  Object.assign(run.context, {
    activeUiRunToken: 1, continuityConversationRestored: false, currentTaskId: null,
    state: {}, updateState: {}, pendingUiActions: [], pendingGenericConnectCalls: 0,
    canvasSidecarOpen: false, panelUserClosed: false, currentPanelTab: "activity",
    streamingMessage: null, selectedProvider: null,
    updateAttachments: () => {}, clearInlineApproval: () => {}, renderCanvas: () => {},
    renderStarterActions: () => {}, renderConversationChrome: () => {}, render: () => {},
    renderRunButtonLabel: () => {}, renderAttachments: () => {}, renderUpdate: () => {},
    renderConversationActions: () => {}, idlePromptPlaceholder: () => "Ask",
    showView: () => {}, restoreConversationFromContinuity: () => {},
    bindActions: () => {}, bindEvents: () => {}, syncAutomationSetup: () => {},
    restoreShellPreferences: () => {}, renderOfflineModels: () => {}
  });
  for (const name of ["resetSessionView", "hydrateActiveTaskProgress", "setRunning", "adoptOpenedTask", "initialize"]) {
    vm.runInContext(`"use strict";\n${rendererFunction(name)}`, run.context);
  }
  return run;
}

function activeProgressState(overrides = {}) {
  return {
    settings: { provider: "amos-hosted" }, activeTaskRecordId: "task-a", activeContextKey: "context-a",
    activeTask: { id: "run-a", taskProgress: { type: "task_progress", stage: "checking", summary: "Checking the saved draft", checks: [{ label: "Form", status: "pending" }] } },
    ...overrides
  };
}

test("initial Desktop state restores the selected active task's concrete progress", async () => {
  const run = conversationHarness();
  run.context.api = {
    state: async () => activeProgressState(), updateState: async () => ({}),
    refreshOffline: async () => ({}), refreshRemote: async () => ({})
  };
  await run.context.initialize();
  assert.match(run.elements.chatRunStatusText.textContent, /Checking the saved draft/);
  assert.match(run.elements.chatRunProgressDetail.textContent, /1 pending/);
  assert.equal(run.context.currentTaskId, "run-a");
  assert.equal(run.elements.cancelButton.classList.contains("hidden"), false);
});

test("opening an active conversation hydrates its progress and leaving it clears those checks", () => {
  const run = conversationHarness();
  run.context.adoptOpenedTask({ state: activeProgressState() });
  assert.match(run.elements.chatRunStatusText.textContent, /Checking the saved draft/);
  run.context.adoptOpenedTask({ state: activeProgressState({ activeTask: null, activeTaskRecordId: "task-b" }) });
  assert.equal(run.context.taskProgress, null);
  assert.equal(run.elements.chatRunProgressDetail.textContent, "");
  assert.doesNotMatch(run.elements.chatRunStatusText.textContent, /Checking the saved draft/);
});

test("hydration rejects snapshots belonging to a different run, task, or context", () => {
  for (const mismatch of [{ runId: "old-run" }, { taskRecordId: "other-task" }, { contextKey: "other-context" }]) {
    const run = conversationHarness();
    const state = activeProgressState();
    Object.assign(state.activeTask.taskProgress, mismatch);
    run.context.adoptOpenedTask({ state });
    assert.equal(run.context.taskProgress, null);
    assert.equal(run.elements.chatRunProgressDetail.textContent, "");
    assert.doesNotMatch(run.elements.chatRunStatusText.textContent, /Checking the saved draft/);
  }
});

test("an upfront run failure restores the idle composer and Run control", async () => {
  const run = conversationHarness();
  const messages = [];
  Object.assign(run.context, {
    running: false, attachments: [], transientTaskMessages: new Set(),
    eventMatchesActiveTask: () => true,
    addMessage: (role, content) => { messages.push({ role, content }); return element(); },
    clearTransientTaskMessages: () => {}, friendlyError: error => error.message,
    renderPrivateMemory: () => {}, renderDecisions: () => {}, renderHistory: () => {}, renderTasks: () => {},
    toast: () => {},
    api: {
      run: async () => { throw new Error("Connect AMOS before starting this task"); },
      state: async () => ({})
    }
  });
  for (const name of ["beginInlineActivity", "idlePromptPlaceholder", "runTask"]) {
    vm.runInContext(`"use strict";\n${rendererFunction(name)}`, run.context);
  }
  run.elements.promptInput.value = "What is 2+2?";
  await run.context.runTask();
  assert.equal(run.context.running, false);
  assert.equal(run.elements.runButton.disabled, false);
  assert.equal(run.elements.cancelButton.classList.contains("hidden"), true);
  assert.match(run.elements.promptInput.placeholder, /^Ask about the company/);
  assert.doesNotMatch(run.elements.promptInput.placeholder, /while AMOS works/);
  assert.equal(messages.at(-1).content, "Connect AMOS before starting this task");
});
