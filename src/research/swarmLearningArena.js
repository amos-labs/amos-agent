import { digestResearchValue } from "./experimentProtocol.js";

export const SWARM_LEARNING_EPISODE_SCHEMA = "amos.swarm-learning-episode";
export const SWARM_REPLAY_BATCH_SCHEMA = "amos.swarm-replay-batch";
export const SWARM_CURRICULUM_SCHEMA = "amos.swarm-curriculum";
export const SWARM_LEARNING_VERSION = 1;

const PARTITIONS = new Set(["development", "validation", "sealed", "canary", "operations"]);
const EXECUTION_STATUSES = new Set(["completed", "errored", "cancelled"]);
const VERIFIER_STATUSES = new Set(["passed", "failed", "not-run"]);
const SOURCE_CLASSES = new Set([
  "public-benchmark",
  "rights-cleared-synthetic",
  "customer-authorized",
  "internal-authorized"
]);
const PERMITTED_USES = new Set(["evaluation", "research", "training", "distillation"]);
const REPLAY_PURPOSES = new Set(["research", "router", "adapter", "distillation"]);

/**
 * Compile one immutable learning episode from a real execution and independent verifier.
 * The eligibility decision is derived here rather than trusted from a model or collector.
 */
export function createSwarmLearningEpisode(input) {
  const source = jsonObject(input, "episode");
  const episode = {
    schema: SWARM_LEARNING_EPISODE_SCHEMA,
    version: SWARM_LEARNING_VERSION,
    id: requiredId(source.id, "episode.id"),
    treatmentId: requiredId(source.treatmentId, "episode.treatmentId"),
    partition: enumValue(source.partition, PARTITIONS, "episode.partition"),
    task: normalizeTask(source.task),
    model: normalizeModel(source.model),
    execution: normalizeExecution(source.execution),
    verifier: normalizeVerifier(source.verifier),
    artifacts: normalizeReferences(source.artifacts || [], "episode.artifacts"),
    traces: normalizeReferences(source.traces || [], "episode.traces"),
    ecology: normalizeEcology(source.ecology),
    curriculumSignals: normalizeSignals(source.curriculumSignals || []),
    dataPolicy: normalizeDataPolicy(source.dataPolicy)
  };
  validateEpisodeDataPolicy(episode);
  episode.outcome = classifyOutcome(episode);
  episode.trainingEligibility = trainingEligibility(episode);
  return { ...episode, digest: digestResearchValue(episode) };
}

export function validateSwarmLearningEpisode(input) {
  const candidate = jsonObject(input, "episode");
  const expected = createSwarmLearningEpisode(candidate);
  if (candidate.schema !== SWARM_LEARNING_EPISODE_SCHEMA) {
    throw new Error(`episode.schema must be ${SWARM_LEARNING_EPISODE_SCHEMA}`);
  }
  if (candidate.version !== SWARM_LEARNING_VERSION) {
    throw new Error(`episode.version must be ${SWARM_LEARNING_VERSION}`);
  }
  if (candidate.digest !== expected.digest) {
    throw new Error("Swarm learning episode digest does not match its contents");
  }
  if (digestResearchValue(candidate.outcome) !== digestResearchValue(expected.outcome)) {
    throw new Error("Swarm learning episode outcome is not derived from its evidence");
  }
  if (
    digestResearchValue(candidate.trainingEligibility) !==
    digestResearchValue(expected.trainingEligibility)
  ) {
    throw new Error("Swarm learning episode eligibility is not derived from its evidence");
  }
  return expected;
}

/** A deterministic in-memory selector; durability is provided by SwarmLearningStore. */
export class SwarmLearningArena {
  constructor({ episodes = [] } = {}) {
    this.episodes = new Map();
    for (const episode of episodes) this.recordEpisode(episode);
  }

  recordEpisode(input) {
    const episode = input?.digest
      ? validateSwarmLearningEpisode(input)
      : createSwarmLearningEpisode(input);
    const previous = this.episodes.get(episode.id);
    if (previous && previous.digest !== episode.digest) {
      throw new Error(`Swarm episode ${episode.id} cannot be mutated`);
    }
    this.episodes.set(episode.id, episode);
    return structuredClone(episode);
  }

  replayBatch({ purpose = "research", limit = 100 } = {}) {
    const normalizedPurpose = enumValue(purpose, REPLAY_PURPOSES, "purpose");
    const maximum = boundedInteger(limit, 1, 100_000, "limit");
    const selected = [...this.episodes.values()]
      .filter((episode) => replayEligible(episode, normalizedPurpose))
      .sort(compareReplayEpisodes)
      .slice(0, maximum);
    const batch = {
      schema: SWARM_REPLAY_BATCH_SCHEMA,
      version: SWARM_LEARNING_VERSION,
      purpose: normalizedPurpose,
      episodeDigests: selected.map((episode) => episode.digest),
      positiveEpisodeDigests: selected
        .filter((episode) => episode.outcome.kind === "verified-pass")
        .map((episode) => episode.digest),
      negativeEpisodeDigests: selected
        .filter((episode) => episode.outcome.kind !== "verified-pass")
        .map((episode) => episode.digest)
    };
    return { ...batch, digest: digestResearchValue(batch) };
  }

