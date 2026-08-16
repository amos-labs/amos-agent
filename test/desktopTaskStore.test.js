import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DesktopTaskStore, taskOwnerScope } from "../src/desktop/taskStore.js";

function codec() {
  return {
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  };
}

function clock(...values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

test("DesktopTaskStore encrypts and isolates task metadata by account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-task-store-"));
  const filePath = join(directory, "tasks.json");
  const store = new DesktopTaskStore({
    filePath,
    ...codec(),
    now: clock("2026-08-10T10:00:00.000Z")
  });
  const owner = taskOwnerScope({
    boundary: "online",
    identity: { principal_type: "user", sub: "user-1", tenant_id: "tenant-1" },
    workspace: "/private/workspace"
  });
  const other = taskOwnerScope({
    boundary: "online",
    identity: { principal_type: "user", sub: "user-2", tenant_id: "tenant-1" },
    workspace: "/private/workspace"
  });

  const task = await store.create(owner, {
    id: "task-1",
    contextKey: "task:task-1",
    title: "Build weekly scorecard",
    objective: "Use password=hunter2 to build the governed scorecard",
    workspace: { localPath: "/private/workspace", label: "AMOS Platform" }
  });

  assert.equal(task.objective, "Use password=[REDACTED] to build the governed scorecard");
  assert.equal((await store.list(owner)).length, 1);
  assert.equal((await store.list(other)).length, 0);
  assert.doesNotMatch(await readFile(filePath, "utf8"), /weekly scorecard|private\/workspace/);
});

test("DesktopTaskStore restores the explicitly selected conversation across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-task-selection-"));
  const filePath = join(directory, "tasks.json");
  const owner = taskOwnerScope({ boundary: "personal", workspace: "/workspace" });
  const store = new DesktopTaskStore({
    filePath,
    ...codec(),
    now: clock(
      "2026-08-10T10:00:00.000Z",
      "2026-08-10T10:01:00.000Z",
      "2026-08-10T10:02:00.000Z"
    )
  });
  await store.create(owner, {
    id: "older",
    title: "Older conversation",
    objective: "Inspect the older plan"
  });
  await store.create(owner, {
    id: "newer",
    title: "Newer conversation",
    objective: "Inspect the newer plan"
  });

  assert.equal((await store.selected(owner)).id, "newer");
  await store.select(owner, "older");

  const restarted = new DesktopTaskStore({ filePath, ...codec() });
  const restored = await restarted.selected(owner);
  assert.equal(restored.id, "older");
  assert.equal(restored.selectedAt, "2026-08-10T10:02:00.000Z");
});

test("DesktopTaskStore manages pin, archive, lineage, and task-bound canvas", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-task-store-"));
  const store = new DesktopTaskStore({
    filePath: join(directory, "tasks.json"),
    ...codec(),
    now: clock(
      "2026-08-10T10:00:00.000Z",
      "2026-08-10T10:01:00.000Z",
      "2026-08-10T10:02:00.000Z"
    )
  });
  const owner = taskOwnerScope({ boundary: "personal", workspace: "/workspace" });
  await store.create(owner, {
    id: "parent",
    title: "Parent task",
    objective: "Inspect the account"
  });
  await store.create(owner, {
    id: "child",
    title: "Forked analysis",
    objective: "Explore the intervention",
    kind: "fork",
    parentTaskId: "parent",
    sourceEventId: "turn:7",
    contextScope: "from_here",
    workspaceMode: "context_only",
    forkManifest: { parentTaskId: "parent", sourceEventId: "turn:7" }
  });
  const updated = await store.update(owner, "child", {
    pinned: true,
    archived: true,
    projectId: "11111111-1111-4111-8111-111111111111",
    canvasState: {
      activeCanvasId: "canvas-1",
      canvases: [{ id: "canvas-1", title: "Scorecard", spec: { type: "table" } }]
    }
  });

  assert.equal(updated.pinned, true);
  assert.equal(updated.archivedAt, "2026-08-10T10:02:00.000Z");
  assert.equal(updated.projectId, "11111111-1111-4111-8111-111111111111");
  assert.equal(updated.workspace.localPath, undefined);
  assert.equal(updated.canvasState.canvases[0].title, "Scorecard");
  assert.equal(updated.forkManifest.safeguards.replayAllowed, false);
  assert.equal((await store.list(owner)).length, 1);
  assert.equal((await store.list(owner, { includeArchived: true })).length, 2);
});

test("DesktopTaskStore persists a bounded child outcome for later collection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-task-outcome-"));
  const store = new DesktopTaskStore({
    filePath: join(directory, "tasks.json"),
    ...codec(),
    now: clock("2026-08-16T10:00:00.000Z", "2026-08-16T10:01:00.000Z")
  });
  const owner = taskOwnerScope({ boundary: "personal", workspace: "/workspace" });
  await store.create(owner, {
    id: "child",
    title: "Isolated builder",
    objective: "Apply the planned patch"
  });
  const updated = await store.update(owner, "child", {
    status: "completed",
    outcome: {
      status: "completed",
      summary: "Patched the receipt store",
      answer: "Applied apply_patch and tests passed.",
      diff: " src/desktop/localReceiptStore.js | 2 +-",
      files: ["src/desktop/localReceiptStore.js"],
      usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120, costUsedMicrousd: 960 },
      finishedAt: "2026-08-16T10:01:00.000Z"
    }
  });
  assert.equal(updated.status, "completed");
  assert.equal(updated.outcome.status, "completed");
  assert.deepEqual(updated.outcome.files, ["src/desktop/localReceiptStore.js"]);
  assert.equal(updated.outcome.usage.totalTokens, 120);
});

test("DesktopTaskStore supports all explicit workspace fork modes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-task-store-"));
  const store = new DesktopTaskStore({
    filePath: join(directory, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-08-10T10:00:00.000Z")
  });
  const owner = taskOwnerScope({ boundary: "offline", workspace: "/workspace" });
  for (const [index, workspaceMode] of [
    "same_directory",
    "new_worktree",
    "context_only"
  ].entries()) {
    const task = await store.create(owner, {
      id: `fork-${index}`,
      title: `Fork ${index}`,
      objective: "Continue safely",
      workspaceMode,
      workspace: { localPath: `/workspace/${index}`, branch: `amos/fork-${index}` }
    });
    assert.equal(task.workspaceMode, workspaceMode);
    assert.equal(task.workspace.localPath, workspaceMode === "context_only" ? undefined : `/workspace/${index}`);
  }
});
