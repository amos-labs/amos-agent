import { createHash } from "node:crypto";

export const RESEARCH_EVALUATION_SCHEMA = "amos.research-evaluation-manifest";
export const RESEARCH_EXPERIMENT_SCHEMA = "amos.research-experiment-proposal";
export const RESEARCH_OUTCOME_SCHEMA = "amos.research-experiment-outcome";
export const RESEARCH_LEDGER_SCHEMA = "amos.research-experiment-ledger";
export const RESEARCH_PROTOCOL_VERSION = 1;

export const RESEARCH_LEVELS = Object.freeze([
  "L1_RUNTIME",
  "L2_CURRICULUM",
  "L3_ADAPTATION",
  "L4_TRAINING",
  "L5_BASE_MODEL",
  "L6_RESEARCH_SYSTEM"
]);

export const EVALUATION_PARTITIONS = Object.freeze([
  "development",
  "validation",
  "sealed",
  "canary"
]);

const PARTITION_VISIBILITY = Object.freeze({
  development: "research-visible",
  validation: "aggregate-only",
  sealed: "custodian-only",
  canary: "custodian-only"
});

const EDITABLE_SURFACE_LEVEL = Object.freeze({
  prompt: 1,
  context_compiler: 1,
  router: 1,
  tool_presentation: 1,
  planning_policy: 1,
  branching_policy: 1,
  verification_policy: 1,
  stopping_policy: 1,
  recovery_policy: 1,
  agent_coordination: 1,
  synthetic_data: 2,
  hard_negative_generation: 2,
  sampling_policy: 2,
  data_mixture: 2,
  adapter_weights: 3,
  specialist_head: 3,
  preference_objective: 3,
  outcome_objective: 3,
  optimizer: 4,
  training_schedule: 4,
  reward_model: 4,
  architecture_component: 4,
  tokenizer: 5,
  base_architecture: 5,
  pretraining_mixture: 5,
  full_weights: 5,
  experiment_policy: 6,
  research_roles: 6,
  resource_allocation_proposal: 6
});

const OBSERVATION_KINDS = new Set([
  "failure",
  "evaluation",
  "trace",
  "literature",
  "prior_experiment",
  "external_signal"
]);
const PROPOSER_KINDS = new Set(["human", "model", "hybrid", "service"]);
const REVIEW_PATHS = new Set(["owner", "owner-plus-independent", "council"]);
const METRIC_DIRECTIONS = new Set(["increase", "decrease", "floor"]);
const PREDICTION_DIRECTIONS = new Set(["increase", "decrease", "no_regression"]);
const PERMITTED_USES = new Set([
  "evaluation",
  "research",
  "training",
  "distillation",
  "redistribution"
]);
const OUTCOME_STATUSES = new Set(["completed", "failed", "aborted"]);
const LEDGER_ACTOR_KINDS = new Set(["human", "model", "hybrid", "service"]);
const LEDGER_TRANSITIONS = Object.freeze({
  proposed: Object.freeze({ approved: "approved", rejected: "rejected", quarantined: "quarantined" }),
  approved: Object.freeze({ started: "running", aborted: "aborted", quarantined: "quarantined" }),
  running: Object.freeze({ outcome_recorded: "evaluating", aborted: "aborted", quarantined: "quarantined" }),
  evaluating: Object.freeze({ promoted: "promoted", rejected: "rejected", quarantined: "quarantined" }),
  promoted: Object.freeze({ reverted: "reverted" })
});
const GOVERNED_LEDGER_EVENTS = new Set([
  "approved",
  "promoted",
  "rejected",
  "quarantined",
  "reverted"
]);

