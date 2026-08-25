import test from "node:test";
import assert from "node:assert/strict";
import { createDecisionInputTool } from "../src/tools/decisionInput.js";
import { DesktopApprovalBridge } from "../src/desktop/approvalBridge.js";

test("desktop_request_decision tells the model to ask in the conversation", async () => {
  const bridge = new DesktopApprovalBridge();
  const tool = createDecisionInputTool();
  const result = await tool.handler({
    question: "Which market should we enter first?",
    title: "First market",
    options: ["Austin", "Denver"]
  }, { approvals: bridge });
  assert.equal(result.ok, false);
  assert.equal(result.parked, false);
  assert.equal(result.ask_in_conversation, true);
  assert.equal(result.question, "Which market should we enter first?");
  assert.match(result.error, /conversation/);
  assert.equal(bridge.pendingRequests().length, 0);
});

test("desktop_request_decision still requires a question", async () => {
  const tool = createDecisionInputTool();
  const result = await tool.handler({ question: "   " }, {});
  assert.equal(result.ok, false);
  assert.equal(result.parked, false);
  assert.match(result.error, /question is required/i);
});
