import { digestResearchValue } from "./experimentProtocol.js";
import { normalizeOrganismPolicy } from "./swarmOrganismSimulator.js";

export const ORGANISM_LEARNING_CANDIDATE_SCHEMA = "amos.swarm-organism-learning-candidate";
export const ORGANISM_LEARNING_GATE_SCHEMA = "amos.swarm-organism-learning-gate";
export const ORGANISM_LEARNING_VERSION = 1;

export const ORGANISM_LEARNING_GATES = Object.freeze([
  "simulation",
  "immutable-artifact-replay",
  "real-qwen-phase-probes",
  "full-real-qwen-mission",
  "frozen-holdout",
  "canary"
]);

const GATE_EVALUATORS = Object.freeze({
  simulation: "organism-simulator",
  "immutable-artifact-replay": "artifact-replay-verifier",
  "real-qwen-phase-probes": "qwen-execution-verifier",
  "full-real-qwen-mission": "qwen-mission-verifier",
  "frozen-holdout": "independent-holdout-verifier",
  canary: "canary-telemetry-verifier"
});

export function createOrganismLearningCandidate({
  id,
  policy,
  optimizedParameters,
  policySearchDigest,
  transitionModelDigest,
  rank,
  createdAt = new Date()
}) {
  const candidate = {
    schema: ORGANISM_LEARNING_CANDIDATE_SCHEMA,
    version: ORGANISM_LEARNING_VERSION,
    id: requiredId(id, "candidate.id"),
    createdAt: validDate(createdAt, "candidate.createdAt").toISOString(),
    policy: normalizeOrganismPolicy(policy),
    optimizedParameters: uniqueIds(optimizedParameters, "candidate.optimizedParameters"),
    provenance: {
      policySearchDigest: requiredDigest(policySearchDigest, "candidate.policySearchDigest"),
      transitionModelDigest: requiredDigest(
        transitionModelDigest,
        "candidate.transitionModelDigest"
      ),
      rank: boundedInteger(rank, 1, 1_000_000, "candidate.rank")
    },
    status: "qualifying",
    nextGate: ORGANISM_LEARNING_GATES[0],
    gates: [],
    feedback: [],
    deployment: {
      canaryAllowed: false,
      productionAllowed: false,
      automaticallyDeployed: false
    }
  };
  return withDigest(candidate);
}

export function recordOrganismLearningGate(candidateInput, gateInput) {
  const candidate = validateOrganismLearningCandidate(candidateInput);
  if (candidate.status !== "qualifying") {
    throw new Error(`Candidate ${candidate.id} is already ${candidate.status}`);
  }
  const gate = normalizeGate(gateInput);
  if (gate.id !== candidate.nextGate) {
    throw new Error(`Expected gate ${candidate.nextGate}, received ${gate.id}`);
  }
  const next = withoutDigest(candidate);
  next.gates.push(gate);
  if (gate.status === "failed") {
    next.status = "rejected";
    next.nextGate = null;
    next.feedback.push(...gate.feedbackSignals.map((signal) => ({
      gate: gate.id,
      signal,
      receiptDigest: gate.receiptDigest
    })));
  } else {
    const nextIndex = ORGANISM_LEARNING_GATES.indexOf(gate.id) + 1;
    next.nextGate = ORGANISM_LEARNING_GATES[nextIndex] ?? null;
    if (next.nextGate === null) {
      next.status = "canary-approved";
      next.deployment.canaryAllowed = true;
    }
  }
  return withDigest(next);
}