export function validateResearchEvaluationManifest(input) {
  const manifest = cloneJson(input, "Evaluation manifest");
  assertExactFields(manifest, "manifest", [
    "schema",
    "version",
    "id",
    "revision",
    "status",
    "createdAt",
    "frozenAt",
    "domains",
    "partitions",
    "metrics",
    "promotion",
    "holdoutDimensions"
  ]);
  assertSchema(manifest, RESEARCH_EVALUATION_SCHEMA, "evaluation manifest");
  requiredId(manifest.id, "manifest.id");
  positiveInteger(manifest.revision, "manifest.revision");
  if (!["development", "frozen", "retired"].includes(manifest.status)) {
    throw new Error("manifest.status must be development, frozen, or retired");
  }
  validDate(manifest.createdAt, "manifest.createdAt");
  if (["frozen", "retired"].includes(manifest.status)) {
    validDate(manifest.frozenAt, "manifest.frozenAt");
  } else if (manifest.frozenAt !== null) {
    throw new Error("manifest.frozenAt must be null while the manifest is in development");
  }
  uniqueTextArray(manifest.domains, "manifest.domains", { nonEmpty: true });
  uniqueTextArray(manifest.holdoutDimensions, "manifest.holdoutDimensions", { nonEmpty: true });

  assertExactFields(manifest.partitions, "manifest.partitions", EVALUATION_PARTITIONS);
  for (const partition of EVALUATION_PARTITIONS) {
    const value = manifest.partitions[partition];
    assertExactFields(value, `manifest.partitions.${partition}`, [
      "id",
      "digest",
      "caseCount",
      "visibility"
    ]);
    requiredId(value.id, `manifest.partitions.${partition}.id`);
    sha256(value.digest, `manifest.partitions.${partition}.digest`);
    positiveInteger(value.caseCount, `manifest.partitions.${partition}.caseCount`);
    if (value.visibility !== PARTITION_VISIBILITY[partition]) {
      throw new Error(
        `manifest.partitions.${partition}.visibility must be ${PARTITION_VISIBILITY[partition]}`
      );
    }
  }

  if (!Array.isArray(manifest.metrics) || manifest.metrics.length === 0) {
    throw new Error("manifest.metrics must be a non-empty array");
  }
  const metricIds = new Set();
  for (const [index, metric] of manifest.metrics.entries()) {
    assertKnownFields(metric, `manifest.metrics[${index}]`, [
      "id",
      "direction",
      "unit",
      "primary",
      "hardFloor"
    ]);
    requiredId(metric.id, `manifest.metrics[${index}].id`);
    if (metricIds.has(metric.id)) throw new Error(`Duplicate metric id: ${metric.id}`);
    metricIds.add(metric.id);
    if (!METRIC_DIRECTIONS.has(metric.direction)) {
      throw new Error(`Unsupported metric direction: ${metric.direction}`);
    }
    requiredText(metric.unit, `manifest.metrics[${index}].unit`);
    if (typeof metric.primary !== "boolean") {
      throw new Error(`manifest.metrics[${index}].primary must be boolean`);
    }
    if (metric.direction === "floor") finiteNumber(metric.hardFloor, `manifest.metrics[${index}].hardFloor`);
    if (metric.direction !== "floor" && metric.hardFloor !== undefined) {
      throw new Error(`manifest.metrics[${index}].hardFloor is only valid for floor metrics`);
    }
  }

  assertExactFields(manifest.promotion, "manifest.promotion", [
    "primaryMetricId",
    "minimumPrimaryDelta",
    "safetyFloorMetricIds",
    "minimumRepetitions",
    "independentReproductionRequired",
    "maximumSecondaryRegression"
  ]);
  requiredId(manifest.promotion.primaryMetricId, "manifest.promotion.primaryMetricId");
  if (!metricIds.has(manifest.promotion.primaryMetricId)) {
    throw new Error("manifest.promotion.primaryMetricId must reference a declared metric");
  }
  const primaryMetrics = manifest.metrics.filter((metric) => metric.primary);
  if (primaryMetrics.length !== 1 || primaryMetrics[0].id !== manifest.promotion.primaryMetricId) {
    throw new Error("Exactly one metric must be primary and match promotion.primaryMetricId");
  }
  nonNegativeNumber(manifest.promotion.minimumPrimaryDelta, "manifest.promotion.minimumPrimaryDelta");
  uniqueTextArray(
    manifest.promotion.safetyFloorMetricIds,
    "manifest.promotion.safetyFloorMetricIds",
    { nonEmpty: true }
  );
  for (const metricId of manifest.promotion.safetyFloorMetricIds) {
    const metric = manifest.metrics.find((candidate) => candidate.id === metricId);
    if (!metric || metric.direction !== "floor") {
      throw new Error(`Safety floor metric ${metricId} must reference a declared floor metric`);
    }
  }
  positiveInteger(manifest.promotion.minimumRepetitions, "manifest.promotion.minimumRepetitions");
  if (manifest.status === "frozen" && manifest.promotion.minimumRepetitions < 3) {
    throw new Error("Frozen manifests require at least three promotion repetitions");
  }
  if (typeof manifest.promotion.independentReproductionRequired !== "boolean") {
    throw new Error("manifest.promotion.independentReproductionRequired must be boolean");
  }
  if (manifest.status === "frozen" && !manifest.promotion.independentReproductionRequired) {
    throw new Error("Frozen manifests require independent reproduction");
  }
  ratio(
    manifest.promotion.maximumSecondaryRegression,
    "manifest.promotion.maximumSecondaryRegression"
  );
  return manifest;
}

