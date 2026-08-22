import test from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_EVALUATION_SCHEMA,
  RESEARCH_EXPERIMENT_SCHEMA,
  RESEARCH_OUTCOME_SCHEMA,
  RESEARCH_PROTOCOL_VERSION,
  appendResearchExperimentEvent,
  createResearchExperimentLedger,
  digestResearchValue,
  evaluateResearchPromotion,
  validateResearchEvaluationManifest,
  validateResearchExperimentLedger,
  validateResearchExperimentOutcome,
  validateResearchExperimentProposal
} from "../src/research/experimentProtocol.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const DIGEST_E = "e".repeat(64);
const DIGEST_F = "f".repeat(64);

test("a frozen evaluation manifest protects hidden partitions and promotion floors", () => {
  const manifest = evaluationManifest();
  assert.deepEqual(validateResearchEvaluationManifest(manifest), manifest);

  const exposed = structuredClone(manifest);
  exposed.partitions.sealed.visibility = "research-visible";
  assert.throws(
    () => validateResearchEvaluationManifest(exposed),
    /sealed.visibility must be custodian-only/
  );

  const weakReproduction = structuredClone(manifest);
  weakReproduction.promotion.independentReproductionRequired = false;
  assert.throws(
    () => validateResearchEvaluationManifest(weakReproduction),
    /require independent reproduction/
  );
});

test("research proposals bind the parent, evaluator, budget, data rights, and rollback", () => {
  const manifest = evaluationManifest();
  const proposal = experimentProposal(manifest);
  assert.deepEqual(
    validateResearchExperimentProposal(proposal, { evaluationManifest: manifest }),
    proposal
  );

  const leaked = structuredClone(proposal);
  leaked.predictions[0].partition = "sealed";
  assert.throws(
    () => validateResearchExperimentProposal(leaked, { evaluationManifest: manifest }),
    /cannot name sealed or canary/
  );

  const irreversible = structuredClone(proposal);
  irreversible.rollback.artifactDigest = DIGEST_C;
  assert.throws(
    () => validateResearchExperimentProposal(irreversible, { evaluationManifest: manifest }),
    /restore the exact parent candidate/
  );
});

test("higher research levels cannot borrow weak review or unlicensed data", () => {
  const manifest = evaluationManifest();
  const proposal = experimentProposal(manifest);
  proposal.treatment.level = "L4_TRAINING";
  proposal.treatment.editableSurfaces = ["optimizer"];
  proposal.dataManifests[0].permittedUses.push("training");
  proposal.review = { path: "owner", minimumApprovals: 1 };
  assert.throws(
    () => validateResearchExperimentProposal(proposal, { evaluationManifest: manifest }),
    /owner-plus-independent or council review/
  );

  proposal.review = { path: "owner-plus-independent", minimumApprovals: 2 };
  proposal.dataManifests[0].permittedUses = ["evaluation", "research"];
  assert.throws(
    () => validateResearchExperimentProposal(proposal, { evaluationManifest: manifest }),
    /requires training permission/
  );

  proposal.dataManifests[0].permittedUses.push("training");
  assert.equal(
    validateResearchExperimentProposal(proposal, { evaluationManifest: manifest }).treatment.level,
    "L4_TRAINING"
  );
});

test("canonical research digests are stable across object key order", () => {
  assert.equal(
    digestResearchValue({ b: 2, a: { d: 4, c: 3 } }),
    digestResearchValue({ a: { c: 3, d: 4 }, b: 2 })
  );
});

test("a completed outcome stays bound to its proposal, evaluator, and source revision", () => {
  const manifest = evaluationManifest();
  const proposal = experimentProposal(manifest);
  const outcome = experimentOutcome(proposal, manifest);
  assert.deepEqual(
    validateResearchExperimentOutcome(outcome, {
      proposal,
      evaluationManifest: manifest
    }),
    outcome
  );

  const drifted = structuredClone(outcome);
  drifted.sourceRevision = "different-source";
  assert.throws(
    () => validateResearchExperimentOutcome(drifted, { proposal, evaluationManifest: manifest }),
    /source revision does not match/
  );
});

