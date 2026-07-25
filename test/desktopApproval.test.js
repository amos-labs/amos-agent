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

test("desktop approval bridge denies pending work when the runtime resets", async () => {
  const bridge = new DesktopApprovalBridge();
  const decision = bridge.confirm("Write a local file");
  bridge.cancelAll();
  assert.equal(await decision, false);
});
