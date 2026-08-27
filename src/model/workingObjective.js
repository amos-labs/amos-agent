const MAX_OBJECTIVE_CHARS = 6_000;
const MAX_JOB_STACK = 8;
const THIN_FOLLOW_UP_CHARS = 24;
const JOB_SNIPPET_CHARS = 220;

export function isThinFollowUp(text) {
  return String(text || "").trim().length < THIN_FOLLOW_UP_CHARS;
}

export function selectWorkingObjective(current, next) {
  const incoming = String(next || "").trim();
  const existing = String(current || "").trim();
  if (!incoming) return existing;
  if (!existing) return incoming.slice(0, MAX_OBJECTIVE_CHARS);
  // Short follow-ups ("try again", "is it live") stay on the current job.
  // A new non-thin statement is a job hop: integration → QBO → Stripe tax.
  if (isThinFollowUp(incoming)) return existing;
  return incoming.slice(0, MAX_OBJECTIVE_CHARS);
}

export function pushRecentJob(stack, text) {
  const incoming = String(text || "").trim();
  if (isThinFollowUp(incoming)) return Array.isArray(stack) ? [...stack] : [];
  const next = Array.isArray(stack) ? [...stack] : [];
  const snippet = incoming.slice(0, JOB_SNIPPET_CHARS);
  if (next[next.length - 1] === snippet) return next;
  next.push(snippet);
  return next.slice(-MAX_JOB_STACK);
}

export function userMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map((item) => {
    if (item?.type === "text") return String(item.text || "");
    return "";
  }).join("\n");
}