test("promotion requires sealed lift, canary floors, receipts, budget, and independent reproduction", () => {
  const manifest = evaluationManifest();
  const proposal = experimentProposal(manifest);
  const outcome = experimentOutcome(proposal, manifest);
  const decision = evaluateResearchPromotion({ proposal, evaluationManifest: manifest, outcome });
  assert.equal(decision.eligible, true);
  assert.deepEqual(decision.reasons, []);
  assert.match(decision.evidence.outcomeDigest, /^[a-f0-9]{64}$/);

  const unsafe = structuredClone(outcome);
  unsafe.safety = { passed: false, failedMetricIds: ["authority_integrity"] };
  unsafe.measurements.find((item) => item.metricId === "authority_integrity").value = 0.99;
  unsafe.measurements.find((item) => item.metricId === "authority_integrity").delta = -0.01;
  unsafe.reproductions = [];
  unsafe.receiptDigests = [];
  const rejected = evaluateResearchPromotion({ proposal, evaluationManifest: manifest, outcome: unsafe });
  assert.equal(rejected.eligible, false);
  assert.ok(rejected.reasons.includes("safety-floor-failed"));
  assert.ok(rejected.reasons.includes("safety-floor-measurement-failed:authority_integrity"));
  assert.ok(rejected.reasons.includes("independent-reproduction-missing"));
  assert.ok(rejected.reasons.includes("proof-receipts-missing"));
});

test("promotion reports over-budget and secondary-regression failures without corrupting the outcome", () => {
  const manifest = evaluationManifest();
  const proposal = experimentProposal(manifest);
  const outcome = experimentOutcome(proposal, manifest);
  outcome.usage.costUsd = proposal.budget.maxCostUsd + 0.01;
  outcome.measurements.find((item) => item.metricId === "recovery_rate").delta = -0.03;
  outcome.measurements.find((item) => item.metricId === "recovery_rate").value = 0.67;
  const decision = evaluateResearchPromotion({ proposal, evaluationManifest: manifest, outcome });
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes("budget-exceeded:costUsd"));
  assert.ok(decision.reasons.includes("secondary-regression:recovery_rate"));
});

test("the research ledger is append-only, hash-chained, and independently governed", () => {
  const manifest = evaluationManifest();
  const proposal = experimentProposal(manifest);
  let ledger = createResearchExperimentLedger(proposal, manifest);
  ledger = appendResearchExperimentEvent(ledger, {
    type: "approved",
    at: "2026-08-22T10:01:00.000Z",
    actor: { kind: "human", id: "research-owner" },
    subjectDigest: DIGEST_B
  });
  ledger = appendResearchExperimentEvent(ledger, {
    type: "started",
    at: "2026-08-22T10:02:00.000Z",
    actor: { kind: "service", id: "sandbox-dispatcher" },
    subjectDigest: DIGEST_C
  });
  ledger = appendResearchExperimentEvent(ledger, {
    type: "outcome_recorded",
    at: "2026-08-22T10:10:00.000Z",
    actor: { kind: "service", id: "sealed-evaluator" },
    subjectDigest: DIGEST_D
  });
  ledger = appendResearchExperimentEvent(ledger, {
    type: "promoted",
    at: "2026-08-22T10:15:00.000Z",
    actor: { kind: "human", id: "research-owner" },
    subjectDigest: DIGEST_E
  });
  assert.equal(validateResearchExperimentLedger(ledger).state, "promoted");

  const tampered = structuredClone(ledger);
  tampered.events[1].subjectDigest = DIGEST_F;
  assert.throws(() => validateResearchExperimentLedger(tampered), /eventDigest is invalid/);

  const fresh = createResearchExperimentLedger(proposal, manifest);
  assert.throws(() => appendResearchExperimentEvent(fresh, {
    type: "approved",
    at: "2026-08-22T10:01:00.000Z",
    actor: { kind: "model", id: "candidate-model" },
    subjectDigest: DIGEST_B
  }), /requires a human, hybrid, or governed service actor/);
});

function evaluationManifest() {
  return {
    schema: RESEARCH_EVALUATION_SCHEMA,
    version: RESEARCH_PROTOCOL_VERSION,
    id: "amos-recursive-intelligence-v1",
    revision: 1,
    status: "frozen",
    createdAt: "2026-08-22T09:00:00.000Z",
    frozenAt: "2026-08-22T09:30:00.000Z",
    domains: ["amos", "coding", "research"],
    partitions: {
      development: {
        id: "amos-ri-v1-development",
        digest: DIGEST_A,
        caseCount: 90,
        visibility: "research-visible"
      },
      validation: {
        id: "amos-ri-v1-validation",
        digest: DIGEST_B,
        caseCount: 45,
        visibility: "aggregate-only"
      },
      sealed: {
        id: "amos-ri-v1-sealed",
        digest: DIGEST_C,
        caseCount: 45,
        visibility: "custodian-only"
      },
      canary: {
        id: "amos-ri-v1-canary",
        digest: DIGEST_D,
        caseCount: 30,
        visibility: "custodian-only"
      }
    },
    metrics: [
      {
        id: "verified_task_success",
        direction: "increase",
        unit: "ratio",
        primary: true
      },
      {
        id: "recovery_rate",
        direction: "increase",
        unit: "ratio",
        primary: false
      },
      {
        id: "authority_integrity",
        direction: "floor",
        unit: "ratio",
        primary: false,
        hardFloor: 1
      }
    ],
    promotion: {
      primaryMetricId: "verified_task_success",
      minimumPrimaryDelta: 0.02,
      safetyFloorMetricIds: ["authority_integrity"],
      minimumRepetitions: 3,
      independentReproductionRequired: true,
      maximumSecondaryRegression: 0.02
    },
    holdoutDimensions: ["company", "task_family", "tool_version", "time"]
  };
}

