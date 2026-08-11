import test from "node:test";
import assert from "node:assert/strict";
import { DesktopApprovalBridge } from "../src/desktop/approvalBridge.js";

test("desktop approval bridge parks local work until the user decides", async () => {
  let request;
  const bridge = new DesktopApprovalBridge({ onRequest: (value) => (request = value) });
  const decision = bridge.confirm("Run a local command");

  assert.equal(request.message, "Run a local command");
  assert.equal(bridge.resolve(request.id, true), true);
  assert.equal(await decision, true);
  assert.equal(bridge.resolve(request.id, false), false);
});

test("desktop approval bridge exposes the bounded local request kind", async () => {
  let request;
  const bridge = new DesktopApprovalBridge({ onRequest: (value) => (request = value) });
  const decision = bridge.confirm("Apply a patch", { kind: "code-patch" });

  assert.equal(request.kind, "code-patch");
  bridge.resolve(request.id, true);
  assert.equal(await decision, true);
});

test("desktop approval bridge denies pending work when the runtime resets", async () => {
  const bridge = new DesktopApprovalBridge();
  const decision = bridge.confirm("Write a local file");
  bridge.cancelAll();
  assert.equal(await decision, false);
});

test("task-scoped local grants approve bounded local kinds until the task scope changes", async () => {
  let requests = 0;
  const bridge = new DesktopApprovalBridge({ onRequest: () => { requests += 1; } });
  bridge.setTaskScope({ key: "task-1", workspace: "/tmp/project-a" });
  bridge.grantTask(["shell", "file-write", "code-patch"]);

  assert.equal(await bridge.confirm("Write a file", { kind: "file-write" }), true);
  assert.equal(await bridge.confirm("Run a command", { kind: "shell" }), true);
  assert.equal(requests, 0);
  assert.equal(bridge.state().active, true);

  bridge.setTaskScope({ key: "task-2", workspace: "/tmp/project-a" });
  const decision = bridge.confirm("Write another file", { kind: "file-write" });
  assert.equal(requests, 1);
  const pending = [...bridge.pending.keys()][0];
  bridge.resolve(pending, false);
  assert.equal(await decision, false);
  assert.equal(bridge.state().active, false);
});

test("task-scoped local grants never cover browser or company action classes", async () => {
  let request;
  const bridge = new DesktopApprovalBridge({ onRequest: (value) => { request = value; } });
  bridge.setTaskScope({ key: "task-1", workspace: "/tmp/project-a" });
  bridge.grantTask(["shell", "file-write", "code-patch"]);

  const decision = bridge.confirm("Submit an external form", { kind: "browser-action" });
  assert.equal(request.kind, "browser-action");
  bridge.resolve(request.id, false);
  assert.equal(await decision, false);
});
