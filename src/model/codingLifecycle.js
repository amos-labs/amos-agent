import { normalizeIntelligenceRole } from "./intelligenceRoles.js";

export const CODING_LIFECYCLE_OUTCOMES = Object.freeze([
  "plan_ready",
  "implementation_ready",
  "approved",
  "repair_required",
  "no_code_change"
]);

export const CODING_LIFECYCLE_STOP_REASONS = Object.freeze([
  "budget_exhausted",
  "provider_failed",
  "user_cancelled",
  "execution_failed"
]);

const ALLOWED_OUTCOMES = Object.freeze({
  planner: Object.freeze(["plan_ready", "no_code_change"]),
  implementer: Object.freeze(["implementation_ready", "no_code_change"]),
  checker: Object.freeze(["approved", "repair_required", "no_code_change"])
});

const HANDOFF_OUTCOMES = Object.freeze({
  "planner:implementer": "plan_ready",
  "implementer:checker": "implementation_ready",
  "checker:implementer": "repair_required"
});

export class CodingLifecycle {
  constructor({ initialRole = "planner", now = () => new Date() } = {}) {
    this.now = now;
    this.role = normalizeIntelligenceRole(initialRole, "planner");
    this.status = "running";
    this.verification = "not_started";
    this.skipReason = null;
    this.planReady = this.role !== "planner";
    this.implementationReady = this.role === "checker";
    this.repairCycles = 0;
    this.history = [];
  }

  report({ outcome, summary = "", evidence = [] } = {}) {
    this.assertRunning();
    const normalizedOutcome = String(outcome || "").trim();
    if (!CODING_LIFECYCLE_OUTCOMES.includes(normalizedOutcome)) {
      throw new Error(`Unknown coding-stage outcome: ${normalizedOutcome || "missing"}`);
    }
    const allowed = ALLOWED_OUTCOMES[this.role] || [];
    if (!allowed.includes(normalizedOutcome)) {
      throw new Error(
        `The ${this.role} stage cannot report ${normalizedOutcome}; expected ${allowed.join(" or ")}`
      );
    }

    const entry = {
      sequence: this.history.length + 1,
      role: this.role,
      outcome: normalizedOutcome,
      summary: clean(summary, 4_000),
      evidence: cleanEvidence(evidence),
      at: this.now().toISOString()
    };
    let nextRole = null;

    if (normalizedOutcome === "plan_ready") {
      this.planReady = true;
      this.role = "implementer";
      nextRole = this.role;
    } else if (normalizedOutcome === "implementation_ready") {
      this.planReady = true;
      this.implementationReady = true;
      this.verification = "pending";
      this.role = "checker";
      nextRole = this.role;
    } else if (normalizedOutcome === "repair_required") {
      this.implementationReady = false;
      this.verification = "failed";
      this.repairCycles += 1;
      this.role = "implementer";
      nextRole = this.role;
    } else if (normalizedOutcome === "approved") {
      this.implementationReady = true;
      this.verification = "verified";
      this.status = "completed";
    } else if (normalizedOutcome === "no_code_change") {
      this.implementationReady = false;
      this.verification = "skipped";
      this.skipReason = "no_code_change";
      this.status = "completed";
    }

    this.history.push(entry);
    return { ...this.state(), nextRole };
  }

  handoff({ role, summary = "" } = {}) {
    this.assertRunning();
    const nextRole = normalizeIntelligenceRole(role, "");
    const outcome = HANDOFF_OUTCOMES[`${this.role}:${nextRole}`];
    if (!outcome) {
      throw new Error(
        `Coding lifecycle cannot hand off directly from ${this.role} to ${nextRole || "an unknown role"}`
      );
    }
    return this.report({ outcome, summary });
  }

  interrupt(reason, detail = "") {
    if (this.status !== "running") return this.state();
    const normalizedReason = CODING_LIFECYCLE_STOP_REASONS.includes(reason)
      ? reason
      : "execution_failed";
    this.status = "interrupted";
    this.skipReason = normalizedReason;
    if (this.implementationReady && this.verification !== "verified") {
      this.verification = "pending";
    }
    this.history.push({
      sequence: this.history.length + 1,
      role: this.role,
      outcome: "interrupted",
      summary: clean(detail, 4_000),
      evidence: [],
      reason: normalizedReason,
      at: this.now().toISOString()
    });
    return this.state();
  }

  completionGate() {
    if (this.status === "completed") return { allow: true, state: this.state() };
    if (this.status === "interrupted") return { allow: false, state: this.state() };
    const outcomes = ALLOWED_OUTCOMES[this.role] || [];
    return {
      allow: false,
      state: this.state(),
      message: [
        `<amos_coding_stage_required role="${this.role}">`,
        `The controller cannot complete this coding task from the ${this.role} stage.`,
        `Call desktop_report_coding_stage with one of: ${outcomes.join(", ")}.`,
        "Do not infer that time is short or silently skip the remaining build/check stages.",
        "</amos_coding_stage_required>"
      ].join("\n")
    };
  }

  state() {
    return {
      version: 1,
      status: this.status,
      role: this.role,
      planReady: this.planReady,
      implementationReady: this.implementationReady,
      verification: this.verification,
      skipReason: this.skipReason,
      repairCycles: this.repairCycles,
      history: this.history.map((entry) => ({ ...entry, evidence: [...entry.evidence] }))
    };
  }

  assertRunning() {
    if (this.status !== "running") {
      throw new Error(`Coding lifecycle is already ${this.status}`);
    }
  }
}

const BUDGET_STOP_REASONS = new Set([
  "token_budget_exhausted",
  "cost_budget_exhausted",
  "tool_call_budget_exhausted",
  "wall_time_budget_exhausted"
]);

export function isCodingBudgetStopReason(value) {
  return BUDGET_STOP_REASONS.has(String(value || "").trim());
}

export function codingVerificationPendingNote(state, detail = "") {
  if (state?.verification !== "pending" || state?.status !== "interrupted") return "";
  const reason = state.skipReason === "budget_exhausted"
    ? "the configured run budget was exhausted"
    : state.skipReason === "provider_failed"
      ? "the checker model or provider failed"
      : "the run stopped before the checker finished";
  return [
    `Implementation completed, but verification is pending because ${reason}.`,
    "AMOS did not mark this coding task complete.",
    clean(detail, 500)
  ].filter(Boolean).join(" ");
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function cleanEvidence(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => clean(item, 1_000))
    .filter(Boolean)
    .slice(0, 20);
}
