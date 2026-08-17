import test from "node:test";
import assert from "node:assert/strict";
import { createDecisionInputTool } from "../src/tools/decisionInput.js";
import { DesktopApprovalBridge } from "../src/desktop/approvalBridge.js";

test("desktop_request_decision parks one question and returns the typed answer", async () => {
  const bridge = new DesktopApprovalBridge();
  const tool = createDecisionInputTool();
  const pending = tool.handler({
    question: "Which market should we enter first?",
    title: "First market",
    options: ["Austin", "Denver"]
  }, { approvals: bridge });
  const request = bridge.pendingRequests()[0];
  assert.equal(request.kind, "decision-input");
  assert.equal(bridge.resolveInput(request.id, { answered: true, answer: "Austin" }), true);
  assert.deepEqual(await pending, {
    ok: true,
    parked: true,
    answered: true,
    answer: "Austin"
  });
});

test("desktop_request_decision degrades when Decisions input is unavailable", async () => {
  const tool = createDecisionInputTool();
  const result = await tool.handler({ question: "Need a choice?" }, {});
  assert.equal(result.ok, false);
  assert.equal(result.parked, false);
  assert.match(result.error, /Decisions/);
});
