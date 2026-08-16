import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopController } from "../src/desktop/controller.js";
import { DesktopTaskStore, taskOwnerScope } from "../src/desktop/taskStore.js";

function codec() {
  return {
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  };
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "amos-subagents-"));
  const settings = {
    operatingMode: "personal",
    amosMcpUrl: "https://app.amoslabs.com/mcp",
    workspace: root,
    provider: "xai",
    model: "grok-4.6",
    apiKey: "test-key"
  };
  const taskStore = new DesktopTaskStore({
    filePath: join(root, "tasks.json"),
    ...codec()
  });
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: {
      read: async () => ({ ...settings }),
      write: async (value) => {
        Object.assign(settings, value);
        return { ...settings };
      }
    },
    taskStore,
    openBrowser() {},
    emit() {}
  });
  const scope = taskOwnerScope({
    boundary: "personal",
    workspace: root
  });
  const parent = await taskStore.create(scope, {
    title: "Parent coding task",
    objective: "Implement the pairing",
    workspaceMode: "same_directory",
    workspace: { localPath: root, label: "workspace" }
  });
  controller.activeTaskRecordId = parent.id;
  controller.activeTask = { id: "parent-run", children: [] };
  return { controller, parent, root, settings };
}

test("isolated children can spawn while the parent run is still active", async () => {
  const { controller, parent } = await harness();
  await assert.rejects(
    () => controller.forkTaskResource({
      taskId: parent.id,
      name: "User fork",
      objective: "Should wait",
      workspaceMode: "same_directory",
      select: true
    }),
    /Finish or stop the current run/
  );
  const child = await controller.forkTaskResource({
    taskId: parent.id,
    name: "Isolated builder",
    objective: "Apply the planned patch",
    workspaceMode: "same_directory",
    select: false,
    isolatedChild: true
  });
  assert.equal(child.opened, false);
  assert.equal(child.task.parentTaskId, parent.id);
  assert.equal(child.task.workspaceMode, "same_directory");
});

test("companion workspace changes go through saveSettings so the runtime is invalidated", async () => {
  const { controller, root, settings } = await harness();
  let saved = null;
  const original = controller.saveSettings.bind(controller);
  controller.saveSettings = async (input) => {
    saved = input;
    return original(input);
  };
  controller.runtime = { boundary: "personal" };
  const next = join(root, "other-project");
  const result = await controller.companionSetWorkspace({ path: next });
  assert.equal(saved.workspace, next);
  assert.equal(result.workspace, next);
  assert.equal(settings.workspace, next);
  assert.equal(controller.runtime, null);
});
