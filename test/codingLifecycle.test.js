import test from "node:test";
import assert from "node:assert/strict";

import {
  CodingLifecycle,
  codingVerificationPendingNote,
  isCodingBudgetStopReason
} from "../src/model/codingLifecycle.js";

const now = () => new Date("2026-08-16T12:00:00.000Z");

test("coding lifecycle deterministically requires plan, build, and independent approval", () => {
  const lifecycle = new CodingLifecycle({ now });
  assert.equal(lifecycle.state().role, "planner");
  assert.throws(
    () => lifecycle.report({ outcome: "approved", summary: "Looks good" }),
    /planner stage cannot report approved/
  );

  assert.equal(
    lifecycle.report({ outcome: "plan_ready", summary: "Change two files" }).nextRole,
    "implementer"
  );
  const implementation = lifecycle.report({
    outcome: "implementation_ready",
    summary: "Patch and tests ready",
    evidence: ["npm test passed", "git diff inspected"]
  });
  assert.equal(implementation.nextRole, "checker");
  assert.equal(implementation.verification, "pending");
  assert.equal(lifecycle.completionGate().allow, false);

  const approved = lifecycle.report({
    outcome: "approved",
    summary: "Diff and tests independently checked"
  });
  assert.equal(approved.status, "completed");
  assert.equal(approved.verification, "verified");
  assert.equal(lifecycle.completionGate().allow, true);
});

test("checker repair returns to implementation and cannot be silently skipped", () => {
  const lifecycle = new CodingLifecycle({ now });
  lifecycle.handoff({ role: "implementer", summary: "Plan ready" });
  lifecycle.handoff({ role: "checker", summary: "Implementation ready" });
  const repair = lifecycle.handoff({ role: "implementer", summary: "Fix the failing edge case" });
  assert.equal(repair.role, "implementer");
  assert.equal(repair.verification, "failed");
  assert.equal(repair.repairCycles, 1);
  assert.throws(
    () => lifecycle.handoff({ role: "planner", summary: "Skip back" }),
    /cannot hand off directly/
  );
});

test("no-code-change is an explicit terminal result", () => {
  const lifecycle = new CodingLifecycle({ now });
  const result = lifecycle.report({
    outcome: "no_code_change",
    summary: "Current source already implements the requested behavior"
  });
  assert.equal(result.status, "completed");
  assert.equal(result.verification, "skipped");
  assert.equal(result.skipReason, "no_code_change");
});

test("budget or provider interruption preserves a visible verification-pending state", () => {
  const lifecycle = new CodingLifecycle({ now });
  lifecycle.report({ outcome: "plan_ready", summary: "Plan" });
  lifecycle.report({ outcome: "implementation_ready", summary: "Built" });
  const state = lifecycle.interrupt("budget_exhausted", "token_budget_exhausted");
  assert.equal(state.status, "interrupted");
  assert.equal(state.verification, "pending");
  assert.equal(state.skipReason, "budget_exhausted");
  assert.match(codingVerificationPendingNote(state), /did not mark this coding task complete/);

  assert.equal(isCodingBudgetStopReason("token_budget_exhausted"), true);
  assert.equal(isCodingBudgetStopReason("cost_budget_exhausted"), true);
  assert.equal(isCodingBudgetStopReason("the model thinks time is short"), false);
});
