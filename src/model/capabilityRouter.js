import {
  AUTONOMY_LEVELS,
  validateCapabilityContract
} from "./capabilityContract.js";

const DEFAULT_POLICY = Object.freeze({
  allowedStatuses: Object.freeze(["qualified", "conditional"]),
  allowedEvidenceTrust: Object.freeze(["release-signed", "measured-local", "measured-managed"]),
  allowedDeployments: Object.freeze(["local", "private", "managed"]),
  costOrder: Object.freeze(["local", "efficient", "balanced", "frontier"]),
  latencyOrder: Object.freeze(["interactive", "standard", "background"])
});

export function routeModelStep({ requirements = {}, candidates = [], policy = {}, now = new Date() } = {}) {
  const effectivePolicy = normalizePolicy(policy);
  const required = normalizeRequirements(requirements);
  validateRequiredClass(required.maximumLatencyClass, effectivePolicy.latencyOrder, "maximumLatencyClass");
  validateRequiredClass(required.maximumCostClass, effectivePolicy.costOrder, "maximumCostClass");
  const evaluated = candidates.map((candidate, index) =>
    evaluateCandidate(candidate, index, required, effectivePolicy, now)
  );
  const eligible = evaluated.filter((item) => item.reasons.length === 0).sort((left, right) =>
    compareEligible(left, right, effectivePolicy)
  );
  const rejected = evaluated.filter((item) => item.reasons.length > 0);
  const selected = eligible[0] || null;

  return {
    selected: selected ? selected.candidate : null,
    eligible: eligible.map(publicEvaluation),
    rejected: rejected.map(publicEvaluation),
    escalation: selected ? null : {
      required: true,
      code: "no-qualified-model",
      message: "No candidate has evidence for every required capability and policy floor."
    }
  };
}

function evaluateCandidate(input, index, requirements, policy, now) {
  const candidate = input?.contract ? input : { contract: input };
  let contract;
  try {
    contract = validateCapabilityContract(candidate.contract);
  } catch (error) {
    return {
      candidate,
      contract: null,
      index,
      reasons: [reason("invalid-contract", "contract", "valid capability contract", error.message)]
    };
  }

  const reasons = [];
  if (candidate.enabled === false) reasons.push(reason("candidate-disabled", "enabled", true, false));
  if (candidate.healthy === false) reasons.push(reason("candidate-unhealthy", "healthy", true, false));
  requireIncluded(reasons, "status-not-allowed", "status", policy.allowedStatuses, contract.status);
  requireIncluded(reasons, "evidence-not-trusted", "evidence.trust", policy.allowedEvidenceTrust, contract.evidence.trust);
  requireIncluded(reasons, "deployment-not-allowed", "identity.deployment", policy.allowedDeployments, contract.identity.deployment);
  if (policy.allowedProviders.length > 0) {
    requireIncluded(reasons, "provider-not-allowed", "identity.provider", policy.allowedProviders, contract.identity.provider);
  }
  requireAll(reasons, "missing-modality", "grants.modalities", requirements.modalities, contract.grants.modalities);
  requireAll(reasons, "missing-capability", "grants.capabilities", requirements.capabilities, contract.grants.capabilities);
  requireAll(reasons, "workflow-not-qualified", "grants.workflows", requirements.workflows, contract.grants.workflows);

  if (!contract.grants.autonomy.includes(requirements.autonomy)) {
    reasons.push(reason("autonomy-not-qualified", "grants.autonomy", requirements.autonomy, contract.grants.autonomy));
  }
  if (requirements.autonomy === "execute" &&
      !contract.grants.capabilities.includes("approval-state-integrity")) {
    reasons.push(reason(
      "execution-floor-not-qualified",
      "grants.capabilities",
      "approval-state-integrity",
      contract.grants.capabilities
    ));
  }
  if (contract.limits.contextTokens < requirements.minimumContextTokens) {
    reasons.push(reason(
      "context-limit-too-small",
      "limits.contextTokens",
      requirements.minimumContextTokens,
      contract.limits.contextTokens
    ));
  }
  enforceClassCeiling(
    reasons,
    "latency-class-too-slow",
    "performance.latencyClass",
    requirements.maximumLatencyClass,
    contract.performance.latencyClass,
    policy.latencyOrder
  );
  enforceClassCeiling(
    reasons,
    "cost-class-too-high",
    "performance.costClass",
    requirements.maximumCostClass,
    contract.performance.costClass,
    policy.costOrder
  );
  if (requirements.maximumEvidenceAgeDays !== null) {
    const ageMs = new Date(now).getTime() - new Date(contract.evidence.evaluatedAt).getTime();
    const maximumMs = requirements.maximumEvidenceAgeDays * 86_400_000;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maximumMs) {
      reasons.push(reason(
        "evidence-too-old",
        "evidence.evaluatedAt",
        `${requirements.maximumEvidenceAgeDays} days or newer`,
        contract.evidence.evaluatedAt
      ));
    }
  }

  return { candidate: { ...candidate, contract }, contract, index, reasons };
}

