import { digestResearchValue } from "./experimentProtocol.js";
import { verifyAmosOwnedMissionAnswer } from "./amosOwnedMissionArena.js";
import {
  HolographicMemory,
  HolographicSwarmKernel,
  HolographicWorldModel
} from "./holographicSwarmKernel.js";
import {
  DEFAULT_ORGANISM_POLICY,
  normalizeOrganismPolicy
} from "./swarmOrganismSimulator.js";
import { runResearchInference } from "./modelScaffold.js";

export const ORGANISM_QWEN_PHASE_PROBE_SCHEMA = "amos.swarm-organism-qwen-phase-probe";
export const ORGANISM_QWEN_PHASE_PROBE_VERSION = 1;

const AGENTS = Object.freeze([
  {
    id: "recovery-analyst",
    skills: ["authority analysis", "state recovery", "evidence reconciliation"]
  },
  {
    id: "systems-builder",
    skills: ["typed tool recovery", "workflow construction", "idempotent execution"]
  },
  {
    id: "skeptical-operator",
    skills: ["approval boundaries", "receipt verification", "failure analysis"]
  }
]);

export async function runOrganismQwenPhaseProbe({
  worker,
  missions,
  verifiers,
  candidatePolicy,
  candidateId = "candidate",
  maxOutputTokens = 800,
  now = () => new Date()
}) {
  if (!worker || typeof worker.runCase !== "function") {
    throw new Error("Real-Qwen phase probes require a research worker");
  }
  if (!Array.isArray(missions) || missions.length === 0) {
    throw new Error("Real-Qwen phase probes require missions");
  }
  if (!Array.isArray(verifiers) || verifiers.length !== missions.length) {
    throw new Error("Real-Qwen phase probes require one verifier per mission");
  }
  const verifierByMission = new Map(verifiers.map((verifier) => [verifier.missionId, verifier]));
  const regimes = [
    { id: "baseline", policy: normalizeOrganismPolicy(DEFAULT_ORGANISM_POLICY) },
    { id: candidateId, policy: normalizeOrganismPolicy(candidatePolicy) }
  ];
  const runs = [];
  for (const regime of regimes) {
    for (const mission of missions) {
      const verifier = verifierByMission.get(mission.id);
      if (!verifier) throw new Error(`Missing verifier for mission ${mission.id}`);
      runs.push(await runMissionPhase({
        worker,
        mission,
        verifier,
        regime,
        maxOutputTokens
      }));
    }
  }
  const baseline = summarizeRuns(runs.filter(({ regimeId }) => regimeId === "baseline"));
  const candidate = summarizeRuns(runs.filter(({ regimeId }) => regimeId === candidateId));
  const report = {
    schema: ORGANISM_QWEN_PHASE_PROBE_SCHEMA,
    version: ORGANISM_QWEN_PHASE_PROBE_VERSION,
    generatedAt: now().toISOString(),
    candidateId,
    candidatePolicy: normalizeOrganismPolicy(candidatePolicy),
    candidatePolicyDigest: digestResearchValue(normalizeOrganismPolicy(candidatePolicy)),
    protocol: {
      paired: true,
      missionCount: missions.length,
      maximumAttemptsPerMission: 2,
      maximumModelRequestsPerMission: 4,
      maxOutputTokensPerAttempt: maxOutputTokens,
      answerReserveTokensPerAttempt: answerReserveTokens(maxOutputTokens),
      verifier: "candidate-independent-amos-owned-concept-verifier",
      worldMemory: "host-maintained-read-only-deterministic-hrr-v1",
      matchedBudgets: true
    },
    baseline,
    candidate,
    lift: {
      passRate: candidate.passRate - baseline.passRate,
      meanPassedCriterionRate:
        candidate.meanPassedCriterionRate - baseline.meanPassedCriterionRate,
      recoveryRate: candidate.recoveryRate - baseline.recoveryRate,
      challengerRetryRate: candidate.challengerRetryRate - baseline.challengerRetryRate,
      meanCalls: candidate.meanCalls - baseline.meanCalls
    },
    gate: {
      id: "real-qwen-phase-probes",
      evaluator: "qwen-execution-verifier",
      passed: candidate.passRate >= 0.75 &&
        candidate.passRate >= baseline.passRate &&
        candidate.receiptGatedCredit === true &&
        candidate.exactPolicyConsumed === true,
      automaticallyPromotes: false
    },
    runs,
    interpretation: {
      developmentVisible: true,
      realQwenExecution: true,
      frontierQualityEvidence: false,
      sealedHoldoutEvidence: false
    }
  };
  return { ...report, digest: digestResearchValue(report) };
}

