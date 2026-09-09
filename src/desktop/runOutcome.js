// Shared presentation for structured interruptions returned by the controller.
// A resolved promise can carry partial work; it does not imply task completion.
const EXPLANATIONS = new Map([
  ["model_timeout_after_progress", "The model timed out after making progress."],
  ["model_transient_after_progress", "The model connection failed after making progress."],
  ["system_sleep", "The task was interrupted when the computer went to sleep."],
  ["budget_exhausted", "The task reached its configured budget before completion."]
]);

export function runInterruptionMessage(result = {}) {
  const explanation = EXPLANATIONS.get(result?.recovery?.reason) || "The task stopped before completion.";
  return `${explanation} Review the saved progress and continue when ready.`;
}