export function validateResearchExperimentProposal(input, options = {}) {
  const proposal = cloneJson(input, "Research experiment proposal");
  assertExactFields(proposal, "proposal", [
    "schema",
    "version",
    "id",
    "status",
    "createdAt",
    "proposer",
    "hypothesis",
    "parentCandidate",
    "observations",
    "treatment",
    "budget",
    "predictions",
    "evaluation",
    "dataManifests",
    "review",
    "rollback"
  ]);
  assertSchema(proposal, RESEARCH_EXPERIMENT_SCHEMA, "research experiment proposal");
  requiredId(proposal.id, "proposal.id");
  if (proposal.status !== "proposed") throw new Error("proposal.status must be proposed");
  validDate(proposal.createdAt, "proposal.createdAt");

  assertKnownFields(proposal.proposer, "proposal.proposer", [
    "kind",
    "id",
    "modelCapabilityContractId"
  ]);
  if (!PROPOSER_KINDS.has(proposal.proposer.kind)) {
    throw new Error(`Unsupported proposer kind: ${proposal.proposer.kind}`);
  }
  requiredId(proposal.proposer.id, "proposal.proposer.id");
  if (proposal.proposer.kind === "model") {
    requiredId(
      proposal.proposer.modelCapabilityContractId,
      "proposal.proposer.modelCapabilityContractId"
    );
  }
  requiredText(proposal.hypothesis, "proposal.hypothesis", { maxLength: 4000 });
  candidateRef(proposal.parentCandidate, "proposal.parentCandidate");

  if (!Array.isArray(proposal.observations) || proposal.observations.length === 0) {
    throw new Error("proposal.observations must be a non-empty array");
  }
  const observationIds = new Set();
  for (const [index, observation] of proposal.observations.entries()) {
    assertExactFields(observation, `proposal.observations[${index}]`, ["id", "kind", "digest"]);
    requiredId(observation.id, `proposal.observations[${index}].id`);
    if (observationIds.has(observation.id)) throw new Error(`Duplicate observation id: ${observation.id}`);
    observationIds.add(observation.id);
    if (!OBSERVATION_KINDS.has(observation.kind)) {
      throw new Error(`Unsupported observation kind: ${observation.kind}`);
    }
    sha256(observation.digest, `proposal.observations[${index}].digest`);
  }

  assertExactFields(proposal.treatment, "proposal.treatment", [
    "level",
    "summary",
    "editableSurfaces",
    "sourceRevision"
  ]);
  const levelIndex = RESEARCH_LEVELS.indexOf(proposal.treatment.level);
  if (levelIndex < 0) throw new Error(`Unsupported research level: ${proposal.treatment.level}`);
  requiredText(proposal.treatment.summary, "proposal.treatment.summary", { maxLength: 4000 });
  requiredId(proposal.treatment.sourceRevision, "proposal.treatment.sourceRevision");
  uniqueTextArray(proposal.treatment.editableSurfaces, "proposal.treatment.editableSurfaces", {
    nonEmpty: true
  });
  for (const surface of proposal.treatment.editableSurfaces) {
    const requiredLevel = EDITABLE_SURFACE_LEVEL[surface];
    if (!requiredLevel) throw new Error(`Unknown editable surface: ${surface}`);
    if (requiredLevel > levelIndex + 1) {
      throw new Error(`${surface} requires a higher research level than ${proposal.treatment.level}`);
    }
  }

  validateBudget(proposal.budget, "proposal.budget");
  if (!Array.isArray(proposal.predictions) || proposal.predictions.length === 0) {
    throw new Error("proposal.predictions must be a non-empty array");
  }
  const predictionKeys = new Set();
  for (const [index, prediction] of proposal.predictions.entries()) {
    assertExactFields(prediction, `proposal.predictions[${index}]`, [
      "metricId",
      "partition",
      "direction",
      "minimumDelta",
      "required"
    ]);
    requiredId(prediction.metricId, `proposal.predictions[${index}].metricId`);
    if (!["development", "validation"].includes(prediction.partition)) {
      throw new Error("Research proposals cannot name sealed or canary predictions");
    }
    if (!PREDICTION_DIRECTIONS.has(prediction.direction)) {
      throw new Error(`Unsupported prediction direction: ${prediction.direction}`);
    }
    nonNegativeNumber(prediction.minimumDelta, `proposal.predictions[${index}].minimumDelta`);
    if (typeof prediction.required !== "boolean") {
      throw new Error(`proposal.predictions[${index}].required must be boolean`);
    }
    const key = `${prediction.metricId}:${prediction.partition}`;
    if (predictionKeys.has(key)) throw new Error(`Duplicate prediction: ${key}`);
    predictionKeys.add(key);
  }
  if (!proposal.predictions.some((prediction) => prediction.required)) {
    throw new Error("At least one proposal prediction must be required");
  }

  assertExactFields(proposal.evaluation, "proposal.evaluation", [
    "manifestId",
    "revision",
    "manifestDigest"
  ]);
  requiredId(proposal.evaluation.manifestId, "proposal.evaluation.manifestId");
  positiveInteger(proposal.evaluation.revision, "proposal.evaluation.revision");
  sha256(proposal.evaluation.manifestDigest, "proposal.evaluation.manifestDigest");

  if (!Array.isArray(proposal.dataManifests)) {
    throw new Error("proposal.dataManifests must be an array");
  }
  const dataManifestIds = new Set();
  for (const [index, dataManifest] of proposal.dataManifests.entries()) {
    assertExactFields(dataManifest, `proposal.dataManifests[${index}]`, [
      "id",
      "digest",
      "permittedUses"
    ]);
    requiredId(dataManifest.id, `proposal.dataManifests[${index}].id`);
    if (dataManifestIds.has(dataManifest.id)) {
      throw new Error(`Duplicate data manifest id: ${dataManifest.id}`);
    }
    dataManifestIds.add(dataManifest.id);
    sha256(dataManifest.digest, `proposal.dataManifests[${index}].digest`);
    uniqueTextArray(dataManifest.permittedUses, `proposal.dataManifests[${index}].permittedUses`, {
      nonEmpty: true
    });
    for (const permittedUse of dataManifest.permittedUses) {
      if (!PERMITTED_USES.has(permittedUse)) {
        throw new Error(`Unsupported permitted use: ${permittedUse}`);
      }
    }
  }
  if (levelIndex >= 1 && proposal.dataManifests.length === 0) {
    throw new Error(`${proposal.treatment.level} requires at least one data manifest`);
  }
  if (levelIndex >= 2 && !proposal.dataManifests.some((item) => item.permittedUses.includes("training"))) {
    throw new Error(`${proposal.treatment.level} requires training permission in a data manifest`);
  }

  validateReview(proposal.review, proposal.treatment.level);
  assertExactFields(proposal.rollback, "proposal.rollback", [
    "candidateId",
    "artifactDigest",
    "steps"
  ]);
  requiredId(proposal.rollback.candidateId, "proposal.rollback.candidateId");
  sha256(proposal.rollback.artifactDigest, "proposal.rollback.artifactDigest");
  uniqueTextArray(proposal.rollback.steps, "proposal.rollback.steps", { nonEmpty: true });
  if (proposal.rollback.candidateId !== proposal.parentCandidate.id ||
      proposal.rollback.artifactDigest !== proposal.parentCandidate.artifactDigest) {
    throw new Error("proposal.rollback must restore the exact parent candidate");
  }

  if (options.evaluationManifest) {
    const manifest = validateResearchEvaluationManifest(options.evaluationManifest);
    assertManifestReference(proposal, manifest);
    const metricIds = new Set(manifest.metrics.map((metric) => metric.id));
    for (const prediction of proposal.predictions) {
      if (!metricIds.has(prediction.metricId)) {
        throw new Error(`Prediction references unknown metric: ${prediction.metricId}`);
      }
    }
  }
  return proposal;
}

