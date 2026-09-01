import test from "node:test";
import assert from "node:assert/strict";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { replayOrganismPolicyArtifacts } from "../src/research/swarmOrganismArtifactReplay.js";
import {
  createOrganismLearningCandidate,
  recordOrganismLearningGate
} from "../src/research/swarmOrganismLearningCycle.js";
import { DEFAULT_ORGANISM_POLICY } from "../src/research/swarmOrganismSimulator.js";

function simulationPassedCandidate(policy = DEFAULT_ORGANISM_POLICY) {
  const created = createOrganismLearningCandidate({
    id: "candidate-replay",
    policy,
    optimizedParameters: [
      "bid.repetitionPenalty",
      "pheromone.partialProgressIntensity",
      "energy.partialProgressReward",
      "retry.challengerExploration"
    ],
    policySearchDigest: digestResearchValue("search"),
    transitionModelDigest: digestResearchValue("model"),
    rank: 1
  });
  return recordOrganismLearningGate(created, {
    id: "simulation",
    status: "passed",
    evaluator: "organism-simulator",
    receiptDigest: digestResearchValue("simulation-receipt"),
    metrics: { simulatedPassRate: 1 },
    feedbackSignals: []
  });
}

const episodes = ["episode-a", "episode-b"].map((id) => ({
  id,
  digest: digestResearchValue(id),
  task: { name: "accounts-payable-process" }
}));

test("artifact replay advances a challenger-capable candidate without claiming quality", () => {
  const { receipt, candidate } = replayOrganismPolicyArtifacts({
    candidate: simulationPassedCandidate({
      ...DEFAULT_ORGANISM_POLICY,
      "bid.repetitionPenalty": 4,
      "retry.challengerExploration": 1
    }),
    episodes
  });

  assert.equal(receipt.status, "passed");
  assert.equal(receipt.metrics.modelCalls, 0);
  assert.equal(receipt.metrics.createsQualityEvidence, false);
  assert.equal(receipt.metrics.challengerRate, 1);
  assert.equal(candidate.nextGate, "real-qwen-phase-probes");
  assert.equal(candidate.deployment.canaryAllowed, false);
});

test("artifact replay rejects a policy that repeats an equivalent failed agent", () => {
  const { receipt, candidate } = replayOrganismPolicyArtifacts({
    candidate: simulationPassedCandidate({
      ...DEFAULT_ORGANISM_POLICY,
      "bid.repetitionPenalty": 0,
      "energy.partialProgressReward": 1,
      "retry.challengerExploration": 0
    }),
    episodes
  });

  assert.equal(receipt.status, "failed");
  assert.ok(receipt.feedbackSignals.includes("repeated-agent-loop"));
  assert.equal(candidate.status, "rejected");
});

test("artifact replay refuses candidates that skipped the simulation gate", () => {
  const candidate = createOrganismLearningCandidate({
    id: "candidate-not-ready",
    policy: DEFAULT_ORGANISM_POLICY,
    optimizedParameters: ["bid.repetitionPenalty"],
    policySearchDigest: digestResearchValue("search"),
    transitionModelDigest: digestResearchValue("model"),
    rank: 1
  });
  assert.throws(() => replayOrganismPolicyArtifacts({ candidate, episodes }), /not awaiting/);
});