export function candidatesFromOrganismPolicySearch(searchInput, { prefix = "organism" } = {}) {
  const search = structuredClone(searchInput);
  if (search?.schema !== "amos.swarm-organism-policy-search" || search?.version !== 1) {
    throw new Error("Unsupported organism policy search result");
  }
  if (search.digest !== digestResearchValue(withoutDigest(search))) {
    throw new Error("Organism policy search digest does not match its contents");
  }
  if (!Array.isArray(search.promotionQueue) || search.promotionQueue.length === 0) {
    throw new Error("Organism policy search has no promotion candidates");
  }
  return search.promotionQueue.map((proposal) => {
    if (proposal.automaticallyPromoted !== false) {
      throw new Error("A simulated policy cannot arrive pre-promoted");
    }
    const candidate = createOrganismLearningCandidate({
      id: `${requiredId(prefix, "prefix")}-${String(proposal.rank).padStart(3, "0")}`,
      policy: proposal.policy,
      optimizedParameters: search.optimizedParameters,
      policySearchDigest: search.digest,
      transitionModelDigest: search.transitionModelDigest,
      rank: proposal.rank
    });
    return recordOrganismLearningGate(candidate, {
      id: "simulation",
      status: "passed",
      evaluator: "organism-simulator",
      receiptDigest: digestResearchValue({
        searchDigest: search.digest,
        rank: proposal.rank,
        policy: proposal.policy,
        simulatedMetrics: proposal.simulatedMetrics
      }),
      metrics: proposal.simulatedMetrics,
      feedbackSignals: []
    });
  });
}

export function nextOrganismLearningAction(candidateInput) {
  const candidate = validateOrganismLearningCandidate(candidateInput);
  if (candidate.nextGate === null) return null;
  const jobs = {
    simulation: "organism-simulation",
    "immutable-artifact-replay": "organism-artifact-replay",
    "real-qwen-phase-probes": "organism-qwen-phase-probes",
    "full-real-qwen-mission": "organism-qwen-full-mission",
    "frozen-holdout": "organism-frozen-holdout",
    canary: "organism-canary"
  };
  return {
    kind: jobs[candidate.nextGate],
    candidateId: candidate.id,
    candidateDigest: candidate.digest,
    policyDigest: digestResearchValue(candidate.policy),
    gate: candidate.nextGate
  };
}

export function validateOrganismLearningCandidate(input) {
  const source = structuredClone(input);
  if (
    source?.schema !== ORGANISM_LEARNING_CANDIDATE_SCHEMA ||
    source?.version !== ORGANISM_LEARNING_VERSION
  ) {
    throw new Error("Unsupported organism learning candidate");
  }
  const expectedDigest = digestResearchValue(withoutDigest(source));
  if (source.digest !== expectedDigest) {
    throw new Error("Organism learning candidate digest does not match its contents");
  }
  return source;
}

function normalizeGate(input) {
  const source = structuredClone(input);
  const id = requiredId(source?.id, "gate.id");
  if (!ORGANISM_LEARNING_GATES.includes(id)) throw new Error(`Unsupported learning gate ${id}`);
  if (!["passed", "failed"].includes(source.status)) {
    throw new Error("gate.status must be passed or failed");
  }
  const evaluator = requiredId(source.evaluator, "gate.evaluator");
  if (evaluator !== GATE_EVALUATORS[id]) {
    throw new Error(`Gate ${id} requires evaluator ${GATE_EVALUATORS[id]}`);
  }
  const feedbackSignals = uniqueTexts(source.feedbackSignals || [], "gate.feedbackSignals");
  if (source.status === "failed" && feedbackSignals.length === 0) {
    throw new Error("A failed learning gate requires feedback signals");
  }
  return {
    schema: ORGANISM_LEARNING_GATE_SCHEMA,
    version: ORGANISM_LEARNING_VERSION,
    id,
    status: source.status,
    evaluator,
    receiptDigest: requiredDigest(source.receiptDigest, "gate.receiptDigest"),
    metrics: jsonObject(source.metrics || {}, "gate.metrics"),
    feedbackSignals,
    evaluatedAt: validDate(source.evaluatedAt || new Date(), "gate.evaluatedAt").toISOString()
  };
}

function withDigest(value) {
  return { ...value, digest: digestResearchValue(value) };
}

function withoutDigest(value) {
  const clone = structuredClone(value);
  delete clone.digest;
  return clone;
}

function requiredId(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function requiredDigest(value, label) {
  const digest = String(value ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} must be a SHA-256 digest`);
  return digest;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function validDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`);
  return date;
}

function uniqueIds(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must not be empty`);
  return [...new Set(values.map((value) => requiredId(value, label)))];
}

function uniqueTexts(values, label) {
  if (!Array.isArray(values) || values.length > 100) throw new Error(`${label} is invalid`);
  return [...new Set(values.map((value) => {
    const text = String(value ?? "").trim();
    if (!text || text.length > 1_000) throw new Error(`${label} contains invalid text`);
    return text;
  }))];
}

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value);
}