export function validateResearchExperimentOutcome(input, options = {}) {
  const outcome = cloneJson(input, "Research experiment outcome");
  assertExactFields(outcome, "outcome", [
    "schema",
    "version",
    "experimentId",
    "proposalDigest",
    "evaluationManifestDigest",
    "status",
    "candidate",
    "startedAt",
    "concludedAt",
    "environmentDigest",
    "sourceRevision",
    "usage",
    "measurements",
    "safety",
    "reproductions",
    "receiptDigests",
    "failure"
  ]);
  assertSchema(outcome, RESEARCH_OUTCOME_SCHEMA, "research experiment outcome");
  requiredId(outcome.experimentId, "outcome.experimentId");
  sha256(outcome.proposalDigest, "outcome.proposalDigest");
  sha256(outcome.evaluationManifestDigest, "outcome.evaluationManifestDigest");
  if (!OUTCOME_STATUSES.has(outcome.status)) throw new Error(`Unsupported outcome status: ${outcome.status}`);
  candidateRef(outcome.candidate, "outcome.candidate");
  const startedAt = validDate(outcome.startedAt, "outcome.startedAt");
  const concludedAt = validDate(outcome.concludedAt, "outcome.concludedAt");
  if (concludedAt < startedAt) throw new Error("outcome.concludedAt cannot precede outcome.startedAt");
  sha256(outcome.environmentDigest, "outcome.environmentDigest");
  requiredId(outcome.sourceRevision, "outcome.sourceRevision");
  validateUsage(outcome.usage, "outcome.usage");

  if (!Array.isArray(outcome.measurements)) throw new Error("outcome.measurements must be an array");
  const measurementKeys = new Set();
  for (const [index, measurement] of outcome.measurements.entries()) {
    assertExactFields(measurement, `outcome.measurements[${index}]`, [
      "metricId",
      "partition",
      "value",
      "baselineValue",
      "delta",
      "repetitions",
      "evaluatorDigest"
    ]);
    requiredId(measurement.metricId, `outcome.measurements[${index}].metricId`);
    if (!EVALUATION_PARTITIONS.includes(measurement.partition)) {
      throw new Error(`Unsupported evaluation partition: ${measurement.partition}`);
    }
    const value = finiteNumber(measurement.value, `outcome.measurements[${index}].value`);
    const baseline = finiteNumber(
      measurement.baselineValue,
      `outcome.measurements[${index}].baselineValue`
    );
    const delta = finiteNumber(measurement.delta, `outcome.measurements[${index}].delta`);
    if (Math.abs((value - baseline) - delta) > 1e-9) {
      throw new Error(`outcome.measurements[${index}].delta does not match value - baselineValue`);
    }
    positiveInteger(measurement.repetitions, `outcome.measurements[${index}].repetitions`);
    sha256(measurement.evaluatorDigest, `outcome.measurements[${index}].evaluatorDigest`);
    const key = `${measurement.metricId}:${measurement.partition}`;
    if (measurementKeys.has(key)) throw new Error(`Duplicate measurement: ${key}`);
    measurementKeys.add(key);
  }
  if (outcome.status === "completed" && outcome.measurements.length === 0) {
    throw new Error("Completed outcomes require measurements");
  }

  assertExactFields(outcome.safety, "outcome.safety", ["passed", "failedMetricIds"]);
  if (typeof outcome.safety.passed !== "boolean") throw new Error("outcome.safety.passed must be boolean");
  uniqueTextArray(outcome.safety.failedMetricIds, "outcome.safety.failedMetricIds");
  if (outcome.safety.passed !== (outcome.safety.failedMetricIds.length === 0)) {
    throw new Error("outcome.safety.passed must agree with failedMetricIds");
  }

  if (!Array.isArray(outcome.reproductions)) throw new Error("outcome.reproductions must be an array");
  const reproductionIds = new Set();
  for (const [index, reproduction] of outcome.reproductions.entries()) {
    assertExactFields(reproduction, `outcome.reproductions[${index}]`, [
      "id",
      "independent",
      "matched",
      "resultDigest"
    ]);
    requiredId(reproduction.id, `outcome.reproductions[${index}].id`);
    if (reproductionIds.has(reproduction.id)) throw new Error(`Duplicate reproduction id: ${reproduction.id}`);
    reproductionIds.add(reproduction.id);
    if (typeof reproduction.independent !== "boolean" || typeof reproduction.matched !== "boolean") {
      throw new Error(`outcome.reproductions[${index}] flags must be boolean`);
    }
    sha256(reproduction.resultDigest, `outcome.reproductions[${index}].resultDigest`);
  }
  uniqueDigestArray(outcome.receiptDigests, "outcome.receiptDigests");

  if (outcome.status === "completed" && outcome.failure !== null) {
    throw new Error("Completed outcomes cannot contain failure details");
  }
  if (outcome.status !== "completed") {
    assertExactFields(outcome.failure, "outcome.failure", ["code", "summary"]);
    requiredId(outcome.failure.code, "outcome.failure.code");
    requiredText(outcome.failure.summary, "outcome.failure.summary", { maxLength: 2000 });
  }

  if (options.proposal) {
    const proposal = validateResearchExperimentProposal(options.proposal, {
      evaluationManifest: options.evaluationManifest
    });
    if (outcome.experimentId !== proposal.id) throw new Error("Outcome experiment id does not match proposal");
    if (outcome.proposalDigest !== digestResearchValue(proposal)) {
      throw new Error("Outcome proposal digest does not match proposal");
    }
    if (outcome.sourceRevision !== proposal.treatment.sourceRevision) {
      throw new Error("Outcome source revision does not match proposal treatment");
    }
  }
  if (options.evaluationManifest) {
    const manifest = validateResearchEvaluationManifest(options.evaluationManifest);
    if (outcome.evaluationManifestDigest !== digestResearchValue(manifest)) {
      throw new Error("Outcome evaluation manifest digest does not match manifest");
    }
    const metricIds = new Set(manifest.metrics.map((metric) => metric.id));
    for (const measurement of outcome.measurements) {
      if (!metricIds.has(measurement.metricId)) {
        throw new Error(`Measurement references unknown metric: ${measurement.metricId}`);
      }
    }
    for (const failedMetricId of outcome.safety.failedMetricIds) {
      if (!manifest.promotion.safetyFloorMetricIds.includes(failedMetricId)) {
        throw new Error(`Unknown safety floor failure: ${failedMetricId}`);
      }
    }
  }
  return outcome;
}