  buildCurriculum({ limit = 100 } = {}) {
    const maximum = boundedInteger(limit, 1, 100_000, "limit");
    const challenges = [...this.episodes.values()]
      .filter((episode) => episode.dataPolicy.permittedUses.includes("research"))
      .filter((episode) => episode.partition !== "sealed" && episode.partition !== "canary")
      .sort(compareCurriculumEpisodes)
      .slice(0, maximum)
      .map((episode, index) => curriculumChallenge(episode, index));
    const curriculum = {
      schema: SWARM_CURRICULUM_SCHEMA,
      version: SWARM_LEARNING_VERSION,
      sourceEpisodeDigests: challenges.map(({ sourceEpisodeDigest }) => sourceEpisodeDigest),
      challenges
    };
    return { ...curriculum, digest: digestResearchValue(curriculum) };
  }
}

function normalizeTask(input) {
  const task = jsonObject(input, "episode.task");
  return {
    source: requiredText(task.source, "episode.task.source", 500),
    name: requiredText(task.name, "episode.task.name", 500),
    ref: optionalText(task.ref, "episode.task.ref", 1_000),
    checksum: optionalDigest(task.checksum, "episode.task.checksum")
  };
}

function normalizeModel(input) {
  const model = jsonObject(input, "episode.model");
  return {
    provider: requiredId(model.provider, "episode.model.provider"),
    name: requiredText(model.name, "episode.model.name", 500),
    agent: requiredText(model.agent, "episode.model.agent", 500),
    agentVersion: requiredText(model.agentVersion, "episode.model.agentVersion", 100),
    sharedBackbone: Boolean(model.sharedBackbone)
  };
}

function normalizeExecution(input) {
  const execution = jsonObject(input, "episode.execution");
  const status = enumValue(execution.status, EXECUTION_STATUSES, "episode.execution.status");
  const exception = execution.exception === null || execution.exception === undefined
    ? null
    : {
        type: requiredText(execution.exception.type, "episode.execution.exception.type", 500),
        message: requiredText(
          execution.exception.message,
          "episode.execution.exception.message",
          20_000
        )
      };
  if (status === "errored" && exception === null) {
    throw new Error("An errored swarm execution requires exception evidence");
  }
  if (status !== "errored" && exception !== null) {
    throw new Error("Only an errored swarm execution may include exception evidence");
  }
  const startedAt = validDate(execution.startedAt, "episode.execution.startedAt");
  const finishedAt = validDate(execution.finishedAt, "episode.execution.finishedAt");
  if (new Date(finishedAt).getTime() < new Date(startedAt).getTime()) {
    throw new Error("episode.execution.finishedAt cannot precede startedAt");
  }
  return {
    status,
    startedAt,
    finishedAt,
    exception
  };
}

function normalizeVerifier(input) {
  const verifier = jsonObject(input, "episode.verifier");
  const status = enumValue(verifier.status, VERIFIER_STATUSES, "episode.verifier.status");
  const score = status === "not-run"
    ? null
    : boundedNumber(verifier.score, 0, 1, "episode.verifier.score");
  if (status === "passed" && score <= 0) {
    throw new Error("A passed verifier requires a positive score");
  }
  if (status === "failed" && score > 0) {
    throw new Error("A failed verifier must have a zero score");
  }
  const evidenceRefs = uniqueTexts(
    verifier.evidenceRefs || [],
    "episode.verifier.evidenceRefs",
    1_000
  );
  if (status !== "not-run" && evidenceRefs.length === 0) {
    throw new Error("A conclusive verifier requires evidence references");
  }
  return {
    kind: requiredText(verifier.kind, "episode.verifier.kind", 500),
    status,
    score,
    evidenceRefs
  };
}

function normalizeReferences(values, label) {
  if (!Array.isArray(values) || values.length > 10_000) {
    throw new Error(`${label} must be an array with no more than 10000 entries`);
  }
  const seen = new Set();
  return values.map((value, index) => {
    const reference = jsonObject(value, `${label}[${index}]`);
    const normalized = {
      ref: requiredText(reference.ref, `${label}[${index}].ref`, 4_000),
      kind: requiredId(reference.kind, `${label}[${index}].kind`),
      status: requiredId(reference.status, `${label}[${index}].status`),
      digest: optionalDigest(reference.digest, `${label}[${index}].digest`)
    };
    if (seen.has(normalized.ref)) throw new Error(`${label} contains duplicate ref ${normalized.ref}`);
    seen.add(normalized.ref);
    return normalized;
  });
}

