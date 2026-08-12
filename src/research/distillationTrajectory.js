import { createHash } from "node:crypto";

const TRAJECTORY_SCHEMA = "amos.distillation-trajectory";
const SPLITS = new Set(["train", "validation", "evaluation"]);
const SOURCE_TYPES = new Set(["synthetic", "human_authored", "public", "consented_product"]);
const ROUTES = new Set(["routine", "balanced_non_deep", "deep", "frontier"]);
const OUTCOMES = new Set(["local_answer", "escalate"]);
const VERIFYING_METHODS = new Set(["deterministic", "executable", "human"]);
const MESSAGE_ROLES = new Set(["system", "user", "assistant", "tool"]);
const SENSITIVE_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization|cookie)/i;

export function validateDistillationTrajectory(value, options = {}) {
  const allowConsentedProduct = options.allowConsentedProduct === true;
  if (value?.schema !== TRAJECTORY_SCHEMA || value?.version !== 1) {
    throw new Error(`Expected ${TRAJECTORY_SCHEMA} version 1`);
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(value.id || "")) {
    throw new Error("Trajectory requires a stable lowercase id");
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(value.family_id || "")) {
    throw new Error(`Trajectory ${value.id} requires a stable family_id`);
  }
  if (!SPLITS.has(value.split)) {
    throw new Error(`Trajectory ${value.id} has unsupported split ${value.split}`);
  }
  validateProvenance(value, { allowConsentedProduct });
  validateTask(value);
  validateMessages(value.id, "input.messages", value.input?.messages, { requireFinalAssistant: false });
  validateMessages(value.id, "target.messages", value.target?.messages, { requireFinalAssistant: true });
  validateToolContract(value);
  validateTarget(value);
  validateVerification(value);
  validateEfficiency(value);
  assertNoSensitiveKeys(value, "$", new Set());
  return value;
}

export function validateDistillationDataset(records, options = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Distillation dataset requires at least one trajectory");
  }
  const ids = new Set();
  const familySplits = new Map();
  for (const record of records) {
    validateDistillationTrajectory(record, options);
    if (ids.has(record.id)) throw new Error(`Duplicate trajectory id: ${record.id}`);
    ids.add(record.id);
    const priorSplit = familySplits.get(record.family_id);
    if (priorSplit && priorSplit !== record.split) {
      throw new Error(
        `Trajectory family ${record.family_id} leaks across ${priorSplit} and ${record.split}`
      );
    }
    familySplits.set(record.family_id, record.split);
  }
  return records;
}

export function compileVerifiedSft(records, options = {}) {
  validateDistillationDataset(records, options);
  const split = options.split || "train";
  if (!SPLITS.has(split)) throw new Error(`Unsupported compiled split: ${split}`);
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("Compiled record limit must be a positive integer");
  }
  const compiled = records
    .filter((record) => record.split === split)
    .filter((record) => options.includeTools !== false || !record.input?.tools?.length)
    .filter((record) => options.onlyTools !== true || record.input?.tools?.length > 0)
    .map((record) => ({
      messages: [...record.input.messages, ...record.target.messages],
      ...(Array.isArray(record.input.tools) && record.input.tools.length > 0
        ? { tools: record.input.tools }
        : {})
    }));
  return options.limit === undefined ? compiled : compiled.slice(0, options.limit);
}

export function datasetIdentity(records) {
  validateDistillationDataset(records, { allowConsentedProduct: true });
  const canonical = [...records]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => JSON.stringify(sortObject(record)))
    .join("\n");
  return {
    trajectories: records.length,
    train: records.filter((record) => record.split === "train").length,
    validation: records.filter((record) => record.split === "validation").length,
    evaluation: records.filter((record) => record.split === "evaluation").length,
    sha256: createHash("sha256").update(canonical).digest("hex")
  };
}

function validateProvenance(value, { allowConsentedProduct }) {
  const provenance = value.provenance;
  if (!SOURCE_TYPES.has(provenance?.source_type)) {
    throw new Error(`Trajectory ${value.id} requires a supported provenance source_type`);
  }
  if (typeof provenance.contains_customer_data !== "boolean") {
    throw new Error(`Trajectory ${value.id} must declare contains_customer_data`);
  }
  if (provenance.source_type === "synthetic") {
    if (provenance.contains_customer_data || !provenance.synthetic_world_id) {
      throw new Error(`Synthetic trajectory ${value.id} must name a world and contain no customer data`);
    }
  }
  if (provenance.source_type === "consented_product") {
    if (!allowConsentedProduct) {
      throw new Error(`Consented product trajectory ${value.id} is disabled for this build`);
    }
    if (
      provenance.contains_customer_data !== true ||
      provenance.data_minimized !== true ||
      !provenance.consent_receipt_id
    ) {
      throw new Error(
        `Consented product trajectory ${value.id} requires minimized data and a consent receipt`
      );
    }
  } else if (provenance.contains_customer_data) {
    throw new Error(`Trajectory ${value.id} cannot contain customer data under ${provenance.source_type}`);
  }
  if (!Array.isArray(provenance.teacher_models)) {
    throw new Error(`Trajectory ${value.id} must declare teacher_models, including an empty list`);
  }
}

function validateTask(value) {
  if (!ROUTES.has(value.task?.route)) {
    throw new Error(`Trajectory ${value.id} has unsupported task route ${value.task?.route}`);
  }
  if (!value.task?.workflow || !value.task?.risk) {
    throw new Error(`Trajectory ${value.id} requires task workflow and risk`);
  }
}

