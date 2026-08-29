import { digestResearchValue } from "./experimentProtocol.js";

export const AMOS_MISSION_WORKER_CONTRACT = "amos-mission-worker:2026-09-06";

const DECISIONS = new Set(["tool", "checkpoint", "ask_user", "verify", "fail"]);

/**
 * Detect the Platform's bounded Mission-planner envelope without treating an
 * arbitrary chat request as governed work. The Platform remains authoritative:
 * this metadata is used only to specialize Swarm deliberation and correlate
 * its trace with the immutable Run Contract and later checker receipts.
 */
export function detectMissionWorkerRequest(request) {
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = messageText(message).trim();
    if (!text.startsWith("{")) continue;
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      continue;
    }
    if (envelope?.contract !== AMOS_MISSION_WORKER_CONTRACT) continue;
    const mission = object(envelope.mission, "mission worker envelope.mission");
    const verificationPolicy = object(
      mission.verification_policy,
      "mission worker envelope.mission.verification_policy"
    );
    const recoveryFeedback = mission.recovery_feedback == null
      ? null
      : object(mission.recovery_feedback, "mission worker envelope.mission.recovery_feedback");
    return {
      contract: AMOS_MISSION_WORKER_CONTRACT,
      missionId: requiredText(mission.mission_id, "mission_id", 160),
      contractId: requiredText(mission.contract_id, "contract_id", 160),
      plannerAttempt: boundedInteger(mission.planner_attempt, 1, 1_000_000, "planner_attempt"),
      verificationPolicyDigest: digestResearchValue(verificationPolicy),
      allowedOperationsDigest: digestResearchValue(mission.allowed_operations ?? []),
      budgetDigest: digestResearchValue(mission.budgets ?? {}),
      outputSchemaDigest: digestResearchValue(envelope.output_schema ?? {}),
      recoveryKind: recoveryFeedback == null
        ? null
        : boundedText(recoveryFeedback.kind, 120).trim() || null,
      recoveryFeedbackDigest: recoveryFeedback == null
        ? null
        : digestResearchValue(recoveryFeedback)
    };
  }
  return null;
}

/** Parse and canonicalize one Platform Mission plan exactly as the Rust worker does. */
export function parseMissionPlan(text) {
  const value = extractJsonObject(text);
  const decision = requiredText(value.decision, "mission plan decision", 100);
  if (!DECISIONS.has(decision)) throw new Error(`unsupported mission plan decision ${decision}`);
  if (decision === "tool") {
    return {
      decision,
      summary: requiredText(value.summary, "tool summary", 2_000),
      verb: requiredText(value.verb, "tool verb", 200),
      args: boundedObject(value.args ?? {}, "tool args", 262_144),
      checkpoint: boundedObject(value.checkpoint ?? {}, "tool checkpoint", 131_072)
    };
  }
  if (decision === "checkpoint") {
    return {
      decision,
      summary: requiredText(value.summary, "checkpoint summary", 2_000),
      checkpoint: boundedObject(value.checkpoint ?? {}, "checkpoint", 131_072)
    };
  }
  if (decision === "ask_user") {
    const options = value.options ?? [];
    if (!Array.isArray(options) || options.length > 12) {
      throw new Error("mission question options must contain at most 12 choices");
    }
    return {
      decision,
      question: requiredText(value.question, "mission question", 4_000),
      options: options.map((option, index) =>
        requiredText(option, `mission question option ${index + 1}`, 500)),
      authority_expansion: value.authority_expansion === true,
      context: boundedObject(value.context ?? {}, "mission question context", 32_768)
    };
  }
  if (decision === "verify") {
    return {
      decision,
      summary: requiredText(value.summary, "verification summary", 2_000)
    };
  }
  return {
    decision,
    reason: requiredText(value.reason, "failure reason", 4_000),
    retryable: value.retryable === true
  };
}

export function missionPlanRecoveryPayload(request, response, error, model, maximumOutputTokens) {
  const payload = structuredClone(request);
  delete payload.tools;
  delete payload.tool_choice;
  delete payload.parallel_tool_calls;
  return {
    ...payload,
    model,
    stream: false,
    temperature: 0,
    max_tokens: maximumOutputTokens,
    enable_thinking: false,
    reasoning_effort: undefined,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      ...payload.messages,
      {
        role: "assistant",
        content: boundedText(messageText(response?.choices?.[0]?.message), 8_000)
      },
      {
        role: "user",
        content:
          "The prior answer did not satisfy the immutable AMOS Mission worker contract: " +
          `${boundedText(error?.message || error, 1_000)}. Return exactly one complete JSON ` +
          "Mission plan object now, with no markdown or commentary. Do not replay any tool or " +
          "claim completion; the Platform will validate authority and run independent checkers."
      }
    ]
  };
}

export function withCanonicalMissionPlan(response, plan) {
  const result = structuredClone(response);
  result.choices[0].message = {
    role: "assistant",
    content: JSON.stringify(plan)
  };
  result.choices[0].finish_reason = "stop";
  return result;
}

function extractJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length > 65_536) throw new Error("mission plan exceeds 64 KiB");
  try {
    return object(JSON.parse(trimmed), "mission plan");
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("mission plan contains no JSON object");
  try {
    return object(JSON.parse(trimmed.slice(start, end + 1)), "mission plan");
  } catch {
    throw new Error("mission plan contains invalid JSON");
  }
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n");
  }
  return "";
}

function boundedObject(value, label, maximumBytes) {
  const normalized = object(value, label);
  if (JSON.stringify(normalized).length > maximumBytes) {
    throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  }
  return normalized;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value);
}

function requiredText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function boundedText(value, maximum) {
  const text = String(value ?? "");
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}