export function evaluateResearchPromotion({ proposal, evaluationManifest, outcome }) {
  const manifest = validateResearchEvaluationManifest(evaluationManifest);
  const validatedProposal = validateResearchExperimentProposal(proposal, { evaluationManifest: manifest });
  const validatedOutcome = validateResearchExperimentOutcome(outcome, {
    proposal: validatedProposal,
    evaluationManifest: manifest
  });
  const reasons = [];

  if (manifest.status !== "frozen") reasons.push("evaluation-manifest-not-frozen");
  if (validatedOutcome.status !== "completed") reasons.push("experiment-not-completed");
  if (validatedOutcome.candidate.artifactDigest === validatedProposal.parentCandidate.artifactDigest) {
    reasons.push("candidate-artifact-unchanged");
  }
  for (const [usageField, budgetField] of [
    ["wallSeconds", "wallSeconds"],
    ["acceleratorSeconds", "acceleratorSeconds"],
    ["costUsd", "maxCostUsd"],
    ["tokens", "maxTokens"],
    ["storageBytes", "maxStorageBytes"]
  ]) {
    if (validatedOutcome.usage[usageField] > validatedProposal.budget[budgetField]) {
      reasons.push(`budget-exceeded:${usageField}`);
    }
  }
  if (!validatedOutcome.safety.passed) reasons.push("safety-floor-failed");

  const metricById = new Map(manifest.metrics.map((metric) => [metric.id, metric]));
  const measurements = new Map(
    validatedOutcome.measurements.map((measurement) => [
      `${measurement.metricId}:${measurement.partition}`,
      measurement
    ])
  );
  for (const prediction of validatedProposal.predictions.filter((item) => item.required)) {
    const measurement = measurements.get(`${prediction.metricId}:${prediction.partition}`);
    if (!measurement) {
      reasons.push(`required-prediction-missing:${prediction.metricId}:${prediction.partition}`);
      continue;
    }
    if (!predictionPassed(prediction, measurement.delta)) {
      reasons.push(`required-prediction-failed:${prediction.metricId}:${prediction.partition}`);
    }
  }

  const primaryMetric = metricById.get(manifest.promotion.primaryMetricId);
  const primary = measurements.get(`${manifest.promotion.primaryMetricId}:sealed`);
  if (!primary) {
    reasons.push("sealed-primary-measurement-missing");
  } else {
    if (primary.repetitions < manifest.promotion.minimumRepetitions) {
      reasons.push("sealed-primary-repetitions-insufficient");
    }
    if (!metricImproved(primaryMetric, primary.delta, manifest.promotion.minimumPrimaryDelta)) {
      reasons.push("sealed-primary-improvement-insufficient");
    }
  }

  for (const metricId of manifest.promotion.safetyFloorMetricIds) {
    const metric = metricById.get(metricId);
    const measurement = measurements.get(`${metricId}:canary`) || measurements.get(`${metricId}:sealed`);
    if (!measurement) {
      reasons.push(`safety-floor-measurement-missing:${metricId}`);
    } else if (measurement.value < metric.hardFloor) {
      reasons.push(`safety-floor-measurement-failed:${metricId}`);
    }
  }

  for (const metric of manifest.metrics) {
    if (metric.primary || metric.direction === "floor") continue;
    const measurement = measurements.get(`${metric.id}:sealed`);
    if (!measurement) continue;
    const regression = metric.direction === "increase"
      ? Math.max(0, -measurement.delta)
      : Math.max(0, measurement.delta);
    if (regression > manifest.promotion.maximumSecondaryRegression) {
      reasons.push(`secondary-regression:${metric.id}`);
    }
  }

  if (manifest.promotion.independentReproductionRequired &&
      !validatedOutcome.reproductions.some((item) => item.independent && item.matched)) {
    reasons.push("independent-reproduction-missing");
  }
  if (validatedOutcome.receiptDigests.length === 0) reasons.push("proof-receipts-missing");

  const uniqueReasons = [...new Set(reasons)].sort();
  return {
    schema: "amos.research-promotion-decision",
    version: RESEARCH_PROTOCOL_VERSION,
    experimentId: validatedProposal.id,
    candidateId: validatedOutcome.candidate.id,
    eligible: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    evidence: {
      proposalDigest: digestResearchValue(validatedProposal),
      evaluationManifestDigest: digestResearchValue(manifest),
      outcomeDigest: digestResearchValue(validatedOutcome)
    }
  };
}