function normalizeEcology(input) {
  if (input === null || input === undefined) return null;
  const ecology = jsonObject(input, "episode.ecology");
  return {
    ref: requiredText(ecology.ref, "episode.ecology.ref", 4_000),
    digest: requiredDigest(ecology.digest, "episode.ecology.digest"),
    status: requiredId(ecology.status, "episode.ecology.status"),
    agentCount: boundedInteger(ecology.agentCount, 0, 10_000, "episode.ecology.agentCount"),
    assignmentCount: boundedInteger(
      ecology.assignmentCount,
      0,
      1_000_000,
      "episode.ecology.assignmentCount"
    )
  };
}

function normalizeSignals(values) {
  if (!Array.isArray(values) || values.length > 1_000) {
    throw new Error("episode.curriculumSignals must contain no more than 1000 entries");
  }
  return [...new Set(values.map((value, index) =>
    requiredId(value, `episode.curriculumSignals[${index}]`)
  ))].sort();
}

function normalizeDataPolicy(input) {
  const policy = jsonObject(input, "episode.dataPolicy");
  const permittedUses = [...new Set((policy.permittedUses || []).map((value) =>
    enumValue(value, PERMITTED_USES, "episode.dataPolicy.permittedUses")
  ))].sort();
  if (permittedUses.length === 0) {
    throw new Error("episode.dataPolicy.permittedUses must not be empty");
  }
  const sourceClass = enumValue(
    policy.sourceClass,
    SOURCE_CLASSES,
    "episode.dataPolicy.sourceClass"
  );
  const trainingApproved = policy.trainingApproved === true;
  return {
    sourceClass,
    permittedUses,
    trainingApproved,
    contaminationTags: uniqueTexts(
      policy.contaminationTags || [],
      "episode.dataPolicy.contaminationTags",
      1_000
    ).sort()
  };
}

function validateEpisodeDataPolicy(episode) {
  if (episode.dataPolicy.sourceClass !== "public-benchmark") return;
  const trainingApproved = episode.dataPolicy.trainingApproved;
  const trainingRequested = episode.dataPolicy.permittedUses.includes("training") ||
    episode.dataPolicy.permittedUses.includes("distillation");
  if (!trainingApproved && !trainingRequested) return;
  if (!trainingApproved || !episode.dataPolicy.permittedUses.includes("training")) {
    throw new Error("Public benchmark training requires explicit training approval");
  }
  if (episode.partition !== "development") {
    throw new Error("Public benchmark training is restricted to the development partition");
  }
  if (episode.dataPolicy.permittedUses.includes("evaluation")) {
    throw new Error("A public benchmark episode cannot be both training and evaluation data");
  }
  if (!episode.dataPolicy.contaminationTags.some((tag) => tag.startsWith("license:"))) {
    throw new Error("Public benchmark training requires task-level license evidence");
  }
  if (!episode.dataPolicy.contaminationTags.some((tag) => tag.startsWith("exclude-eval:"))) {
    throw new Error("Public benchmark training requires an immutable evaluation exclusion");
  }
}

function classifyOutcome(episode) {
  if (episode.execution.status === "errored") {
    return { kind: "execution-error", score: null };
  }
  if (episode.execution.status === "cancelled") {
    return { kind: "cancelled", score: null };
  }
  if (episode.verifier.status === "not-run") {
    return { kind: "unverified", score: null };
  }
  return {
    kind: episode.verifier.status === "passed" ? "verified-pass" : "verified-fail",
    score: episode.verifier.score
  };
}

function trainingEligibility(episode) {
  const reasons = [];
  if (!episode.dataPolicy.permittedUses.includes("training")) reasons.push("training-use-not-permitted");
  if (!episode.dataPolicy.trainingApproved) reasons.push("training-not-approved");
  if (["validation", "sealed", "canary"].includes(episode.partition)) {
    reasons.push("protected-evaluation-partition");
  }
  if (episode.execution.status !== "completed") reasons.push("execution-not-completed");
  if (episode.verifier.status === "not-run") reasons.push("independent-verifier-not-run");
  if (episode.verifier.evidenceRefs.length === 0) reasons.push("verifier-evidence-missing");
  if (!episode.artifacts.some(({ status, digest }) => status === "collected" && digest !== null)) {
    reasons.push("artifact-receipt-missing");
  }
  if (episode.ecology === null) reasons.push("swarm-ecology-missing");
  if (episode.traces.length === 0) reasons.push("trajectory-missing");
  return { eligible: reasons.length === 0, reasons };
}

