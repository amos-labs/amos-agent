// An execution outcome is not a claim that the user's artifact was verified.
// Only a controller-owned completion gate may provide verified: true.
const REASONS = new Map([
  ["completed", new Set(["answer_returned", "user_checkpoint", "verified_delivery"])],
  ["interrupted", new Set([
    "incomplete", "verification_incomplete", "repeated_tool_request", "repeated_tool_pattern",
    "tool_failure", "capability_discovery", "tool_cycle_limit", "empty_response_recovery",
    "model_timeout_after_progress", "model_transient_after_progress", "system_sleep",
    "token_budget_exhausted", "cost_budget_exhausted", "tool_call_budget_exhausted",
    "wall_time_budget_exhausted"
  ])],
  ["failed", new Set(["model_failure", "invalid_completion"])],
  ["cancelled", new Set(["user_cancelled"])]
]);

export function normalizeAgentOutcome(value) {
  const status = REASONS.has(value?.status) ? value.status : "interrupted";
  const fallback = { completed: "answer_returned", interrupted: "incomplete", failed: "model_failure", cancelled: "user_cancelled" };
  const reason = REASONS.get(status).has(value?.reason) ? value.reason : fallback[status];
  return Object.freeze({ status, reason, verified: status === "completed" && value?.verified === true });
}

export function guardedAgentOutcome(reason) {
  // The source is AgentLoop.guardReason, not model text. Keep the public outcome
  // bounded even if a future guard adds a longer explanation or an unknown kind.
  const text = typeof reason === "string" ? reason : "";
  let code = "incomplete";
  if (text.startsWith("the same ")) code = "repeated_tool_request";
  else if (/^a \d+-step tool-request cycle /.test(text)) code = "repeated_tool_pattern";
  else if (text.startsWith("a tool failure persisted")) code = "tool_failure";
  else if (text.startsWith("capability discovery repeated")) code = "capability_discovery";
  else if (text.startsWith("the task reached its ")) code = "tool_cycle_limit";
  return normalizeAgentOutcome({ status: "interrupted", reason: code });
}

export function agentOutcomeForError(error, signal = null) {
  if (signal?.aborted || error?.name === "AbortError" || error?.code === "AMOS_TASK_CANCELED") {
    const reason = signal?.reason;
    if (["system_sleep", "token_budget_exhausted", "cost_budget_exhausted", "tool_call_budget_exhausted", "wall_time_budget_exhausted"].includes(reason)) {
      return normalizeAgentOutcome({ status: "interrupted", reason });
    }
    return normalizeAgentOutcome({ status: "cancelled", reason: "user_cancelled" });
  }
  if (error?.code === "AMOS_MODEL_TIMEOUT_AFTER_PROGRESS") {
    return normalizeAgentOutcome({ status: "interrupted", reason: "model_timeout_after_progress" });
  }
  if (error?.code === "AMOS_MODEL_TRANSIENT_AFTER_PROGRESS") {
    return normalizeAgentOutcome({ status: "interrupted", reason: "model_transient_after_progress" });
  }
  if (error?.code === "AMOS_CODING_LIFECYCLE_INCOMPLETE") {
    return normalizeAgentOutcome({ status: "interrupted", reason: "verification_incomplete" });
  }
  return normalizeAgentOutcome({
    status: "failed", reason: error?.code === "AMOS_MODEL_INVALID_COMPLETION" ? "invalid_completion" : "model_failure"
  });
}