async function runMissionPhase({ worker, mission, verifier, regime, maxOutputTokens }) {
  const memory = new HolographicMemory({
    dimension: 256,
    namespace: `amos-phase-probe-${mission.id}`
  });
  const worldEntries = missionWorldEntries(mission);
  const world = new HolographicWorldModel({
    memory,
    entries: worldEntries,
    boardDigest: digestResearchValue({ mission, verifier })
  });
  const kernel = new HolographicSwarmKernel({
    missionId: `${regime.id}-${mission.id}`,
    memory,
    policy: regime.policy,
    initialEnergy: 10,
    claimCost: regime.policy["energy.claimCost"]
  });
  for (const agent of AGENTS) kernel.registerAgent(agent);
  kernel.addTask({
    id: "phase",
    objective: mission.objective,
    requirements: mission.successCriteria,
    tags: ["governed-recovery", "evidence-reconciliation"],
    reward: 1
  });

  const attempts = [];
  let previous = null;
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const [assignment] = kernel.selfOrganize({ cycle, maximumAssignments: 1 });
    if (!assignment) break;
    const projection = world.project(mission.objective, { limit: worldEntries.length });
    const observation = await runResearchInference({
      worker,
      caseId: `${regime.id}-${mission.id}-attempt-${cycle + 1}`,
      messages: phaseMessages({
        mission,
        agentId: assignment.agentId,
        projection,
        previous
      }),
      dataManifestDigest: digestResearchValue({ mission, verifier }),
      repetition: 1,
      maxOutputTokens,
      answerReserveTokens: answerReserveTokens(maxOutputTokens),
      promptSessionId: `organism-phase-${regime.id}-${mission.id}`
    });
    const answer = visibleAnswer(observation.message);
    const receipt = verifyAmosOwnedMissionAnswer({ mission, verifier, answer });
    const receiptRef = `verifier:${receipt.digest}`;
    attempts.push({
      cycle,
      agentId: assignment.agentId,
      answer,
      observation,
      verifierReceipt: receipt,
      worldMemoryDigest: world.snapshot().digest
    });
    if (receipt.passed) {
      kernel.recordVerifiedOutcome({
        cycle: cycle + 1,
        taskId: "phase",
        agentId: assignment.agentId,
        verifierScore: 1,
        resultRefs: [receiptRef],
        learnedSkills: [verifier.family]
      });
      break;
    }
    const confidence = receipt.passedCriteria / Math.max(1, receipt.criterionCount);
    if (cycle === 0 && confidence > 0) {
      kernel.recordPartialProgress({
        cycle: cycle + 1,
        taskId: "phase",
        agentId: assignment.agentId,
        confidence,
        resultRefs: [receiptRef]
      });
      previous = {
        answer,
        failedCriterionIds: receipt.failedCriterionIds,
        receiptDigest: receipt.digest
      };
      continue;
    }
    kernel.recordFailedOutcome({
      cycle: cycle + 1,
      taskId: "phase",
      agentId: assignment.agentId,
      resultRefs: [receiptRef]
    });
    break;
  }
  const finalReceipt = attempts.at(-1)?.verifierReceipt;
  const firstReceipt = attempts[0]?.verifierReceipt;
  const snapshot = kernel.snapshot({ cycle: attempts.length });
  const verifiedReceiptRefs = new Set(
    attempts.map(({ verifierReceipt }) => `verifier:${verifierReceipt.digest}`)
  );
  return {
    regimeId: regime.id,
    missionId: mission.id,
    policyDigest: digestResearchValue(regime.policy),
    passed: finalReceipt?.passed === true,
    passedCriterionRate:
      (finalReceipt?.passedCriteria || 0) / Math.max(1, finalReceipt?.criterionCount || 0),
    recovered: firstReceipt?.passed === false && finalReceipt?.passed === true,
    calls: attempts.length,
    challengerRetry: attempts.length > 1 && attempts[0].agentId !== attempts[1].agentId,
    attempts,
    ecology: snapshot,
    receiptGatedCredit: snapshot.outcomes
      .filter(({ status }) => status === "progressed")
      .every(({ resultRefs }) =>
        resultRefs.length > 0 && resultRefs.every((ref) => verifiedReceiptRefs.has(ref))
      ),
    worldSnapshot: world.snapshot()
  };
}

