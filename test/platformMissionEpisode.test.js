import test from "node:test";
import assert from "node:assert/strict";
import {
  assessPlatformMissionVerification,
  createPlatformMissionLearningEpisode
} from "../src/research/platformMissionEpisode.js";
import { organismPolicyTrainingEligibility } from "../src/research/swarmLearningArena.js";

const DEFINITION = "a".repeat(64);
const RESULT = "b".repeat(64);
const CONTRACT = "c".repeat(64);
const TRACE = "d".repeat(64);

function missionFixture() {
  return {
    mission_id: "mission-001",
    name: "Build a verified prospect inventory",
    objective: "Find qualified prospects without outreach",
    status: "completed",
    status_reason: "independent verification satisfied",
    intelligence: "amos",
    created_at: "2026-08-28T10:00:00.000Z",
    started_at: "2026-08-28T10:01:00.000Z",
    finished_at: "2026-08-28T10:10:00.000Z",
    contract: {
      contract_id: "contract-001",
      contract_sha256: CONTRACT,
      verification_policy: {
        schema_version: "1",
        minimum_coverage: 1,
        requirements: [{
          id: "completion_condition",
          checker_id: "platform.metric_threshold",
          checker_version: "1",
          definition_sha256: DEFINITION,
          minimum_authority: "deterministic",
          config: { metric: "qualified_contacts", operator: ">=", target: 500 }
        }]
      }
    },
    steps: [],
    decisions: [],
    verification: [{
      checker_run_id: "platform-mission-001-completion",
      requirement_id: "completion_condition",
      checker_id: "platform.metric_threshold",
      checker_version: "1",
      definition_sha256: DEFINITION,
      result_sha256: RESULT,
      execution_location: "platform",
      authority: "deterministic",
      verdict: "pass",
      coverage: 1,
      expected: { target: 500 },
      observed: { value: 500 },
      evidence_refs: ["metric:qualified_contacts"],
      unknown_requirements: [],
      detail: "authoritative threshold passed",
      created_at: "2026-08-28T10:09:00.000Z"
    }]
  };
}

function gatewayTrace() {
  return {
    schema: "amos.swarm-turn-gateway-trace",
    version: 1,
    digest: TRACE,
    backendModel: "amos-qwen38-27b-fp8",
    mission: { missionId: "mission-001", contractId: "contract-001" },
    stages: [
      { stage: "candidate:primary" },
      { stage: "candidate:alternative" },
      { stage: "critic" },
      { stage: "integrator" }
    ]
  };
}

const DATA_POLICY = {
  sourceClass: "internal-authorized",
  permittedUses: ["research", "training"],
  trainingApproved: true,
  contaminationTags: ["amos-owned-mission"]
};

test("Platform checker receipts become verified organism learning evidence", () => {
  const mission = missionFixture();
  assert.deepEqual(assessPlatformMissionVerification(mission), {
    status: "complete",
    coverage: 1,
    pending: [],
    failed: [],
    passed: ["completion_condition"]
  });

  const episode = createPlatformMissionLearningEpisode({
    mission,
    gatewayTraces: [gatewayTrace()],
    dataPolicy: DATA_POLICY
  });

  assert.equal(episode.outcome.kind, "verified-pass");
  assert.equal(episode.trainingEligibility.eligible, true);
  assert.equal(organismPolicyTrainingEligibility(episode).eligible, true);
  assert.equal(episode.verifier.kind, "amos-platform-checker-waist");
  assert.equal(episode.artifacts[0].digest, RESULT);
  assert.equal(episode.ecology.assignmentCount, 4);
  assert.equal(episode.traces[0].digest, TRACE);
});

test("missing or under-authority checks stay negative learning evidence, never a pass", () => {
  const mission = missionFixture();
  mission.status = "failed";
  mission.status_reason = "required checker coverage remained unknown";
  mission.verification[0].authority = "independent_model";

  const assessment = assessPlatformMissionVerification(mission);
  assert.equal(assessment.status, "pending");
  assert.deepEqual(assessment.pending, ["completion_condition"]);

  const episode = createPlatformMissionLearningEpisode({
    mission,
    gatewayTraces: [gatewayTrace()],
    dataPolicy: DATA_POLICY
  });
  assert.equal(episode.execution.status, "errored");
  assert.equal(episode.verifier.status, "not-run");
  assert.equal(episode.outcome.kind, "execution-error");
  assert.equal(episode.trainingEligibility.eligible, false);
  assert.equal(organismPolicyTrainingEligibility(episode).eligible, true);
});
