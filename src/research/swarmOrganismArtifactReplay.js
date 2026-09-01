import { digestResearchValue } from "./experimentProtocol.js";
import { HolographicSwarmKernel } from "./holographicSwarmKernel.js";
import {
  recordOrganismLearningGate,
  validateOrganismLearningCandidate
} from "./swarmOrganismLearningCycle.js";

export const ORGANISM_ARTIFACT_REPLAY_SCHEMA = "amos.swarm-organism-artifact-replay";
export const ORGANISM_ARTIFACT_REPLAY_VERSION = 1;

/**
 * Replay the learned credit-assignment policy through host-owned invariants.
 *
 * This gate deliberately makes no model calls and creates no quality evidence.
 * It proves only that the policy can be consumed by the real kernel without
 * turning partial progress into completion or bypassing verifier evidence.
 */
export function replayOrganismPolicyArtifacts({ candidate: candidateInput, episodes }) {
  const candidate = validateOrganismLearningCandidate(candidateInput);
  if (candidate.nextGate !== "immutable-artifact-replay") {
    throw new Error(`Candidate ${candidate.id} is not awaiting artifact replay`);
  }
  if (!Array.isArray(episodes) || episodes.length === 0) {
    throw new Error("Artifact replay requires immutable learning episodes");
  }

  const replays = episodes.map((episode, index) => replayEpisodeContract({
    candidate,
    episode,
    index
  }));
  const feedbackSignals = [...new Set(replays.flatMap(({ failures }) => failures))];
  const passed = feedbackSignals.length === 0;
  const metrics = {
    replayCount: replays.length,
    invariantPassRate: mean(replays.map(({ passed: replayPassed }) => Number(replayPassed))),
    challengerRate: mean(replays.map(({ challengerSelected }) => Number(challengerSelected))),
    verifiedCompletionRate: mean(replays.map(({ verifiedCompletion }) => Number(verifiedCompletion))),
    modelCalls: 0,
    createsQualityEvidence: false
  };
  const receiptBase = {
    schema: ORGANISM_ARTIFACT_REPLAY_SCHEMA,
    version: ORGANISM_ARTIFACT_REPLAY_VERSION,
    candidateId: candidate.id,
    candidateDigest: candidate.digest,
    policyDigest: digestResearchValue(candidate.policy),
    evaluator: "artifact-replay-verifier",
    status: passed ? "passed" : "failed",
    episodeDigests: replays.map(({ episodeDigest }) => episodeDigest),
    metrics,
    feedbackSignals,
    replays,
    interpretation: {
      hostContractEvidence: true,
      modelQualityEvidence: false,
      promotionEvidence: false,
      nextRequiredGate: passed ? "real-qwen-phase-probes" : null
    }
  };
  const receipt = { ...receiptBase, digest: digestResearchValue(receiptBase) };
  const updatedCandidate = recordOrganismLearningGate(candidate, {
    id: "immutable-artifact-replay",
    status: receipt.status,
    evaluator: receipt.evaluator,
    receiptDigest: receipt.digest,
    metrics,
    feedbackSignals
  });
  return { receipt, candidate: updatedCandidate };
}

function replayEpisodeContract({ candidate, episode, index }) {
  const episodeDigest = requiredDigest(episode?.digest, `episodes[${index}].digest`);
  const missionId = `replay-${candidate.id}-${String(index + 1).padStart(3, "0")}`;
  const kernel = new HolographicSwarmKernel({
    missionId,
    policy: candidate.policy
  });
  const taskName = String(episode?.task?.name || "governed-work").trim() || "governed-work";
  for (const agentId of ["agent-a", "agent-b"]) {
    kernel.registerAgent({
      id: agentId,
      skills: [taskName, "artifact recovery", "verified completion"]
    });
  }
  kernel.addTask({
    id: "replayed-task",
    objective: `Recover and verify the immutable ${taskName} artifact.`,
    tags: ["artifact-recovery", "verified-completion"],
    reward: 4
  });

  const [first] = kernel.selfOrganize({ cycle: 0, maximumAssignments: 1 });
  const partial = kernel.recordPartialProgress({
    cycle: 1,
    taskId: first.taskId,
    agentId: first.agentId,
    confidence: 0.5,
    resultRefs: [`artifact:${episodeDigest}`]
  });
  const afterPartial = kernel.snapshot({ cycle: 1 });
  const [second] = kernel.selfOrganize({ cycle: 2, maximumAssignments: 1 });
  const completed = kernel.recordVerifiedOutcome({
    cycle: 3,
    taskId: second.taskId,
    agentId: second.agentId,
    verifierScore: 1,
    resultRefs: [`receipt:${episodeDigest}`],
    learnedSkills: [taskName]
  });
  const final = kernel.snapshot({ cycle: 3 });

  const partialTask = afterPartial.taskGraph.tasks.find(({ id }) => id === first.taskId);
  const finalTask = final.taskGraph.tasks.find(({ id }) => id === first.taskId);
  const checks = {
    policyConsumedExactly: digestResearchValue(final.policy) === digestResearchValue(candidate.policy),
    partialProgressDidNotComplete: partial.status === "progressed" && partialTask?.status === "open",
    challengerSelected: second.agentId !== first.agentId,
    verifierRequiredForCompletion: completed.status === "completed" && finalTask?.status === "completed",
    immutableEpisodeReferenced: finalTask?.resultRefs.includes(`receipt:${episodeDigest}`) === true
  };
  const failures = Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([name]) => replayFailureSignal(name));
  return {
    episodeDigest,
    passed: failures.length === 0,
    firstAgentId: first.agentId,
    secondAgentId: second.agentId,
    challengerSelected: checks.challengerSelected,
    verifiedCompletion: checks.verifierRequiredForCompletion,
    checks,
    failures,
    kernelDigest: final.digest
  };
}

function replayFailureSignal(name) {
  const signals = {
    policyConsumedExactly: "policy-digest-drift",
    partialProgressDidNotComplete: "partial-progress-counted-as-success",
    challengerSelected: "repeated-agent-loop",
    verifierRequiredForCompletion: "unverified-completion",
    immutableEpisodeReferenced: "missing-artifact-lineage"
  };
  return signals[name] || `artifact-replay:${name}`;
}

function requiredDigest(value, label) {
  const digest = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} must be a SHA-256 digest`);
  return digest;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