function validateMessages(id, label, messages, { requireFinalAssistant }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error(`Trajectory ${id} requires ${label}`);
  }
  for (const [index, message] of messages.entries()) {
    if (!MESSAGE_ROLES.has(message?.role)) {
      throw new Error(`Trajectory ${id} has invalid ${label}[${index}] role`);
    }
    if (
      typeof message.content !== "string" &&
      !Array.isArray(message.tool_calls) &&
      message.role !== "tool"
    ) {
      throw new Error(`Trajectory ${id} has empty ${label}[${index}] content`);
    }
    if (message.role === "tool" && (!message.tool_call_id || typeof message.content !== "string")) {
      throw new Error(`Trajectory ${id} has invalid tool result in ${label}[${index}]`);
    }
  }
  if (requireFinalAssistant && messages.at(-1)?.role !== "assistant") {
    throw new Error(`Trajectory ${id} target must end with an assistant message`);
  }
}

function validateTarget(value) {
  if (!OUTCOMES.has(value.target?.outcome)) {
    throw new Error(`Trajectory ${value.id} has unsupported target outcome`);
  }
  if (value.target.outcome === "escalate") {
    if (!value.target.escalation?.target || !value.target.escalation?.reason_code) {
      throw new Error(`Escalation trajectory ${value.id} requires target and reason_code`);
    }
  } else if (value.target.escalation) {
    throw new Error(`Local-answer trajectory ${value.id} cannot include escalation authority`);
  }
}

function validateToolContract(value) {
  const tools = value.input?.tools || [];
  if (!Array.isArray(tools)) {
    throw new Error(`Trajectory ${value.id} input.tools must be an array`);
  }

  const toolNames = new Set();
  for (const [index, tool] of tools.entries()) {
    const name = tool?.type === "function" ? tool.function?.name : null;
    if (!name || typeof tool.function?.parameters !== "object") {
      throw new Error(`Trajectory ${value.id} has invalid input.tools[${index}]`);
    }
    if (toolNames.has(name)) {
      throw new Error(`Trajectory ${value.id} defines duplicate tool ${name}`);
    }
    toolNames.add(name);
  }

  const pendingCalls = new Set();
  for (const [messageIndex, message] of value.target.messages.entries()) {
    for (const call of message.tool_calls || []) {
      const callId = call?.id;
      const name = call?.type === "function" ? call.function?.name : null;
      if (!callId || !name || !toolNames.has(name)) {
        throw new Error(
          `Trajectory ${value.id} has invalid tool call in target.messages[${messageIndex}]`
        );
      }
      if (pendingCalls.has(callId)) {
        throw new Error(`Trajectory ${value.id} reuses tool call id ${callId}`);
      }
      const argumentsValue = call.function.arguments;
      if (typeof argumentsValue === "string") {
        try {
          const parsed = JSON.parse(argumentsValue);
          if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
        } catch {
          throw new Error(`Trajectory ${value.id} tool call ${callId} has invalid JSON arguments`);
        }
      } else if (!argumentsValue || Array.isArray(argumentsValue) || typeof argumentsValue !== "object") {
        throw new Error(`Trajectory ${value.id} tool call ${callId} requires object arguments`);
      }
      pendingCalls.add(callId);
    }

    if (message.role === "tool") {
      if (!pendingCalls.delete(message.tool_call_id)) {
        throw new Error(
          `Trajectory ${value.id} has unmatched tool result ${message.tool_call_id}`
        );
      }
      try {
        JSON.parse(message.content);
      } catch {
        throw new Error(
          `Trajectory ${value.id} tool result ${message.tool_call_id} must contain JSON`
        );
      }
    }
  }

  if (pendingCalls.size > 0) {
    throw new Error(
      `Trajectory ${value.id} is missing tool results for ${[...pendingCalls].join(", ")}`
    );
  }
}

function validateVerification(value) {
  const verification = value.verification;
  if (verification?.status !== "passed") {
    throw new Error(`Trajectory ${value.id} is not verified`);
  }
  if (!Array.isArray(verification.methods) || verification.methods.length === 0) {
    throw new Error(`Trajectory ${value.id} requires verification methods`);
  }
  if (!verification.methods.some((method) => VERIFYING_METHODS.has(method.type))) {
    throw new Error(`Trajectory ${value.id} has teacher-only verification`);
  }
  if (!Array.isArray(verification.critical_contracts)) {
    throw new Error(`Trajectory ${value.id} must declare critical_contracts`);
  }
  const failed = verification.critical_contracts.filter((contract) => contract?.passed !== true);
  if (failed.length > 0) {
    throw new Error(`Trajectory ${value.id} failed critical contracts`);
  }
}

function validateEfficiency(value) {
  const efficiency = value.efficiency;
  if (!Number.isInteger(efficiency?.target_output_tokens) || efficiency.target_output_tokens < 1) {
    throw new Error(`Trajectory ${value.id} requires positive target_output_tokens`);
  }
  if (
    !Number.isInteger(efficiency.max_target_output_tokens) ||
    efficiency.max_target_output_tokens < efficiency.target_output_tokens
  ) {
    throw new Error(`Trajectory ${value.id} exceeds its target output budget`);
  }
}

function assertNoSensitiveKeys(value, path, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`Sensitive key is not allowed in training data: ${path}.${key}`);
    }
    assertNoSensitiveKeys(child, `${path}.${key}`, seen);
  }
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortObject(value[key])])
  );
}
