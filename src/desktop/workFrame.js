const MAX_FIELD = 500;
const MAX_OUTCOME = 900;

export function compileWorkFrame({
  task = null,
  settings = null,
  checkpoint = null,
  prompt = ""
} = {}) {
  const grant = clean(settings?.workspace || task?.workspace?.localPath || "", 400);
  const focus = clean(task?.workspace?.focusPath || "", 400);
  const conversationTitle = clean(task?.title || "", 200);
  const conversationObjective = clean(task?.objective || "", MAX_FIELD);
  const lastOutcome = clean(task?.outcome?.summary || "", MAX_OUTCOME);
  const current = clean(prompt, MAX_FIELD);
  const rawCheckpointObjective = clean(checkpoint?.objective || "", MAX_FIELD);
  const sameAsPrompt = Boolean(current && rawCheckpointObjective === current);
  const lastCheckpointObjective = sameAsPrompt ? "" : rawCheckpointObjective;
  const lastCheckpointTitle = sameAsPrompt ? "" : clean(checkpoint?.title || "", 200);
  const combined = [
    conversationTitle,
    conversationObjective,
    lastOutcome,
    lastCheckpointObjective,
    lastCheckpointTitle
  ].join("\n");
  const pullRequest = extractPullRequest(combined);
  return {
    grant,
    focus,
    conversationTitle,
    conversationObjective,
    lastOutcome,
    lastCheckpointObjective,
    lastCheckpointTitle,
    pullRequest,
    family: inferFamily(combined, pullRequest),
    bound: Boolean(focus && grant && pathsDiffer(grant, focus)),
    prompt: current
  };
}

export function workFramePrompt(frame) {
  if (!frameHasContent(frame)) return "";
  const bound = frame.bound
    ? `Bound project: ${frame.focus}`
    : "Bound project: none. If this grant contains nested repos, ask which project before searching the grant.";
  return [
    "<amos_work_frame>",
    "Current conversation work. Stay on this unless the user clearly switches.",
    frame.grant ? `Workspace grant: ${frame.grant}` : "",
    bound,
    frame.conversationTitle ? `Conversation: ${frame.conversationTitle}` : "",
    frame.conversationObjective && frame.conversationObjective !== frame.conversationTitle
      ? `Conversation objective: ${frame.conversationObjective}`
      : "",
    frame.lastCheckpointTitle || frame.lastCheckpointObjective
      ? `Latest thread: ${frame.lastCheckpointTitle || frame.lastCheckpointObjective}`
      : "",
    frame.pullRequest ? `Pull request: ${frame.pullRequest}` : "",
    frame.lastOutcome ? `Last result: ${frame.lastOutcome}` : "",
    "If the goal or project is unclear, ask in the conversation before searching.",
    "</amos_work_frame>"
  ].filter(Boolean).join("\n");
}

export function workflowSelectionText(frame, prompt) {
  const current = String(prompt || "").trim();
  if (!current) return frameSelectionText(frame);
  if (!isAmbiguousFollowUp(current)) return current;
  return [frameSelectionText(frame), current].filter(Boolean).join("\n");
}

export function isAmbiguousFollowUp(value) {
  const normalized = normalizePrompt(value);
  if (!normalized || normalized.length > 140) return false;
  if (/^(?:(?:ok|okay|great|yes|yep|sure)\s+)*(?:continue|resume|keep going|carry on|pick up where (?:we|you) left off|continue where (?:we|you) left off|where were we)$/.test(normalized)) {
    return true;
  }
  return /(?:go(?:ing)? in circles|in circles|try again|still in|fix that|same (?:thing|work|pr|one)|not working|keep (?:going|at it)|we are stuck)/.test(normalized);
}

function frameSelectionText(frame) {
  if (!frame) return "";
  return [
    frame.pullRequest,
    frame.lastCheckpointObjective,
    frame.lastCheckpointTitle,
    frame.conversationObjective,
    frame.conversationTitle,
    frame.lastOutcome
  ].filter(Boolean).join("\n");
}

function inferFamily(text, pullRequest) {
  if (pullRequest) return "coding";
  const lowered = String(text || "").toLowerCase();
  if (/\b(?:pull request|\bpr\b|rework|github|codebase|apply a patch|run the tests|slice \d+)\b/.test(lowered)) {
    return "coding";
  }
  return "";
}

function extractPullRequest(text) {
  const match = String(text || "").match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:pull|issues)\/\d+/i);
  return match ? match[0] : "";
}

function frameHasContent(frame) {
  return Boolean(
    frame &&
    (frame.grant || frame.focus || frame.conversationObjective || frame.conversationTitle
      || frame.lastOutcome || frame.lastCheckpointObjective || frame.pullRequest)
  );
}

function pathsDiffer(left, right) {
  return String(left).replace(/\/+$/, "") !== String(right).replace(/\/+$/, "");
}

function normalizePrompt(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.!?,;:…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