function compareEligible(left, right, policy) {
  const preferred = comparePreference(left.contract.id, right.contract.id, policy.preferenceOrder);
  if (preferred !== 0) return preferred;
  const cost = compareClass(
    left.contract.performance.costClass,
    right.contract.performance.costClass,
    policy.costOrder
  );
  if (cost !== 0) return cost;
  const latency = compareClass(
    left.contract.performance.latencyClass,
    right.contract.performance.latencyClass,
    policy.latencyOrder
  );
  if (latency !== 0) return latency;
  const id = left.contract.id.localeCompare(right.contract.id);
  return id !== 0 ? id : left.index - right.index;
}

function normalizeRequirements(requirements) {
  const autonomy = String(requirements.autonomy || "observe");
  if (!AUTONOMY_LEVELS.includes(autonomy)) throw new Error(`Unsupported autonomy requirement: ${autonomy}`);
  return {
    modalities: textArray(requirements.modalities, ["text"]),
    capabilities: textArray(requirements.capabilities),
    workflows: textArray(requirements.workflows),
    autonomy,
    minimumContextTokens: nonNegativeInteger(requirements.minimumContextTokens, 0),
    maximumLatencyClass: nullableText(requirements.maximumLatencyClass),
    maximumCostClass: nullableText(requirements.maximumCostClass),
    maximumEvidenceAgeDays: requirements.maximumEvidenceAgeDays === undefined
      ? null
      : nonNegativeInteger(requirements.maximumEvidenceAgeDays, 0)
  };
}

function normalizePolicy(policy) {
  return {
    allowedStatuses: textArray(policy.allowedStatuses, DEFAULT_POLICY.allowedStatuses),
    allowedEvidenceTrust: textArray(policy.allowedEvidenceTrust, DEFAULT_POLICY.allowedEvidenceTrust),
    allowedDeployments: textArray(policy.allowedDeployments, DEFAULT_POLICY.allowedDeployments),
    allowedProviders: textArray(policy.allowedProviders),
    preferenceOrder: textArray(policy.preferenceOrder),
    costOrder: textArray(policy.costOrder, DEFAULT_POLICY.costOrder),
    latencyOrder: textArray(policy.latencyOrder, DEFAULT_POLICY.latencyOrder)
  };
}

function publicEvaluation(item) {
  return {
    candidate: item.candidate,
    reasons: item.reasons
  };
}

function requireIncluded(reasons, code, field, allowed, actual) {
  if (!allowed.includes(actual)) reasons.push(reason(code, field, allowed, actual));
}

function requireAll(reasons, code, field, required, actual) {
  const missing = required.filter((value) => !actual.includes(value));
  if (missing.length > 0) reasons.push(reason(code, field, missing, actual));
}

function enforceClassCeiling(reasons, code, field, maximum, actual, order) {
  if (!maximum) return;
  const maximumIndex = order.indexOf(maximum);
  const actualIndex = order.indexOf(actual);
  if (maximumIndex < 0) throw new Error(`Unknown required class ${maximum} for ${field}`);
  if (actualIndex < 0 || actualIndex > maximumIndex) reasons.push(reason(code, field, maximum, actual));
}

function comparePreference(left, right, order) {
  if (order.length === 0) return 0;
  const fallback = order.length;
  return (order.indexOf(left) < 0 ? fallback : order.indexOf(left)) -
    (order.indexOf(right) < 0 ? fallback : order.indexOf(right));
}

function compareClass(left, right, order) {
  const fallback = order.length;
  return (order.indexOf(left) < 0 ? fallback : order.indexOf(left)) -
    (order.indexOf(right) < 0 ? fallback : order.indexOf(right));
}

function reason(code, field, required, actual) {
  return { code, field, required, actual };
}

function textArray(value, fallback = []) {
  const source = value === undefined ? fallback : value;
  if (!Array.isArray(source)) throw new Error("Routing lists must be arrays");
  const normalized = source.map((item) => String(item || "").trim());
  if (normalized.some((item) => !item)) throw new Error("Routing lists cannot contain empty values");
  return [...new Set(normalized)];
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error("Routing numeric requirements must be non-negative integers");
  }
  return number;
}

function validateRequiredClass(value, order, label) {
  if (value && !order.includes(value)) throw new Error(`Unknown ${label}: ${value}`);
}

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}
