import { createHash } from "node:crypto";
import { validateRouterFeedback } from "../model/routerFeedback.js";

export const ROUTER_FAILURE_CAUSES = Object.freeze([
  "missing-memory", "wrong-tool", "execution", "runtime", "platform-mapping",
  "routing-capability", "unknown"
]);
const CLASSES = ["routine", "balanced", "deep", "frontier"];
const TARGETS = {
  "missing-memory": "platform-context",
  "wrong-tool": "mission-agent",
  execution: "mission-agent",
  runtime: "runtime",
  "platform-mapping": "platform-model-mapping",
  "routing-capability": "router-policy",
  unknown: "independent-review"
};

/** Offline triage of a reviewed observation. Hashes bind evidence references;
 * they do not authenticate a verifier or grant access to the underlying task.
 * This output is deliberately not a training record or a promotion decision.
 */
export function reviewRouterCorrection({ observation, adjudication }) {
  validateRouterFeedback(observation);
  const review = adjudication;
  if (review?.schema !== "amos.router-correction-adjudication" || review.version !== 1) {
    throw new Error("Unsupported correction adjudication");
  }
  digest(review.observationSha256, "observationSha256");
  if (review.observationSha256 !== hash(observation)) throw new Error("Observation changed after review");
  if (!ROUTER_FAILURE_CAUSES.includes(review.cause)) throw new Error("Unknown failure cause");
  bounded(review.rationale, "rationale", 2000);
  const request = observation.requests.find(r => r.requestId === review.requestId);
  if (!request || observation.requests.filter(r => r.requestId === review.requestId).length !== 1) {
    throw new Error("Review must identify exactly one observed router request");
  }
  const reasons = [];
  if (review.cause !== "routing-capability") reasons.push("failure-belongs-to-another-learning-target");
  if (review.outcome?.kind !== "independent-task-verification") reasons.push("task-correctness-not-independently-checked");
  else {
    digest(review.outcome.receiptSha256, "outcome receipt");
    bounded(review.outcome.verifierId, "verifierId", 200);
    bounded(review.outcome.verifierVersion, "verifierVersion", 200);
    if (typeof review.outcome.passed !== "boolean") throw new Error("Verifier outcome must be boolean");
    if (!request.platformCallId || review.outcome.platformCallId !== request.platformCallId) reasons.push("outcome-not-correlated-to-request");
  }
  const policy = review.policy;
  if (!policy || !CLASSES.includes(policy.expectedClass) || !policy.reviewerId || !policy.rationale) {
    reasons.push("capability-policy-label-not-reviewed");
  } else {
    digest(policy.promptSha256, "policy prompt");
    bounded(policy.reviewerId, "policy reviewer", 200);
    bounded(policy.rationale, "policy rationale", 2000);
    if (policy.promptSha256 !== request.promptSha256) reasons.push("policy-does-not-match-observed-router");
    if (policy.expectedClass === request.proposedClass) reasons.push("observed-route-already-matches-policy");
  }
  const snapshot = review.executionSnapshot;
  const fields = ["routerInputSha256", "routerPromptSha256", "routerArtifactSha256", "toolCatalogSha256", "memorySnapshotSha256", "modelCatalogSha256", "budgetSha256", "executionPolicySha256"];
  if (!snapshot || fields.some(key => !snapshot[key]) || !snapshot.missionRuntimeRevision) {
    reasons.push("execution-conditions-not-pinned");
  } else {
    for (const key of fields) digest(snapshot[key], key);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64}|sha256:[a-f0-9]{64})$/.test(snapshot.missionRuntimeRevision)) {
      reasons.push("mission-runtime-revision-is-not-immutable");
    }
    if (snapshot.routerInputSha256 !== request.inputSha256 || snapshot.routerPromptSha256 !== request.promptSha256 || snapshot.routerArtifactSha256 !== request.artifactSha256) {
      reasons.push("review-is-for-a-different-router-input");
    }
  }
  if (!request.applied || !request.responseObserved || request.fallbackUsed || request.platformFallbackUsed) {
    reasons.push("observed-decision-was-not-cleanly-executed");
  }
  if (!request.servedClass || !request.servedModel.trim()) reasons.push("served-backend-not-observed");
  if (request.servedClass && request.servedClass !== request.proposedClass) reasons.push("platform-mapping-confounds-router-outcome");
  if (review.dataRights?.routerTrainingApproved !== true || !review.dataRights?.consentRef) reasons.push("router-training-rights-not-established");
  else bounded(review.dataRights.consentRef, "consentRef", 1000);
  const eligibleForPolicyDatasetReview = reasons.length === 0;
  const value = {
    schema: "amos.router-correction-review", version: 1,
    observationSha256: review.observationSha256,
    adjudicationSha256: hash(review), requestId: review.requestId,
    cause: review.cause, learningTarget: TARGETS[review.cause], reasons,
    eligibleForPolicyDatasetReview,
    proposedPolicyClass: eligibleForPolicyDatasetReview ? policy.expectedClass : null,
    trainingEligible: false, promotionAllowed: false,
    nextAction: eligibleForPolicyDatasetReview
      ? "Resolve evidence and input under existing access rules, authenticate the review, then admit to a balanced policy dataset with held-out evaluation."
      : "Address the identified learning target or missing evidence before proposing a router correction."
  };
  return { ...value, digest: hash(value) };
}

export function routerCorrectionDigest(value) { return hash(value); }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function digest(value, name) { if (!/^[a-f0-9]{64}$/.test(value || "")) throw new Error(`Invalid ${name} digest`); }
function bounded(value, name, max) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`); }
