import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import {
  DEFAULT_DESKTOP_SETTINGS,
  sanitizeSettings
} from "../src/desktop/settingsStore.js";

function mutableSettings(initial) {
  let settings = sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    provider: "ollama",
    model: "qwen3:4b",
    baseUrl: "http://127.0.0.1:11434/v1",
    operatingMode: "personal",
    workspace: "/tmp/project-a",
    ...initial
  });
  return {
    async read() {
      return { ...settings, apiKey: "" };
    },
    async write(input) {
      settings = sanitizeSettings(input);
      return { ...settings };
    }
  };
}

function controllerFor(settingsStore) {
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-local-approval-controller",
    settingsStore,
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({ status: async () => ({}) });
  return controller;
}

test("Desktop enables local auto-approve for the selected folder and resets it on folder change", async () => {
  const settingsStore = mutableSettings();
  const controller = controllerFor(settingsStore);

  let state = await controller.setLocalApprovalMode("workspace");
  assert.equal(state.settings.localApprovalMode, "workspace");
  assert.equal(state.settings.localApprovalWorkspace, "/tmp/project-a");

  state = await controller.chooseWorkspace("/tmp/project-b");
  assert.equal(state.settings.workspace, "/tmp/project-b");
  assert.equal(state.settings.localApprovalMode, "ask");
  assert.equal(state.settings.localApprovalWorkspace, "");
});

test("Desktop runtime receives the selected project and scoped local approval policy", async () => {
  const settingsStore = mutableSettings({
    localApprovalMode: "workspace",
    localApprovalWorkspace: "/tmp/project-a"
  });
  const controller = controllerFor(settingsStore);
  const { config, runtime } = await controller.getRuntime({
    requireAmos: false,
    boundary: "personal"
  });

  assert.equal(config.safety.workspaceRoot, "/tmp/project-a");
  assert.equal(config.safety.autoApproveBash, true);
  assert.equal(config.safety.autoApproveWrites, true);
  assert.match(runtime.loop.systemPrompt, /exact local project root.*\/tmp\/project-a/i);
  assert.match(runtime.loop.systemPrompt, /trusted workspace mode is on/i);
  assert.match(runtime.loop.systemPrompt, /never approves AMOS company operations/i);
});

test("changing local approval mode updates an active runtime without changing its workspace", async () => {
  const settingsStore = mutableSettings();
  const controller = controllerFor(settingsStore);
  const active = await controller.getRuntime({
    requireAmos: false,
    boundary: "personal"
  });
  assert.equal(active.config.safety.autoApproveBash, false);
  assert.equal(active.config.safety.autoApproveWrites, false);

  await controller.setLocalApprovalMode("workspace");

  assert.equal(controller.runtime, active);
  assert.equal(active.config.safety.autoApproveBash, true);
  assert.equal(active.config.safety.autoApproveWrites, true);
});

test("always allow this kind updates only that local request class", async () => {
  const settingsStore = mutableSettings();
  const controller = controllerFor(settingsStore);
  const active = await controller.getRuntime({
    requireAmos: false,
    boundary: "personal"
  });

  const state = await controller.allowLocalApprovalKind("code-patch");

  assert.equal(state.settings.localApprovalMode, "ask");
  assert.equal(state.settings.localApprovalWorkspace, "/tmp/project-a");
  assert.deepEqual(state.settings.localApprovalKinds, ["code-patch"]);
  assert.equal(active.config.safety.autoApproveBash, false);
  assert.equal(active.config.safety.autoApproveWrites, false);
  assert.deepEqual(active.config.safety.autoApproveKinds, ["code-patch"]);
  assert.match(active.runtime.loop.systemPrompt, /user-approved local request types: code-patch/);
});