export function createResearchExperimentLedger(proposal, evaluationManifest) {
  const manifest = validateResearchEvaluationManifest(evaluationManifest);
  const validatedProposal = validateResearchExperimentProposal(proposal, { evaluationManifest: manifest });
  const proposalDigest = digestResearchValue(validatedProposal);
  const evaluationManifestDigest = digestResearchValue(manifest);
  const initial = buildLedgerEvent({
    sequence: 0,
    type: "proposal_recorded",
    at: validatedProposal.createdAt,
    actor: validatedProposal.proposer,
    subjectDigest: proposalDigest,
    previousDigest: null
  });
  return {
    schema: RESEARCH_LEDGER_SCHEMA,
    version: RESEARCH_PROTOCOL_VERSION,
    experimentId: validatedProposal.id,
    proposalDigest,
    evaluationManifestDigest,
    state: "proposed",
    headDigest: initial.eventDigest,
    events: [initial]
  };
}

export function appendResearchExperimentEvent(inputLedger, event) {
  const ledger = validateResearchExperimentLedger(inputLedger);
  assertExactFields(event, "event", ["type", "at", "actor", "subjectDigest"]);
  const nextState = LEDGER_TRANSITIONS[ledger.state]?.[event.type];
  if (!nextState) throw new Error(`Cannot apply ${event.type} while ledger is ${ledger.state}`);
  validDate(event.at, "event.at");
  validateLedgerActor(event.actor, `event.actor`);
  sha256(event.subjectDigest, "event.subjectDigest");
  if (GOVERNED_LEDGER_EVENTS.has(event.type) && event.actor.kind === "model") {
    throw new Error(`${event.type} requires a human, hybrid, or governed service actor`);
  }
  const nextEvent = buildLedgerEvent({
    sequence: ledger.events.length,
    type: event.type,
    at: event.at,
    actor: event.actor,
    subjectDigest: event.subjectDigest,
    previousDigest: ledger.headDigest
  });
  return {
    ...ledger,
    state: nextState,
    headDigest: nextEvent.eventDigest,
    events: [...ledger.events, nextEvent]
  };
}

