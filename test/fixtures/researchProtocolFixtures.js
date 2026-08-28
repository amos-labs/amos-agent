import {
  RESEARCH_EVALUATION_SCHEMA,
  RESEARCH_EXPERIMENT_SCHEMA,
  RESEARCH_OUTCOME_SCHEMA,
  RESEARCH_PROTOCOL_VERSION,
  digestResearchValue
} from "../../src/research/experimentProtocol.js";

export const RESEARCH_TEST_DIGESTS = Object.freeze({
  a: "a".repeat(64),
  b: "b".repeat(64),
  c: "c".repeat(64),
  d: "d".repeat(64),
  e: "e".repeat(64),
  f: "f".repeat(64)
});

export function researchEvaluationManifest() {
  const digest = RESEARCH_TEST_DIGESTS;
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
        digest: digest.a,
        caseCount: 90,
        visibility: "research-visible"
      },
      validation: {
        id: "amos-ri-v1-validation",
        digest: digest.b,
        caseCount: 45,
        visibility: "aggregate-only"
      },
      sealed: {
        id: "amos-ri-v1-sealed",
        digest: digest.c,
        caseCount: 45,
        visibility: "custodian-only"
      },
      canary: {
        id: "amos-ri-v1-canary",
        digest: digest.d,
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

export function researchExperimentProposal(manifest = researchEvaluationManifest()) {
  const digest = RESEARCH_TEST_DIGESTS;
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
      artifactDigest: digest.a
    },
    observations: [{ id: "failure-cluster-001", kind: "failure", digest: digest.b }],
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
      digest: digest.c,
      permittedUses: ["evaluation", "research"]
    }],
    review: {
      path: "owner",
      minimumApprovals: 1
    },
    rollback: {
      candidateId: "runtime-champion-0001",
      artifactDigest: digest.a,
      steps: ["Restore the parent runtime artifact and capability contract"]
    }
  };
}

export function researchExperimentOutcome(
  proposal,
  manifest = researchEvaluationManifest()
) {
  const digest = RESEARCH_TEST_DIGESTS;
  return {
    schema: RESEARCH_OUTCOME_SCHEMA,
    version: RESEARCH_PROTOCOL_VERSION,
    experimentId: proposal.id,
    proposalDigest: digestResearchValue(proposal),
    evaluationManifestDigest: digestResearchValue(manifest),
    status: "completed",
    candidate: {
      id: "runtime-candidate-0002",
      artifactDigest: digest.e
    },
    startedAt: "2026-08-22T10:02:00.000Z",
    concludedAt: "2026-08-22T10:12:00.000Z",
    environmentDigest: digest.f,
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
        evaluatorDigest: digest.a
      },
      {
        metricId: "verified_task_success",
        partition: "sealed",
        value: 0.83,
        baselineValue: 0.8,
        delta: 0.03,
        repetitions: 3,
        evaluatorDigest: digest.b
      },
      {
        metricId: "recovery_rate",
        partition: "sealed",
        value: 0.71,
        baselineValue: 0.7,
        delta: 0.01,
        repetitions: 3,
        evaluatorDigest: digest.c
      },
      {
        metricId: "authority_integrity",
        partition: "canary",
        value: 1,
        baselineValue: 1,
        delta: 0,
        repetitions: 3,
        evaluatorDigest: digest.d
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
      resultDigest: digest.e
    }],
    receiptDigests: [digest.f],
    failure: null
  };
}
