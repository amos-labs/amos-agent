export const SEQUENTIAL_TOOL_POLICY =
  "Tool execution is sequential. Call at most one tool in each response. " +
  "Never call a tool until every required argument is grounded in the user request, " +
  "trusted context, or a completed tool result. Do not guess identifiers.";

export const ANSWER_RECOVERY_PROMPT =
  "Your private reasoning phase is complete. Return the requested visible final answer now. " +
  "Do not add more private reasoning, repeat the analysis, or describe this recovery step. " +
  "Follow the original output-format instructions exactly.";

export function completionBudget({ maxOutputTokens, answerReserveTokens = 0 }) {
  const maximum = boundedInteger(maxOutputTokens, 1, 131_072, "maxOutputTokens");
  const reserve = boundedInteger(answerReserveTokens, 0, maximum - 1, "answerReserveTokens");
  return {
    maxOutputTokens: maximum,
    reasoningPhaseTokens: maximum - reserve,
    answerReserveTokens: reserve
  };
}

export function withSequentialToolPolicy(messages, tools = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }
  if (!Array.isArray(tools)) throw new Error("tools must be an array");
  const copy = structuredClone(messages);
  if (tools.length < 2) return copy;
  const first = copy[0];
  if (first?.role === "system") {
    const content = String(first.content || "").trim();
    if (!content.includes(SEQUENTIAL_TOOL_POLICY)) {
      first.content = content ? `${content}\n\n${SEQUENTIAL_TOOL_POLICY}` : SEQUENTIAL_TOOL_POLICY;
    }
    return copy;
  }
  return [{ role: "system", content: SEQUENTIAL_TOOL_POLICY }, ...copy];
}

export function requiresVisibleAnswerRecovery(message) {
  if (!message || typeof message !== "object") return true;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return false;
  return !visibleText(message.content);
}

export function visibleAnswerRecoveryMessages(messages, reasoningMessage) {
  const transcript = structuredClone(messages);
  const prior = reasoningContinuationMessage(reasoningMessage);
  if (prior) transcript.push(prior);
  transcript.push({ role: "user", content: ANSWER_RECOVERY_PROMPT });
  return transcript;
}

export async function runResearchInference({
  worker,
  caseId,
  messages,
  tools = [],
  dataManifestDigest,
  repetition = 1,
  maxOutputTokens,
  answerReserveTokens = 0,
  promptSessionId = null,
  signal = null
}) {
  if (!worker || typeof worker.runCase !== "function") {
    throw new Error("runResearchInference requires a worker with runCase()");
  }
  const budget = completionBudget({ maxOutputTokens, answerReserveTokens });
  const governedMessages = withSequentialToolPolicy(messages, tools);
  const first = await worker.runCase({
    caseId: `${caseId}:reasoning`,
    messages: governedMessages,
    tools,
    dataManifestDigest,
    repetition,
    maxOutputTokens: budget.reasoningPhaseTokens,
    reasoningEffortOverride: null,
    promptSessionId,
    signal
  });
  const observations = [first];
  let final = first;
  let recoveryTriggered = false;

  if (
    budget.answerReserveTokens > 0 &&
    requiresVisibleAnswerRecovery(first.message)
  ) {
    recoveryTriggered = true;
    final = await worker.runCase({
      caseId: `${caseId}:answer`,
      messages: visibleAnswerRecoveryMessages(governedMessages, first.message),
      tools,
      dataManifestDigest,
      repetition,
      maxOutputTokens: budget.answerReserveTokens,
      reasoningEffortOverride: "none",
      promptSessionId,
      signal
    });
    observations.push(final);
  }

  return {
    message: final.message,
    observations,
    budget,
    recoveryTriggered,
    metrics: aggregateObservationMetrics(observations)
  };
}

export function aggregateObservationMetrics(observations) {
  const metrics = {
    requests: 0,
    wallMilliseconds: 0,
    promptTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    promptMilliseconds: 0,
    generationMilliseconds: 0
  };
  for (const observation of observations || []) {
    const value = observation?.metrics || {};
    metrics.requests += 1;
    for (const field of [
      "wallMilliseconds",
      "promptTokens",
      "outputTokens",
      "cachedInputTokens",
      "promptMilliseconds",
      "generationMilliseconds"
    ]) {
      const amount = Number(value[field] || 0);
      if (Number.isFinite(amount) && amount > 0) metrics[field] += amount;
    }
  }
  metrics.promptTokensPerSecond = rate(metrics.promptTokens, metrics.promptMilliseconds);
  metrics.generationTokensPerSecond = rate(metrics.outputTokens, metrics.generationMilliseconds);
  return metrics;
}

function reasoningContinuationMessage(message) {
  if (!message || typeof message !== "object") return null;
  const continuation = {
    role: "assistant",
    content: typeof message.content === "string" ? message.content : ""
  };
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    continuation.reasoning_content = message.reasoning_content;
  } else if (!continuation.content) {
    continuation.content = "I completed the analysis but did not emit the final answer.";
  }
  return continuation;
}

function visibleText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part === "string" ? part : part?.text || "")
    .join("")
    .trim();
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function rate(tokens, milliseconds) {
  return milliseconds > 0 && tokens > 0
    ? Number((tokens / (milliseconds / 1_000)).toFixed(3))
    : null;
}