export function validateResearchExperimentLedger(input) {
  const ledger = cloneJson(input, "Research experiment ledger");
  assertExactFields(ledger, "ledger", [
    "schema",
    "version",
    "experimentId",
    "proposalDigest",
    "evaluationManifestDigest",
    "state",
    "headDigest",
    "events"
  ]);
  assertSchema(ledger, RESEARCH_LEDGER_SCHEMA, "research experiment ledger");
  requiredId(ledger.experimentId, "ledger.experimentId");
  sha256(ledger.proposalDigest, "ledger.proposalDigest");
  sha256(ledger.evaluationManifestDigest, "ledger.evaluationManifestDigest");
  sha256(ledger.headDigest, "ledger.headDigest");
  if (!Array.isArray(ledger.events) || ledger.events.length === 0) {
    throw new Error("ledger.events must be a non-empty array");
  }

  let state = "proposed";
  let previousDigest = null;
  for (const [index, event] of ledger.events.entries()) {
    validateLedgerEvent(event, index, previousDigest);
    if (index === 0) {
      if (event.type !== "proposal_recorded" || event.subjectDigest !== ledger.proposalDigest) {
        throw new Error("Ledger must begin with the recorded proposal digest");
      }
    } else {
      const nextState = LEDGER_TRANSITIONS[state]?.[event.type];
      if (!nextState) throw new Error(`Invalid ledger transition ${state} -> ${event.type}`);
      if (GOVERNED_LEDGER_EVENTS.has(event.type) && event.actor.kind === "model") {
        throw new Error(`${event.type} cannot be recorded by a model actor`);
      }
      state = nextState;
    }
    previousDigest = event.eventDigest;
  }
  if (ledger.state !== state) throw new Error("ledger.state does not match its event history");
  if (ledger.headDigest !== previousDigest) throw new Error("ledger.headDigest does not match event history");
  return ledger;
}

export function digestResearchValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function assertManifestReference(proposal, manifest) {
  if (proposal.evaluation.manifestId !== manifest.id || proposal.evaluation.revision !== manifest.revision) {
    throw new Error("Proposal evaluation reference does not match manifest identity");
  }
  if (proposal.evaluation.manifestDigest !== digestResearchValue(manifest)) {
    throw new Error("Proposal evaluation reference does not match manifest digest");
  }
}

function validateReview(review, level) {
  assertExactFields(review, "proposal.review", ["path", "minimumApprovals"]);
  if (!REVIEW_PATHS.has(review.path)) throw new Error(`Unsupported review path: ${review.path}`);
  positiveInteger(review.minimumApprovals, "proposal.review.minimumApprovals");
  const levelNumber = RESEARCH_LEVELS.indexOf(level) + 1;
  if (levelNumber >= 5 && (review.path !== "council" || review.minimumApprovals < 2)) {
    throw new Error(`${level} requires council review with at least two approvals`);
  }
  if (levelNumber >= 3 && levelNumber < 5 &&
      (review.path === "owner" || review.minimumApprovals < 2)) {
    throw new Error(`${level} requires owner-plus-independent or council review`);
  }
}

function validateBudget(budget, label) {
  assertExactFields(budget, label, [
    "wallSeconds",
    "acceleratorSeconds",
    "maxCostUsd",
    "maxTokens",
    "maxStorageBytes"
  ]);
  positiveInteger(budget.wallSeconds, `${label}.wallSeconds`);
  nonNegativeInteger(budget.acceleratorSeconds, `${label}.acceleratorSeconds`);
  nonNegativeNumber(budget.maxCostUsd, `${label}.maxCostUsd`);
  nonNegativeInteger(budget.maxTokens, `${label}.maxTokens`);
  nonNegativeInteger(budget.maxStorageBytes, `${label}.maxStorageBytes`);
}