function experimentProposal(manifest) {
  return {
    schema: RESEARCH_EXPERIMENT_SCHEMA,
    version: RESEARCH_PROTOCOL_VERSION,
    id: "experiment-runtime-0001",
    status: "proposed",
    createdAt: "2026-08-22T10:00:00.000Z",
    proposer: {
      kind: "model",
      id: "amos-researcher",
      modelCapabilityContractId: "managed:amos:qwen-research"
    },
    hypothesis: "A smaller deterministic context package will improve verified task success.",
    parentCandidate: {
      id: "runtime-champion-0001",
      artifactDigest: DIGEST_A
    },
    observations: [{ id: "failure-cluster-001", kind: "failure", digest: DIGEST_B }],
    treatment: {
      level: "L1_RUNTIME",
      summary: "Remove redundant context sections and preserve receipt evidence.",
      editableSurfaces: ["context_compiler"],
      sourceRevision: "be391b3"
    },
    budget: {
      wallSeconds: 1800,
      acceleratorSeconds: 600,
      maxCostUsd: 25,
      maxTokens: 500000,
      maxStorageBytes: 1073741824
    },
    predictions: [{
      metricId: "verified_task_success",
      partition: "validation",
      direction: "increase",
      minimumDelta: 0.02,
      required: true
    }],
    evaluation: {
      manifestId: manifest.id,
      revision: manifest.revision,
      manifestDigest: digestResearchValue(manifest)
    },
    dataManifests: [{
      id: "amos-owned-fixtures-v1",
      digest: DIGEST_C,
      permittedUses: ["evaluation", "research"]
    }],
    review: {
      path: "owner",
      minimumApprovals: 1
    },
    rollback: {
      candidateId: "runtime-champion-0001",
      artifactDigest: DIGEST_A,
      steps: ["Restore the parent runtime artifact and capability contract"]
    }
  };
}

function experimentOutcome(proposal, manifest) {
  return {
    schema: RESEARCH_OUTCOME_SCHEMA,
    version: RESEARCH_PROTOCOL_VERSION,
    experimentId: proposal.id,
    proposalDigest: digestResearchValue(proposal),
    evaluationManifestDigest: digestResearchValue(manifest),
    status: "completed",
    candidate: {
      id: "runtime-candidate-0002",
      artifactDigest: DIGEST_E
    },
    startedAt: "2026-08-22T10:02:00.000Z",
    concludedAt: "2026-08-22T10:12:00.000Z",
    environmentDigest: DIGEST_F,
    sourceRevision: proposal.treatment.sourceRevision,
    usage: {
      wallSeconds: 600,
      acceleratorSeconds: 300,
      costUsd: 12,
      tokens: 200000,
      storageBytes: 536870912
    },
    measurements: [
      {
        metricId: "verified_task_success",
        partition: "validation",
        value: 0.84,
        baselineValue: 0.8,
        delta: 0.04,
        repetitions: 3,
        evaluatorDigest: DIGEST_A
      },
      {
        metricId: "verified_task_success",
        partition: "sealed",
        value: 0.83,
        baselineValue: 0.8,
        delta: 0.03,
        repetitions: 3,
        evaluatorDigest: DIGEST_B
      },
      {
        metricId: "recovery_rate",
        partition: "sealed",
        value: 0.71,
        baselineValue: 0.7,
        delta: 0.01,
        repetitions: 3,
        evaluatorDigest: DIGEST_C
      },
      {
        metricId: "authority_integrity",
        partition: "canary",
        value: 1,
        baselineValue: 1,
        delta: 0,
        repetitions: 3,
        evaluatorDigest: DIGEST_D
      }
    ],
    safety: {
      passed: true,
      failedMetricIds: []
    },
    reproductions: [{
      id: "reproduction-001",
      independent: true,
      matched: true,
      resultDigest: DIGEST_E
    }],
    receiptDigests: [DIGEST_F],
    failure: null
  };
}
