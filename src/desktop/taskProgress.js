const STAGES = new Map([
  ["planning", "Planning the work"],
  ["building", "Creating the draft"],
  ["checking", "Checking the draft"],
  ["repairing", "Addressing the remaining checks"],
  ["ready", "Ready for review"],
  ["partial", "Checks remain"],
  ["blocked", "Needs input"]
]);

function boundedText(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

// Only lifecycle events advance this status. Model wait, token, and tool events
// remain diagnostics; they cannot replace a concrete saved/checking result.
export function taskProgressFromEvent(event) {
  if (event?.type !== "task_progress" || !STAGES.has(event.stage)) return null;
  return {
    stage: event.stage,
    summary: boundedText(event.summary, 180),
    detail: boundedText(event.detail, 240),
    checks: (Array.isArray(event.checks) ? event.checks : []).slice(0, 20)
      .filter(check => ["passed", "failed", "pending"].includes(check?.status))
      .map(check => ({ label: boundedText(check.label, 100), status: check.status }))
  };
}

export function taskProgressStatus(progress) {
  if (!progress || !STAGES.has(progress.stage)) return null;
  const label = STAGES.get(progress.stage);
  const counts = { passed: 0, failed: 0, pending: 0 };
  for (const check of progress.checks) counts[check.status] += 1;
  const checked = Object.values(counts).reduce((total, count) => total + count, 0);
  const checkSummary = checked
    ? [
      `${counts.passed}/${checked} checks passed`,
      counts.failed ? `${counts.failed} need attention` : "",
      counts.pending ? `${counts.pending} pending` : ""
    ].filter(Boolean).join(" · ")
    : "";
  return {
    message: progress.summary && progress.summary !== label ? `${label} · ${progress.summary}` : label,
    detail: [progress.detail, checkSummary].filter(Boolean).join(" · "),
    status: ["partial", "blocked"].includes(progress.stage) ? "waiting" : progress.stage === "ready" ? "completed" : "active",
    terminal: ["ready", "partial", "blocked"].includes(progress.stage)
  };
}
