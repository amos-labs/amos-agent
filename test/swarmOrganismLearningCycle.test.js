import test from "node:test";
import assert from "node:assert/strict";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import {
  candidatesFromOrganismPolicySearch,
  createOrganismLearningCandidate,
  nextOrganismLearningAction,
  recordOrganismLearningGate
} from "../src/research/swarmOrganismLearningCycle.js";
import { DEFAULT_ORGANISM_POLICY } from "../src/research/swarmOrganismSimulator.js";

const digest = (value) => digestResearchValue(value);

test("a policy candidate advances in order and cannot self-promote beyond canary", () => {
  let candidate = createOrganismLearningCandidate({
    id: "candidate-001",
    policy: DEFAULT_ORGANISM_POLICY,
    optimizedParameters: ["bid.repetitionPenalty"],
    policySearchDigest: digest("search"),
    transitionModelDigest: digest("model"),
    rank: 1,
    createdAt: "2026-08-24T08:00:00.000Z"
  });

  for (const [index, [id, evaluator]] of [
    ["simulation", "organism-simulator"],
    ["immutable-artifact-replay", "artifact-replay-verifier"],
    ["real-qwen-phase-probes", "qwen-execution-verifier"],
    ["full-real-qwen-mission", "qwen-mission-verifier"],
    ["frozen-holdout", "independent-holdout-verifier"],
    ["canary", "canary-telemetry-verifier"]
  ].entries()) {
    candidate = recordOrganismLearningGate(candidate, {
      id,
      status: "passed",
      evaluator,
      receiptDigest: digest({ id, index }),
      metrics: { passRate: 1 },
      feedbackSignals: [],
      evaluatedAt: `2026-08-24T08:${String(index).padStart(2, "0")}:00.000Z`
    });
  }

  assert.equal(candidate.status, "canary-approved");
  assert.equal(candidate.deployment.canaryAllowed, true);
  assert.equal(candidate.deployment.productionAllowed, false);
  assert.equal(candidate.deployment.automaticallyDeployed, false);
  assert.equal(nextOrganismLearningAction(candidate), null);
});

test("a failed gate produces durable feedback and blocks later qualification", () => {
  let candidate = createOrganismLearningCandidate({
    id: "candidate-002",
    policy: DEFAULT_ORGANISM_POLICY,
    optimizedParameters: ["bid.repetitionPenalty"],
    policySearchDigest: digest("search"),
    transitionModelDigest: digest("model"),
    rank: 2
  });
  candidate = recordOrganismLearningGate(candidate, {
    id: "simulation",
    status: "failed",
    evaluator: "organism-simulator",
    receiptDigest: digest("failed-simulation"),
    metrics: { passRate: 0 },
    feedbackSignals: ["repeated-agent-loop"]
  });

  assert.equal(candidate.status, "rejected");
  assert.deepEqual(candidate.feedback.map(({ signal }) => signal), ["repeated-agent-loop"]);
  assert.throws(() => recordOrganismLearningGate(candidate, {
    id: "immutable-artifact-replay",
    status: "passed",
    evaluator: "artifact-replay-verifier",
    receiptDigest: digest("replay"),
    metrics: {},
    feedbackSignals: []
  }), /already rejected/);
});

test("a simulator promotion queue becomes artifact-replay work, not deployment", () => {
  const searchBase = {
    schema: "amos.swarm-organism-policy-search",
    version: 1,
    transitionModelDigest: digest("model"),
    optimizedParameters: ["bid.repetitionPenalty"],
    promotionQueue: [{
      rank: 1,
      policy: DEFAULT_ORGANISM_POLICY,
      simulatedMetrics: { simulatedPassRate: 0.8 },
      automaticallyPromoted: false
    }]
  };
  const search = { ...searchBase, digest: digest(searchBase) };
  const [candidate] = candidatesFromOrganismPolicySearch(search, { prefix: "run-1" });
  const action = nextOrganismLearningAction(candidate);

  assert.equal(candidate.nextGate, "immutable-artifact-replay");
  assert.equal(candidate.deployment.canaryAllowed, false);
  assert.equal(action.kind, "organism-artifact-replay");
});

test("gates cannot be skipped or certified by the wrong evaluator", () => {
  const candidate = createOrganismLearningCandidate({
    id: "candidate-003",
    policy: DEFAULT_ORGANISM_POLICY,
    optimizedParameters: ["bid.repetitionPenalty"],
    policySearchDigest: digest("search"),
    transitionModelDigest: digest("model"),
    rank: 3
  });
  assert.throws(() => recordOrganismLearningGate(candidate, {
    id: "real-qwen-phase-probes",
    status: "passed",
    evaluator: "qwen-execution-verifier",
    receiptDigest: digest("probe"),
    metrics: {},
    feedbackSignals: []
  }), /Expected gate simulation/);
  assert.throws(() => recordOrganismLearningGate(candidate, {
    id: "simulation",
    status: "passed",
    evaluator: "qwen-execution-verifier",
    receiptDigest: digest("probe"),
    metrics: {},
    feedbackSignals: []
  }), /requires evaluator organism-simulator/);
});