/**
 * Organism policy learning may use objective failed executions as negative
 * experience. Adapter and distillation replay remain governed by the stricter
 * trainingEligibility stored on the episode.
 */
export function organismPolicyTrainingEligibility(episode) {
  const reasons = [];
  if (episode.dataPolicy?.contaminationTags?.includes("stage0-pipeline-proof")) {
    reasons.push("pipeline-proof-not-organism-experience");
  }
  if (!episode.dataPolicy?.permittedUses?.includes("training")) {
    reasons.push("training-use-not-permitted");
  }
  if (episode.dataPolicy?.trainingApproved !== true) reasons.push("training-not-approved");
  if (["validation", "sealed", "canary"].includes(episode.partition)) {
    reasons.push("protected-evaluation-partition");
  }
  if (episode.ecology === null || episode.ecology === undefined) {
    reasons.push("swarm-ecology-missing");
  } else if (!Number.isInteger(episode.ecology.assignmentCount) || episode.ecology.assignmentCount < 1) {
    reasons.push("swarm-assignments-missing");
  }
  if (!Array.isArray(episode.traces) || episode.traces.length === 0) {
    reasons.push("trajectory-missing");
  }
  if (episode.execution?.status === "completed") {
    if (episode.verifier?.status === "not-run") reasons.push("independent-verifier-not-run");
    if (!Array.isArray(episode.verifier?.evidenceRefs) || episode.verifier.evidenceRefs.length === 0) {
      reasons.push("verifier-evidence-missing");
    }
  } else if (episode.execution?.status === "errored") {
    if (!episode.execution.exception) reasons.push("execution-error-evidence-missing");
  } else {
    reasons.push("execution-not-objective-training-evidence");
  }
  return { eligible: reasons.length === 0, reasons };
}

function replayEligible(episode, purpose) {
  if (purpose === "research") return episode.dataPolicy.permittedUses.includes("research");
  if (purpose === "router") return organismPolicyTrainingEligibility(episode).eligible;
  if (!episode.trainingEligibility.eligible) return false;
  if (purpose === "distillation") {
    return episode.dataPolicy.permittedUses.includes("distillation") &&
      episode.outcome.kind === "verified-pass" && episode.outcome.score >= 0.9;
  }
  return episode.dataPolicy.permittedUses.includes("training");
}

function compareReplayEpisodes(left, right) {
  const score = (episode) => episode.outcome.score ?? -1;
  return score(right) - score(left) || left.id.localeCompare(right.id);
}

function compareCurriculumEpisodes(left, right) {
  const priority = (episode) => ({
    "execution-error": 4,
    "verified-fail": 3,
    unverified: 2,
    cancelled: 1,
    "verified-pass": 0
  })[episode.outcome.kind];
  return priority(right) - priority(left) ||
    (left.outcome.score ?? -1) - (right.outcome.score ?? -1) ||
    left.id.localeCompare(right.id);
}

function curriculumChallenge(episode, index) {
  const mode = episode.outcome.kind === "verified-pass" ? "boundary-extension" : "targeted-repair";
  const signals = episode.curriculumSignals.length > 0
    ? episode.curriculumSignals
    : [episode.outcome.kind];
  return {
    id: `challenge-${String(index + 1).padStart(5, "0")}-${episode.id}`,
    sourceEpisodeDigest: episode.digest,
    mode,
    taskFamily: episode.task.name,
    focus: signals,
    permittedUses: episode.dataPolicy.permittedUses,
    contaminationTags: [...new Set([
      ...episode.dataPolicy.contaminationTags,
      `source:${episode.task.source}/${episode.task.name}`
    ])].sort(),
    requiresIndependentVerifier: true,
    mayUpdateWeights: episode.trainingEligibility.eligible,
    mayUpdateOrganismPolicy: organismPolicyTrainingEligibility(episode).eligible
  };
}

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value);
}

function requiredId(value, label) {
  const id = requiredText(value, label, 500);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
}

function requiredText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function optionalText(value, label, maximum) {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, label, maximum);
}

function uniqueTexts(values, label, maximum) {
  if (!Array.isArray(values) || values.length > maximum) {
    throw new Error(`${label} must be an array with no more than ${maximum} entries`);
  }
  return [...new Set(values.map((value, index) =>
    requiredText(value, `${label}[${index}]`, 4_000)
  ))];
}

function enumValue(value, values, label) {
  if (!values.has(value)) throw new Error(`${label} is unsupported`);
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function boundedNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be a number from ${minimum} to ${maximum}`);
  }
  return number;
}

function validDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return date.toISOString();
}

function optionalDigest(value, label) {
  if (value === null || value === undefined || value === "") return null;
  return requiredDigest(value, label);
}

function requiredDigest(value, label) {
  const digest = String(value ?? "");
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} must be a SHA-256 digest`);
  return digest;
}