function phaseMessages({ mission, agentId, projection, previous }) {
  return [{
    role: "system",
    content:
      `You are logical specialist ${agentId} in a governed organism. ` +
      "Answer the bounded phase completely and concisely. The shared holographic projection " +
      "is a lossy read-only index; verify against the exact mission text. Do not discuss the scaffold."
  }, {
    role: "user",
    content: [
      `Objective: ${mission.objective}`,
      `Exact context: ${mission.context}`,
      `Success criteria:\n- ${mission.successCriteria.join("\n- ")}`,
      `Shared world projection:\n${JSON.stringify(projection)}`,
      previous
        ? `Prior attempt did not satisfy criteria ${previous.failedCriterionIds.join(", ")}. ` +
          `Its host verifier receipt is ${previous.receiptDigest}. Preserve correct content and repair ` +
          `only those gaps. Prior answer:\n${previous.answer}`
        : "This is the first attempt."
    ].join("\n\n")
  }];
}

function missionWorldEntries(mission) {
  return [
    {
      id: `${mission.id}-objective`,
      kind: "objective",
      text: mission.objective,
      evidenceRefs: [mission.id],
      verifiedBy: "amos-host-owned-fixture"
    },
    {
      id: `${mission.id}-context`,
      kind: "fact",
      text: mission.context,
      evidenceRefs: [mission.id],
      verifiedBy: "amos-host-owned-fixture"
    },
    ...mission.successCriteria.map((text, index) => ({
      id: `${mission.id}-criterion-${index + 1}`,
      kind: "criterion",
      text,
      evidenceRefs: [mission.id],
      verifiedBy: "amos-host-owned-fixture"
    }))
  ];
}

function summarizeRuns(runs) {
  const retries = runs.filter(({ calls }) => calls > 1);
  const partialRewards = runs.flatMap(({ ecology }) => ecology.energyEvents)
    .filter(({ reason }) => reason === "partial-progress-reward");
  return {
    missionCount: runs.length,
    passed: runs.filter(({ passed }) => passed).length,
    passRate: mean(runs.map(({ passed }) => Number(passed))),
    meanPassedCriterionRate: mean(runs.map(({ passedCriterionRate }) => passedCriterionRate)),
    recoveryRate: retries.length > 0
      ? mean(retries.map(({ recovered }) => Number(recovered)))
      : 0,
    challengerRetryRate: retries.length > 0
      ? mean(retries.map(({ challengerRetry }) => Number(challengerRetry)))
      : 0,
    meanCalls: mean(runs.map(({ calls }) => calls)),
    receiptGatedCredit: runs.every(({ receiptGatedCredit }) => receiptGatedCredit),
    partialRewardCount: partialRewards.length,
    exactPolicyConsumed: runs.every(({ policyDigest, ecology }) =>
      policyDigest === digestResearchValue(ecology.policy)
    )
  };
}

function visibleAnswer(message) {
  const content = message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map(({ text }) => text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  const shape = message && typeof message === "object"
    ? Object.fromEntries(Object.entries(message).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? `array(${value.length})`
          : typeof value === "string"
            ? `string(${value.length})`
            : typeof value
      ]))
    : { message: typeof message };
  throw new Error(
    `Real-Qwen phase probe returned no visible answer after bounded recovery; shape=${JSON.stringify(shape)}`
  );
}

function answerReserveTokens(maxOutputTokens) {
  return Math.max(64, Math.min(512, Math.floor(maxOutputTokens / 3)));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
