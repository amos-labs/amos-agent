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

test("desktop approval bridge parks a Decisions question until the user answers", async () => {
  let request;
  const bridge = new DesktopApprovalBridge({ onRequest: (value) => (request = value) });
  const pending = bridge.ask("Which location should launch first?", {
    title: "Launch market",
    context: "The recommendation changes the first-store plan.",
    options: ["Austin", "Denver"]
  });

  assert.equal(request.kind, "decision-input");
  assert.equal(request.decisionType, "general");
  assert.equal(request.message, "Which location should launch first?");
  assert.deepEqual(request.options, ["Austin", "Denver"]);
  assert.equal(bridge.pendingRequests().length, 1);
  assert.equal(bridge.resolveInput(request.id, { answered: true, answer: "Austin" }), true);
  assert.deepEqual(await pending, { answered: true, answer: "Austin" });
  assert.equal(bridge.pendingRequests().length, 0);
});

test("desktop approval bridge marks research checkpoints for one-click inline choices", async () => {
  let request;
  const bridge = new DesktopApprovalBridge({ onRequest: (value) => (request = value) });
  const pending = bridge.ask("Answer now or continue?", {
    title: "Research checkpoint",
    options: ["Synthesize now", "Research 5 more minutes"],
    decisionType: "research-checkpoint"
  });

  assert.equal(request.kind, "decision-input");
  assert.equal(request.decisionType, "research-checkpoint");
  bridge.resolveInput(request.id, { answered: true, answer: "Synthesize now" });
  assert.deepEqual(await pending, { answered: true, answer: "Synthesize now" });
});

test("desktop approval bridge does not treat a skipped Decisions question as an answer", async () => {
  const bridge = new DesktopApprovalBridge();
  const pending = bridge.ask("What budget should this Project use?");
  const id = [...bridge.pending.keys()][0];
  assert.equal(bridge.resolveInput(id, { answered: false, answer: "" }), true);
  assert.deepEqual(await pending, { answered: false, answer: "" });
});