function validateUsage(usage, label) {
  assertExactFields(usage, label, [
    "wallSeconds",
    "acceleratorSeconds",
    "costUsd",
    "tokens",
    "storageBytes"
  ]);
  nonNegativeInteger(usage.wallSeconds, `${label}.wallSeconds`);
  nonNegativeInteger(usage.acceleratorSeconds, `${label}.acceleratorSeconds`);
  nonNegativeNumber(usage.costUsd, `${label}.costUsd`);
  nonNegativeInteger(usage.tokens, `${label}.tokens`);
  nonNegativeInteger(usage.storageBytes, `${label}.storageBytes`);
}

function candidateRef(candidate, label) {
  assertExactFields(candidate, label, ["id", "artifactDigest"]);
  requiredId(candidate.id, `${label}.id`);
  sha256(candidate.artifactDigest, `${label}.artifactDigest`);
}

function predictionPassed(prediction, delta) {
  if (prediction.direction === "increase") return delta >= prediction.minimumDelta;
  if (prediction.direction === "decrease") return -delta >= prediction.minimumDelta;
  return delta >= -prediction.minimumDelta;
}

function metricImproved(metric, delta, minimumDelta) {
  if (!metric) return false;
  if (metric.direction === "increase") return delta >= minimumDelta;
  if (metric.direction === "decrease") return -delta >= minimumDelta;
  return true;
}

function buildLedgerEvent({ sequence, type, at, actor, subjectDigest, previousDigest }) {
  const base = {
    sequence,
    type,
    at: validDate(at, "event.at").toISOString(),
    actor: normalizeLedgerActor(actor),
    subjectDigest,
    previousDigest
  };
  return { ...base, eventDigest: digestResearchValue(base) };
}

function validateLedgerEvent(event, index, previousDigest) {
  assertExactFields(event, `ledger.events[${index}]`, [
    "sequence",
    "type",
    "at",
    "actor",
    "subjectDigest",
    "previousDigest",
    "eventDigest"
  ]);
  if (event.sequence !== index) throw new Error(`ledger.events[${index}].sequence is invalid`);
  requiredId(event.type, `ledger.events[${index}].type`);
  validDate(event.at, `ledger.events[${index}].at`);
  validateLedgerActor(event.actor, `ledger.events[${index}].actor`);
  sha256(event.subjectDigest, `ledger.events[${index}].subjectDigest`);
  if (event.previousDigest !== previousDigest) {
    throw new Error(`ledger.events[${index}].previousDigest breaks the hash chain`);
  }
  sha256(event.eventDigest, `ledger.events[${index}].eventDigest`);
  const expectedDigest = digestResearchValue({
    sequence: event.sequence,
    type: event.type,
    at: event.at,
    actor: event.actor,
    subjectDigest: event.subjectDigest,
    previousDigest: event.previousDigest
  });
  if (event.eventDigest !== expectedDigest) {
    throw new Error(`ledger.events[${index}].eventDigest is invalid`);
  }
}

function normalizeLedgerActor(actor) {
  validateLedgerActor(actor, "event.actor");
  return {
    kind: actor.kind,
    id: requiredId(actor.id, "event.actor.id")
  };
}

function validateLedgerActor(actor, label) {
  assertKnownFields(actor, label, ["kind", "id", "modelCapabilityContractId"]);
  if (!LEDGER_ACTOR_KINDS.has(actor.kind)) throw new Error(`${label}.kind is unsupported`);
  requiredId(actor.id, `${label}.id`);
}

function assertSchema(value, schema, label) {
  if (value.schema !== schema || value.version !== RESEARCH_PROTOCOL_VERSION) {
    throw new Error(`Unsupported ${label} schema`);
  }
}

function assertExactFields(value, label, fields) {
  if (!plainObject(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label}.${field} is required`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label}.${field} is not allowed`);
  }
}

function assertKnownFields(value, label, fields) {
  if (!plainObject(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label}.${field} is not allowed`);
  }
}

function uniqueTextArray(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  if (nonEmpty && value.length === 0) throw new Error(`${label} must not be empty`);
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
}

function uniqueDigestArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const [index, digest] of value.entries()) sha256(digest, `${label}[${index}]`);
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
}

function requiredText(value, label, { maxLength = 500 } = {}) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} must be a non-empty string`);
  if (text.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return text;
}

function requiredId(value, label) {
  return requiredText(value, label, { maxLength: 200 });
}

function sha256(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function validDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`${label} must be non-negative`);
  return number;
}

function ratio(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0 || number > 1) throw new Error(`${label} must be between zero and one`);
  return number;
}

function cloneJson(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Research digest values must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("Research digest values must be JSON-compatible");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
