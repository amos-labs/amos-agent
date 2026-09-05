import test from "node:test";
import assert from "node:assert/strict";
import { reviewRouterCorrection, routerCorrectionDigest } from "../src/research/routerCorrectionReview.js";
import { RouterFeedbackRecorder } from "../src/model/routerFeedback.js";

function fixture() {
  const sha = "a".repeat(64);
  const recorder = new RouterFeedbackRecorder();
  recorder.observe({ type: "routing", status: "classified", routingRequestId: "r1", minimumClass: "balanced", inputSha256: sha, promptSha256: sha, artifactSha256: sha, routingApplied: true, rolloutMode: "active" });
  recorder.observe({ type: "routing", status: "served", routingRequestId: "r1", hostedClass: "balanced", servedModel: "fixture-backend-v1", platformCallId: "call1" });
  recorder.observe({ type: "usage", routingRequestId: "r1" });
  const observation = recorder.finish("completed");
  return { observation, adjudication: {
    schema: "amos.router-correction-adjudication", version: 1,
    observationSha256: routerCorrectionDigest(observation), requestId: "r1",
    cause: "routing-capability", rationale: "The task required separating competing causes.",
    outcome: { kind: "independent-task-verification", receiptSha256: sha, verifierId: "causal-check", verifierVersion: "1", platformCallId: "call1", passed: false },
    policy: { expectedClass: "deep", promptSha256: sha, reviewerId: "policy-reviewer", rationale: "Competing causal hypotheses require deep under this policy." },
    executionSnapshot: Object.fromEntries(["routerInputSha256", "routerPromptSha256", "routerArtifactSha256", "toolCatalogSha256", "memorySnapshotSha256", "modelCatalogSha256", "budgetSha256", "executionPolicySha256"].map(k=>[k,sha]).concat([["missionRuntimeRevision", "c".repeat(40)]])),
    dataRights: { routerTrainingApproved: true, consentRef: "amos-owned-research-approval" }
  } };
}

test("fully reviewed capability correction reaches policy dataset review without manufacturing a training receipt", () => {
  const result = reviewRouterCorrection(fixture());
  assert.equal(result.eligibleForPolicyDatasetReview, true);
  assert.equal(result.proposedPolicyClass, "deep");
  assert.equal(result.trainingEligible, false);
  assert.equal(result.promotionAllowed, false);
});

for (const cause of ["missing-memory", "wrong-tool", "execution", "runtime", "platform-mapping", "unknown"]) {
  test(`${cause} cannot silently escalate the router label`, () => {
    const input = fixture(); input.adjudication.cause = cause;
    const result = reviewRouterCorrection(input);
    assert.equal(result.eligibleForPolicyDatasetReview, false);
    assert.equal(result.proposedPolicyClass, null);
    assert.notEqual(result.learningTarget, "router-policy");
  });
}

test("resolved citation IDs and successful completion are insufficient correctness evidence", () => {
  for (const kind of ["citation-ids-resolved", "terminal-completed", "shadow-text-agreement", "mission-plan-schema-valid"]) {
    const input = fixture(); input.adjudication.outcome.kind = kind;
    assert.ok(reviewRouterCorrection(input).reasons.includes("task-correctness-not-independently-checked"));
  }
});

test("strategy-learning permission does not grant router-training rights", () => {
  const input = fixture(); input.adjudication.dataRights = { strategyLearningApproved: true };
  assert.ok(reviewRouterCorrection(input).reasons.includes("router-training-rights-not-established"));
});

test("changed inputs, runtime evidence, policy and mapping prevent conflated learning", () => {
  for (const change of [
    i => { i.adjudication.executionSnapshot.routerInputSha256 = "b".repeat(64); },
    i => { i.adjudication.executionSnapshot.routerArtifactSha256 = "b".repeat(64); },
    i => { i.adjudication.outcome.platformCallId = "another-call"; },
    i => { delete i.adjudication.executionSnapshot.missionRuntimeRevision; },
    i => { i.adjudication.executionSnapshot.missionRuntimeRevision = "latest"; },
    i => { i.adjudication.policy.promptSha256 = "b".repeat(64); },
    i => { i.observation.requests[0].servedClass = "frontier"; },
    i => { i.observation.requests[0].servedClass = null; },
    i => { i.observation.requests[0].servedModel = ""; },
    i => { i.observation.requests[0].platformFallbackUsed = true; },
    i => { i.adjudication.policy.expectedClass = "balanced"; }
  ]) {
    const input = fixture(); change(input);
    input.adjudication.observationSha256 = routerCorrectionDigest(input.observation);
    assert.equal(reviewRouterCorrection(input).eligibleForPolicyDatasetReview, false);
  }
});

test("review cannot be applied to a mutated observation", () => {
  const input = fixture(); input.observation.requests[0].inputSha256 = "b".repeat(64);
  assert.throws(()=>reviewRouterCorrection(input), /changed after review/);
});
