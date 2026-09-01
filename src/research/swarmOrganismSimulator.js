import { digestResearchValue } from "./experimentProtocol.js";

export const ORGANISM_TRANSITION_MODEL_SCHEMA = "amos.swarm-organism-transition-model";
export const ORGANISM_SIMULATION_SCHEMA = "amos.swarm-organism-simulation";
export const ORGANISM_POLICY_SEARCH_SCHEMA = "amos.swarm-organism-policy-search";
export const ORGANISM_CALIBRATION_VALIDATION_SCHEMA = "amos.swarm-organism-calibration-validation";
export const ORGANISM_SIMULATOR_VERSION = 1;

const DEFAULT_ROLES = [
  "interface-scanner",
  "data-scanner",
  "state-compiler",
  "solver-builder",
  "skeptic-verifier",
  "governed-operator",
  "evidence-synthesist"
];

export const DEFAULT_ORGANISM_POLICY = Object.freeze({
  "bid.affinityWeight": 1,
  "bid.pheromoneWeight": 1,
  "bid.reputationWeight": 1,
  "bid.energyWeight": 1,
  "bid.repetitionPenalty": 0.5,
  "pheromone.successIntensity": 0.9,
  "pheromone.partialProgressIntensity": 0.35,
  "pheromone.failureIntensity": 0.8,
  "pheromone.successDecay": 0.03,
  "pheromone.failureDecay": 0.12,
  "energy.claimCost": 1,
  "energy.partialProgressReward": 0.1,
  "energy.verifiedReward": 1,
  "energy.failurePenalty": 0.75,
  "energy.repeatFailurePenalty": 1.5,
  "energy.stallPenalty": 1,
  "energy.regressionPenalty": 1.25,
  "energy.efficiencyBonus": 1,
  "retry.challengerExploration": 0.2,
  "phase.retryLimit": 1,
  "phase.artifactHorizon": 8,
  "memory.compactionThreshold": 12_000,
  "time.targetLeaseUtilization": 0.6,
  "stopping.minimumConfidence": 0.8
});

export const ORGANISM_POLICY_BOUNDS = Object.freeze({
  "bid.affinityWeight": [0.1, 3],
  "bid.pheromoneWeight": [0, 3],
  "bid.reputationWeight": [0, 3],
  "bid.energyWeight": [0, 3],
  "bid.repetitionPenalty": [0, 4],
  "pheromone.successIntensity": [0.1, 1],
  "pheromone.partialProgressIntensity": [0, 1],
  "pheromone.failureIntensity": [0.1, 1],
  "pheromone.successDecay": [0.001, 0.5],
  "pheromone.failureDecay": [0.001, 0.8],
  "energy.claimCost": [0.1, 4],
  "energy.partialProgressReward": [0, 1],
  "energy.verifiedReward": [0.1, 5],
  "energy.failurePenalty": [0, 4],
  "energy.repeatFailurePenalty": [0, 6],
  "energy.stallPenalty": [0, 4],
  "energy.regressionPenalty": [0, 5],
  "energy.efficiencyBonus": [0, 3],
  "retry.challengerExploration": [0, 1],
  "phase.retryLimit": [0, 4],
  "phase.artifactHorizon": [2, 24],
  "memory.compactionThreshold": [2_000, 64_000],
  "time.targetLeaseUtilization": [0.1, 0.95],
  "stopping.minimumConfidence": [0.5, 0.99]
});

/**
 * Fit a cheap transition model from immutable execution/ecology records.
 *
 * The model predicts research rollouts. It never creates verifier evidence and
 * cannot promote a policy. Public benchmark traces may participate in policy
 * learning only when a caller supplies an explicit organism-policy eligibility
 * decision derived from rights and contamination controls.
 */
export function calibrateOrganismTransitionModel({ records, roles = DEFAULT_ROLES } = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Organism calibration requires at least one execution record");
  }
  const roleNames = uniqueTexts(roles, "roles");
  const observations = new Map(roleNames.map((role) => [role, emptyRoleObservation(role)]));
  const failureModes = new Map();
  const sourceClasses = new Set();
  let totalDurationSeconds = 0;
  let totalAssignments = 0;
  let recoveredFailures = 0;
  let retryOpportunities = 0;
  const holographicSnapshots = [];
  const worldMemoryDigests = new Set();

  for (const [index, raw] of records.entries()) {
    const record = objectValue(raw, `records[${index}]`);
    const episode = objectValue(record.episode, `records[${index}].episode`);
    const ecology = objectValue(record.ecology, `records[${index}].ecology`);
    const assignments = Array.isArray(ecology.assignments) ? ecology.assignments : [];
    const roleAttempts = new Map();
    sourceClasses.add(String(episode.dataPolicy?.sourceClass || "unknown"));
    totalDurationSeconds += durationSeconds(episode.execution);
    totalAssignments += assignments.length;
    for (const digest of ecology.worldMemoryDigests || []) {
      if (/^[a-f0-9]{64}$/.test(String(digest))) worldMemoryDigests.add(String(digest));
    }
    const holographicWorld = ecology.dualChannelWorld ?? ecology.dualChannelShadow;
    for (const snapshot of holographicWorld?.snapshots || []) {
      if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
        holographicSnapshots.push({
          ...snapshot,
          mode: holographicWorld?.mode,
          behaviorInfluence: holographicWorld?.behaviorInfluence === true
        });
      }
    }

    for (const assignment of assignments) {
      const role = normalizeRole(assignment.role || assignment.taskId || assignment.label);
      if (!observations.has(role)) observations.set(role, emptyRoleObservation(role));
      const observed = observations.get(role);
      const completed = assignment.status === "completed";
      const progressed = assignment.status === "progressed";
      observed.attempts += 1;
      observed.successes += completed ? 1 : 0;
      observed.progressed += progressed ? 1 : 0;
      observed.failures += completed ? 0 : 1;
      observed.affinitySum += finiteNumber(assignment.bid?.affinity, 0.5);
      observed.affinityCount += 1;
      observed.agents.add(String(assignment.agentId || "unknown"));
      const previous = roleAttempts.get(role) || { failed: false };
      if (previous.failed) {
        retryOpportunities += 1;
        if (completed) recoveredFailures += 1;
      }
      roleAttempts.set(role, { failed: previous.failed || !completed });
    }

    const terminalRole = assignments.length > 0
      ? normalizeRole(assignments.at(-1).role || assignments.at(-1).taskId)
      : "unassigned";
    const mode = classifyFailureMode(episode.execution?.exception, episode.curriculumSignals);
    if (mode !== null) {
      const key = `${terminalRole}:${mode}`;
      failureModes.set(key, (failureModes.get(key) || 0) + 1);
      if (!observations.has(terminalRole)) observations.set(terminalRole, emptyRoleObservation(terminalRole));
      observations.get(terminalRole).failureModes.set(
        mode,
        (observations.get(terminalRole).failureModes.get(mode) || 0) + 1
      );
    }
  }

  const meanAssignmentSeconds = totalDurationSeconds / Math.max(1, totalAssignments);
  const retryRecoveryProbability = betaMean(recoveredFailures, retryOpportunities - recoveredFailures);
  const roleProfiles = {};
  for (const [role, observed] of observations) {
    const modeTotal = [...observed.failureModes.values()].reduce((sum, value) => sum + value, 0);
    roleProfiles[role] = {
      attempts: observed.attempts,
      completed: observed.successes,
      progressed: observed.progressed,
      incomplete: observed.failures,
      successProbability: betaMean(observed.successes, observed.failures),
      partialProgressProbability: betaMean(
        observed.progressed,
        Math.max(0, observed.failures - observed.progressed)
      ),
      meanAffinity: observed.affinitySum / Math.max(1, observed.affinityCount),
      meanDurationSeconds: meanAssignmentSeconds,
      retryRecoveryProbability,
      failureModeProbability: Object.fromEntries(
        [...observed.failureModes.entries()].map(([mode, count]) => [
          mode,
          (count + 0.5) / Math.max(1, modeTotal + (0.5 * Math.max(1, observed.failureModes.size)))
        ])
      ),
      observedAgentIds: [...observed.agents].sort()
    };
  }

  const eligibleRecords = records.filter((record) =>
    record.organismPolicyTrainingEligibility?.eligible ??
      record.episode?.trainingEligibility?.eligible === true
  );
  const trainingEligibleRecords = eligibleRecords.length;
  const evaluationExclusions = [...new Set(eligibleRecords.flatMap(({ episode }) =>
    (episode.dataPolicy?.contaminationTags || [])
      .filter((tag) => String(tag).startsWith("exclude-eval:"))
  ))].sort();
  const calibration = {
    schema: ORGANISM_TRANSITION_MODEL_SCHEMA,
    version: ORGANISM_SIMULATOR_VERSION,
    frozenSubstrate: true,
    recordCount: records.length,
    assignmentCount: totalAssignments,
    sourceClasses: [...sourceClasses].sort(),
    roleProfiles,
    failureModes: Object.fromEntries([...failureModes.entries()].sort()),
    retryRecoveryProbability,
    meanAssignmentSeconds,
    holographicWorld: summarizeHolographicWorld({
      snapshots: holographicSnapshots,
      worldMemoryDigests: [...worldMemoryDigests]
    }),
    coverage: {
      observedRoles: Object.values(roleProfiles).filter(({ attempts }) => attempts > 0).length,
      totalRoles: Object.keys(roleProfiles).length,
      unobservedRoles: Object.entries(roleProfiles)
        .filter(([, { attempts }]) => attempts === 0)
        .map(([role]) => role)
    },
    usePolicy: {
      researchCalibrationAllowed: true,
      trainingEligibleRecords,
      researchOnly: trainingEligibleRecords !== records.length,
      evaluationExclusions,
      productionPromotionEligible: false,
      reason: trainingEligibleRecords === records.length
        ? "Simulation is predictive evidence only; real execution and verification are still required."
        : "At least one calibration trace is not approved for training."
    }
  };
  return { ...calibration, digest: digestResearchValue(calibration) };
}

/** Leave-one-execution-out validation of the cheap role transition model. */
export function crossValidateOrganismTransitionModel({ records, roles = DEFAULT_ROLES } = {}) {
  if (!Array.isArray(records) || records.length < 2) {
    throw new Error("Organism cross-validation requires at least two execution records");
  }
  const predictions = [];
  for (let holdoutIndex = 0; holdoutIndex < records.length; holdoutIndex += 1) {
    const trainingRecords = records.filter((_, index) => index !== holdoutIndex);
    const holdout = records[holdoutIndex];
    const model = calibrateOrganismTransitionModel({ records: trainingRecords, roles });
    for (const assignment of holdout.ecology?.assignments || []) {
      const role = normalizeRole(assignment.role || assignment.taskId || assignment.label);
      const profile = model.roleProfiles[role] || unseenRoleProfile(model);
      const observed = Number(assignment.status === "completed");
      predictions.push({
        holdoutEpisodeId: String(holdout.episode?.id || `record-${holdoutIndex + 1}`),
        role,
        predictedProbability: profile.successProbability,
        observed,
        evidenceAttempts: profile.attempts
      });
    }
  }
  if (predictions.length === 0) throw new Error("No ecology assignments are available for validation");
  const brierScore = mean(predictions.map(({ predictedProbability, observed }) =>
    (predictedProbability - observed) ** 2
  ));
  const logLoss = -mean(predictions.map(({ predictedProbability, observed }) => {
    const probability = clamp(predictedProbability, 0.001, 0.999);
    return (observed * Math.log(probability)) + ((1 - observed) * Math.log(1 - probability));
  }));
  const validation = {
    schema: ORGANISM_CALIBRATION_VALIDATION_SCHEMA,
    version: ORGANISM_SIMULATOR_VERSION,
    method: "leave-one-execution-out",
    recordCount: records.length,
    predictionCount: predictions.length,
    brierScore,
    logLoss,
    accuracyAtHalf: mean(predictions.map(({ predictedProbability, observed }) =>
      Number(Number(predictedProbability >= 0.5) === observed)
    )),
    meanEvidenceAttempts: mean(predictions.map(({ evidenceAttempts }) => evidenceAttempts)),
    predictions,
    interpretation: {
      lowerBrierAndLogLossAreBetter: true,
      verifierEvidence: false,
      promotionEligible: false
    }
  };
  return { ...validation, digest: digestResearchValue(validation) };
}

/** Run a deterministic, model-free ecology rollout. */
export function simulateOrganismMission({
  model,
  scenario = defaultOrganismScenario(),
  policy = DEFAULT_ORGANISM_POLICY,
  seed = 1
} = {}) {
  validateTransitionModel(model);
  const normalizedPolicy = normalizeOrganismPolicy(policy);
  const normalizedScenario = normalizeScenario(scenario);
  const random = seededRandom(seed);
  const agents = initializeAgents(normalizedScenario);
  const trails = new Map();
  const events = [];
  const phases = [];
  let modelCalls = 0;
  let wallTimeSeconds = 0;
  let recoveryAttempts = 0;
  let recoveredFailures = 0;
  let partialProgressAttempts = 0;
  let artifactContractsMet = 0;
  let missionFailed = false;

  for (const phase of normalizedScenario.phases) {
    const profile = model.roleProfiles[phase.role] || unseenRoleProfile(model);
    const maximumAttempts = 1 + Math.round(normalizedPolicy["phase.retryLimit"]);
    let phaseCompleted = false;
    let lastFailure = null;
    const attempts = [];

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      if (attempt > 0) recoveryAttempts += 1;
      const selection = selectAgent({
        agents,
        phase,
        profile,
        trails,
        policy: normalizedPolicy,
        cycle: events.length,
        attempts,
        random
      });
      const selected = selection.agent;
      selected.energy = Math.max(0, selected.energy - normalizedPolicy["energy.claimCost"]);
      const transition = sampleTransition({
        random,
        phase,
        profile,
        agent: selected,
        policy: normalizedPolicy,
        retry: attempt > 0,
        lastFailure
      });
      const leaseUtilization = sampleLeaseUtilization(random, transition.outcome);
      const efficiency = efficiencyTerms(leaseUtilization, normalizedPolicy);
      modelCalls += 1;
      wallTimeSeconds += sampleDuration(random, profile.meanDurationSeconds, attempt);
      attempts.push({
        attempt: attempt + 1,
        agentId: selected.id,
        outcome: transition.outcome,
        confidence: transition.confidence,
        artifactContractMet: transition.artifactContractMet,
        repeatedAgent: selection.repetitionCount > 0,
        repetitionCount: selection.repetitionCount,
        challengerSelected: selection.challengerSelected,
        leaseUtilization,
        efficiencyBonus: efficiency.bonus,
        stallPenalty: efficiency.stallPenalty
      });
      events.push({ phaseId: phase.id, role: phase.role, ...attempts.at(-1) });

      if (transition.outcome === "completed") {
        phaseCompleted = true;
        artifactContractsMet += transition.artifactContractMet ? 1 : 0;
        if (attempt > 0) recoveredFailures += 1;
        selected.energy += normalizedPolicy["energy.verifiedReward"] * (1 + efficiency.bonus);
        selected.reputation = clamp(selected.reputation + (0.08 * transition.confidence), 0, 1);
        depositTrail(trails, phase.role, {
          polarity: 1,
          intensity: normalizedPolicy["pheromone.successIntensity"],
          decay: normalizedPolicy["pheromone.successDecay"],
          cycle: events.length,
          sourceAgentId: selected.id
        });
        break;
      }

      if (transition.outcome === "progressed") {
        partialProgressAttempts += 1;
        selected.energy += normalizedPolicy["energy.partialProgressReward"] *
          (1 + (efficiency.bonus * 0.5));
        selected.reputation = clamp(
          selected.reputation + (0.02 * normalizedPolicy["energy.partialProgressReward"]),
          0,
          1
        );
        depositTrail(trails, phase.role, {
          polarity: 1,
          intensity: normalizedPolicy["pheromone.partialProgressIntensity"],
          decay: normalizedPolicy["pheromone.successDecay"],
          cycle: events.length,
          sourceAgentId: selected.id
        });
        lastFailure = transition.outcome;
        continue;
      }
      const regressionPenalty = lastFailure === "progressed"
        ? normalizedPolicy["energy.regressionPenalty"]
        : 0;
      const repeatFailurePenalty = selection.repetitionCount > 0
        ? normalizedPolicy["energy.repeatFailurePenalty"]
        : 0;
      selected.energy = Math.max(
        0,
        selected.energy - normalizedPolicy["energy.failurePenalty"] -
          efficiency.stallPenalty - regressionPenalty - repeatFailurePenalty
      );
      attempts.at(-1).repeatFailurePenalty = repeatFailurePenalty;
      selected.reputation = clamp(selected.reputation - 0.08, 0, 1);
      lastFailure = transition.outcome;
      depositTrail(trails, phase.role, {
        polarity: -1,
        intensity: normalizedPolicy["pheromone.failureIntensity"],
        decay: normalizedPolicy["pheromone.failureDecay"],
        cycle: events.length,
        sourceAgentId: selected.id
      });
    }

    phases.push({
      id: phase.id,
      role: phase.role,
      completed: phaseCompleted,
      attempts
    });
    if (!phaseCompleted) {
      missionFailed = true;
      break;
    }
  }

  const phaseCompletionRate = phases.filter(({ completed }) => completed).length /
    normalizedScenario.phases.length;
  const artifactCompliance = artifactContractsMet / Math.max(1, phases.filter(({ completed }) => completed).length);
  const confidence = phaseCompletionRate * artifactCompliance;
  const simulatedPass = !missionFailed && confidence >= normalizedPolicy["stopping.minimumConfidence"];
  const result = {
    schema: ORGANISM_SIMULATION_SCHEMA,
    version: ORGANISM_SIMULATOR_VERSION,
    modelDigest: model.digest,
    scenarioId: normalizedScenario.id,
    seed: integerSeed(seed),
    frozenSubstrate: true,
    simulated: true,
    verifierEvidence: null,
    promotionEligible: false,
    policy: normalizedPolicy,
    holographicWorld: {
      ...model.holographicWorld,
      influencesSimulation: false,
      authorityEnabled: false
    },
    outcome: {
      simulatedPass,
      phaseCompletionRate,
      artifactCompliance,
      confidence,
      recoveryRate: recoveredFailures / Math.max(1, recoveryAttempts),
      recoveredFailures,
      recoveryAttempts,
      partialProgressAttempts,
      modelCalls,
      wallTimeSeconds
    },
    phases,
    finalAgents: agents.map(({ id, energy, reputation }) => ({ id, energy, reputation })),
    events
  };
  return { ...result, digest: digestResearchValue(result) };
}

/**
 * Constrained cross-entropy search over interpretable ecological parameters.
 * Results are candidates for real-Qwen qualification, never deployment claims.
 */
export function searchOrganismPolicies({
  model,
  scenarios = [defaultOrganismScenario()],
  baselinePolicy = DEFAULT_ORGANISM_POLICY,
  parameterNames = Object.keys(ORGANISM_POLICY_BOUNDS),
  candidates = 64,
  elites = 8,
  generations = 4,
  seeds = [11, 29, 47],
  seed = 7
} = {}) {
  validateTransitionModel(model);
  if (model.usePolicy.researchOnly) {
    throw new Error(
      "Organism policy search requires exclusively training-eligible calibration records"
    );
  }
  const populationSize = boundedInteger(candidates, 2, 100_000, "candidates");
  const eliteCount = boundedInteger(elites, 1, populationSize - 1, "elites");
  const generationCount = boundedInteger(generations, 1, 1_000, "generations");
  const normalizedScenarios = scenarios.map(normalizeScenario);
  const normalizedSeeds = uniqueIntegers(seeds, "seeds");
  const random = seededRandom(seed);
  const keys = normalizePolicyParameterNames(parameterNames);
  const baseline = normalizeOrganismPolicy(baselinePolicy);
  const means = structuredClone(baseline);
  const deviations = Object.fromEntries(keys.map((key) => {
    const [minimum, maximum] = ORGANISM_POLICY_BOUNDS[key];
    return [key, Math.max((maximum - minimum) / 4, 0.0001)];
  }));
  const history = [];
  let finalRanked = [];

  for (let generation = 0; generation < generationCount; generation += 1) {
    const policies = generation === 0
      ? [structuredClone(baseline)]
      : [];
    while (policies.length < populationSize) {
      policies.push(samplePolicy({
        random,
        means,
        deviations,
        parameterNames: keys,
        baselinePolicy: baseline
      }));
    }
    const ranked = policies.map((candidatePolicy) => evaluateOrganismPolicy({
      model,
      scenarios: normalizedScenarios,
      policy: candidatePolicy,
      seeds: normalizedSeeds,
      seed
    })).sort(compareCandidates);
    finalRanked = ranked;
    const selected = ranked.slice(0, eliteCount);
    for (const key of keys) {
      const values = selected.map(({ policy: selectedPolicy }) => selectedPolicy[key]);
      means[key] = mean(values);
      deviations[key] = Math.max(standardDeviation(values), minimumDeviation(key));
    }
    history.push({
      generation: generation + 1,
      candidateCount: ranked.length,
      best: selected[0],
      distribution: {
        means: structuredClone(means),
        standardDeviations: structuredClone(deviations)
      }
    });
  }

  const search = {
    schema: ORGANISM_POLICY_SEARCH_SCHEMA,
    version: ORGANISM_SIMULATOR_VERSION,
    transitionModelDigest: model.digest,
    frozenSubstrate: true,
    optimizer: "constrained-cross-entropy-method",
    optimizedParameters: keys,
    fixedParameters: Object.keys(ORGANISM_POLICY_BOUNDS).filter((key) => !keys.includes(key)),
    fixedPolicyDigest: digestResearchValue(Object.fromEntries(
      Object.entries(baseline).filter(([key]) => !keys.includes(key))
    )),
    candidates: populationSize,
    elites: eliteCount,
    generations: generationCount,
    scenarioIds: normalizedScenarios.map(({ id }) => id),
    seeds: normalizedSeeds,
    seed: integerSeed(seed),
    history,
    promotionQueue: finalRanked.slice(0, Math.min(3, eliteCount)).map((candidate, index) => ({
      rank: index + 1,
      policy: candidate.policy,
      simulatedMetrics: candidate.metrics,
      requiredNextGate: index === 0 ? "real-qwen-phase-probes" : "artifact-replay-validation",
      automaticallyPromoted: false
    })),
    usePolicy: {
      researchOnly: model.usePolicy.researchOnly,
      createsVerifierEvidence: false,
      automaticallyPromotes: false,
      requiredRealGates: [
        "real-qwen-phase-probes",
        "full-mission-three-seed-replication",
        "independent-verifier",
        "frozen-holdout",
        "canary"
      ]
    }
  };
  return { ...search, digest: digestResearchValue(search) };
}

/** Evaluate one policy with the same common-random-number protocol as search. */
export function evaluateOrganismPolicy({
  model,
  scenarios = [defaultOrganismScenario()],
  policy = DEFAULT_ORGANISM_POLICY,
  seeds = [11, 29, 47],
  seed = 7
} = {}) {
  validateTransitionModel(model);
  const normalizedScenarios = scenarios.map(normalizeScenario);
  const normalizedSeeds = uniqueIntegers(seeds, "seeds");
  const normalizedPolicy = normalizeOrganismPolicy(policy);
  const rollouts = [];
  for (const scenario of normalizedScenarios) {
    for (const rolloutSeed of normalizedSeeds) {
      rollouts.push(simulateOrganismMission({
        model,
        scenario,
        policy: normalizedPolicy,
        // Common random numbers make policy comparisons much less noisy.
        seed: mixSeeds(seed, rolloutSeed, scenario.id)
      }));
    }
  }
  return summarizeCandidate(normalizedPolicy, rollouts);
}

export function defaultOrganismScenario() {
  return {
    id: "governed-build-mission",
    phases: DEFAULT_ROLES.map((role, index) => ({
      id: role,
      role,
      difficulty: 0.45 + (index * 0.04),
      artifactRisk: role === "state-compiler" || role === "solver-builder" ? 0.2 : 0.08,
      contextRisk: role === "state-compiler" || role === "evidence-synthesist" ? 0.14 : 0.04,
      providerRisk: 0.02
    })),
    agents: [
      { id: "scout", specialties: ["interface-scanner", "data-scanner"] },
      { id: "analyst", specialties: ["state-compiler"] },
      { id: "builder", specialties: ["solver-builder"] },
      { id: "skeptic", specialties: ["skeptic-verifier"] },
      { id: "operator", specialties: ["governed-operator"] },
      { id: "synthesist", specialties: ["evidence-synthesist"] }
    ]
  };
}

function summarizeHolographicWorld({ snapshots, worldMemoryDigests }) {
  const exactPositiveRate = mean(snapshots.map(({ exactPositiveRate }) =>
    finiteNumber(exactPositiveRate, 0)
  ));
  const exactFalsePositiveRate = mean(snapshots.map(({ exactFalsePositiveRate }) =>
    finiteNumber(exactFalsePositiveRate, 0)
  ));
  const authorityLeakRate = mean(snapshots.map(({ authorityLeakRate }) =>
    finiteNumber(authorityLeakRate, 0)
  ));
  const behaviorInfluence = snapshots.some(({ mode, behaviorInfluence: influences }) =>
    mode === "bounded-active-retrieval" && influences === true
  );
  return {
    architecture: "dual-channel-hrr",
    mode: behaviorInfluence ? "bounded-active-retrieval" : "read-only-shadow",
    snapshotCount: snapshots.length,
    activeWorldMemoryDigestCount: worldMemoryDigests.length,
    representedEntries: snapshots.reduce(
      (total, { representedEntries }) => total + finiteNumber(representedEntries, 0),
      0
    ),
    exactPositiveRate,
    exactFalsePositiveRate,
    authorityLeakRate,
    authorityEnabled: false,
    behaviorInfluence,
    safetyPassed: snapshots.length > 0 && exactFalsePositiveRate === 0 && authorityLeakRate === 0,
    utilityPromotionEligible: false,
    requiredNextGate: behaviorInfluence
      ? "real-qwen-active-utility-calibration"
      : "development-shadow-utility"
  };
}

function sampleLeaseUtilization(random, outcome) {
  const range = outcome === "completed"
    ? [0.2, 0.85]
    : outcome === "progressed"
      ? [0.4, 0.95]
      : [0.7, 1];
  return range[0] + (random() * (range[1] - range[0]));
}

function efficiencyTerms(utilization, policy) {
  const used = clamp(utilization, 0, 1);
  const target = policy["time.targetLeaseUtilization"];
  const early = Math.max(0, target - used) / Math.max(0.001, target);
  const late = Math.max(0, used - target) / Math.max(0.001, 1 - target);
  return {
    bonus: early * policy["energy.efficiencyBonus"],
    stallPenalty: late * policy["energy.stallPenalty"]
  };
}

function sampleTransition({ random, phase, profile, agent, policy, retry, lastFailure }) {
  const compactionProtection = clamp(
    12_000 / policy["memory.compactionThreshold"],
    0.25,
    2
  );
  const contextRisk = clamp(phase.contextRisk / compactionProtection, 0, 0.95);
  const artifactProtection = clamp(8 / policy["phase.artifactHorizon"], 0.25, 2);
  const artifactRisk = clamp(phase.artifactRisk / artifactProtection, 0, 0.95);
  const providerRisk = clamp(phase.providerRisk, 0, 0.95);
  const roleAffinity = agent.specialties.has(phase.role) ? 0.85 : profile.meanAffinity;
  const recoveryLift = retry
    ? logit(clamp(profile.retryRecoveryProbability, 0.02, 0.98)) * 0.2
    : 0;
  const recentFailurePenalty = lastFailure === "context-overflow" ? -0.15 : 0;
  const baseLogit = logit(clamp(profile.successProbability, 0.02, 0.98));
  const successProbability = logistic(
    baseLogit +
    ((roleAffinity - 0.5) * 1.5) +
    ((agent.reputation - 0.5) * 1.25) +
    recoveryLift +
    recentFailurePenalty -
    ((phase.difficulty - 0.5) * 1.5)
  );
  const draw = random();
  if (draw < providerRisk) {
    return { outcome: "provider-stall", confidence: 0, artifactContractMet: false };
  }
  if (draw < providerRisk + contextRisk) {
    return { outcome: "context-overflow", confidence: 0, artifactContractMet: false };
  }
  if (draw < providerRisk + contextRisk + artifactRisk) {
    return { outcome: "invalid-artifact", confidence: 0.2, artifactContractMet: false };
  }
  const completed = random() < successProbability;
  const confidence = completed ? clamp(0.55 + (random() * 0.45), 0, 1) : random() * 0.5;
  if (!completed && random() < clamp(profile.partialProgressProbability ?? 0.5, 0.02, 0.98)) {
    return {
      outcome: "progressed",
      confidence,
      artifactContractMet: false
    };
  }
  return {
    outcome: completed ? "completed" : sampleProfileFailure(random, profile),
    confidence,
    artifactContractMet: completed && random() >= artifactRisk
  };
}

function selectAgent({ agents, phase, profile, trails, policy, cycle, attempts, random }) {
  const trail = sensedTrail(trails.get(phase.role), cycle);
  const ranked = agents.map((agent) => {
    const affinity = agent.specialties.has(phase.role) ? 0.9 : profile.meanAffinity;
    const sourcePenalty = trail?.polarity === -1 && trail.sourceAgentId === agent.id
      ? Math.abs(trail.signal)
      : 0;
    const pheromone = clamp(1 + (trail?.signal || 0) - sourcePenalty, 0.05, 2);
    const energy = clamp(agent.energy / agent.initialEnergy, 0.01, 2);
    const reputation = 0.5 + agent.reputation;
    const repetitionCount = attempts.filter(({ agentId }) => agentId === agent.id).length;
    const repetition = (1 + repetitionCount) ** policy["bid.repetitionPenalty"];
    const score =
      (Math.max(0.001, affinity) ** policy["bid.affinityWeight"]) *
      (Math.max(0.001, pheromone) ** policy["bid.pheromoneWeight"]) *
      (Math.max(0.001, reputation) ** policy["bid.reputationWeight"]) *
      (Math.max(0.001, energy) ** policy["bid.energyWeight"]) /
      repetition;
    return { agent, repetitionCount, score };
  }).sort((left, right) => right.score - left.score || left.agent.id.localeCompare(right.agent.id));
  let selected = ranked[0];
  let challengerSelected = false;
  const previousAgentId = attempts.at(-1)?.agentId;
  if (
    previousAgentId &&
    ranked.some(({ agent }) => agent.id !== previousAgentId) &&
    random() < policy["retry.challengerExploration"]
  ) {
    selected = ranked.find(({ agent }) => agent.id !== previousAgentId);
    challengerSelected = true;
  }
  return { ...selected, challengerSelected };
}

function depositTrail(trails, role, trail) {
  trails.set(role, trail);
}

function sensedTrail(trail, cycle) {
  if (!trail) return null;
  const age = Math.max(0, cycle - trail.cycle);
  return { ...trail, signal: trail.polarity * trail.intensity * Math.exp(-trail.decay * age) };
}

function summarizeCandidate(policy, rollouts) {
  const metrics = {
    simulatedPassRate: mean(rollouts.map(({ outcome }) => Number(outcome.simulatedPass))),
    phaseCompletionRate: mean(rollouts.map(({ outcome }) => outcome.phaseCompletionRate)),
    recoveryRate: mean(rollouts.map(({ outcome }) => outcome.recoveryRate)),
    artifactCompliance: mean(rollouts.map(({ outcome }) => outcome.artifactCompliance)),
    meanModelCalls: mean(rollouts.map(({ outcome }) => outcome.modelCalls)),
    meanWallTimeSeconds: mean(rollouts.map(({ outcome }) => outcome.wallTimeSeconds))
  };
  return { policy, metrics, rolloutCount: rollouts.length };
}

function compareCandidates(left, right) {
  const fields = [
    ["simulatedPassRate", -1],
    ["phaseCompletionRate", -1],
    ["recoveryRate", -1],
    ["artifactCompliance", -1],
    ["meanModelCalls", 1],
    ["meanWallTimeSeconds", 1]
  ];
  for (const [field, direction] of fields) {
    const difference = left.metrics[field] - right.metrics[field];
    if (difference !== 0) return difference * direction;
  }
  return digestResearchValue(left.policy).localeCompare(digestResearchValue(right.policy));
}

function samplePolicy({ random, means, deviations, parameterNames, baselinePolicy }) {
  const policy = structuredClone(baselinePolicy);
  for (const key of parameterNames) {
    const [minimum, maximum] = ORGANISM_POLICY_BOUNDS[key];
    let value = means[key] + (gaussian(random) * deviations[key]);
    value = clamp(value, minimum, maximum);
    if (["phase.retryLimit", "phase.artifactHorizon", "memory.compactionThreshold"].includes(key)) {
      value = Math.round(value);
    }
    policy[key] = value;
  }
  return policy;
}

function normalizePolicyParameterNames(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("parameterNames must contain at least one organism policy parameter");
  }
  const names = [...new Set(values.map((value) => String(value).trim()))];
  for (const name of names) {
    if (!Object.hasOwn(ORGANISM_POLICY_BOUNDS, name)) {
      throw new Error(`Unknown organism policy parameter ${name}`);
    }
  }
  return names;
}

export function normalizeOrganismPolicy(input) {
  const source = { ...DEFAULT_ORGANISM_POLICY, ...objectValue(input, "policy") };
  const policy = {};
  for (const [key, [minimum, maximum]] of Object.entries(ORGANISM_POLICY_BOUNDS)) {
    let value = finiteNumber(source[key], Number.NaN);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error(`policy.${key} must be from ${minimum} to ${maximum}`);
    }
    if (["phase.retryLimit", "phase.artifactHorizon", "memory.compactionThreshold"].includes(key)) {
      value = boundedInteger(value, minimum, maximum, `policy.${key}`);
    }
    policy[key] = value;
  }
  return policy;
}

function normalizeScenario(input) {
  const source = objectValue(input, "scenario");
  if (!Array.isArray(source.phases) || source.phases.length === 0) {
    throw new Error("scenario.phases must not be empty");
  }
  if (!Array.isArray(source.agents) || source.agents.length === 0) {
    throw new Error("scenario.agents must not be empty");
  }
  return {
    id: requiredId(source.id, "scenario.id"),
    phases: source.phases.map((phase, index) => ({
      id: requiredId(phase.id, `scenario.phases[${index}].id`),
      role: normalizeRole(phase.role),
      difficulty: probability(phase.difficulty, `scenario.phases[${index}].difficulty`),
      artifactRisk: probability(phase.artifactRisk, `scenario.phases[${index}].artifactRisk`),
      contextRisk: probability(phase.contextRisk, `scenario.phases[${index}].contextRisk`),
      providerRisk: probability(phase.providerRisk, `scenario.phases[${index}].providerRisk`)
    })),
    agents: source.agents.map((agent, index) => ({
      id: requiredId(agent.id, `scenario.agents[${index}].id`),
      specialties: uniqueTexts(agent.specialties, `scenario.agents[${index}].specialties`).map(normalizeRole)
    }))
  };
}

function initializeAgents(scenario) {
  return scenario.agents.map(({ id, specialties }) => ({
    id,
    specialties: new Set(specialties),
    energy: 10,
    initialEnergy: 10,
    reputation: 0.5
  }));
}

function unseenRoleProfile(model) {
  return {
    attempts: 0,
    completed: 0,
    progressed: 0,
    incomplete: 0,
    successProbability: 0.5,
    partialProgressProbability: 0.5,
    meanAffinity: 0.5,
    meanDurationSeconds: model.meanAssignmentSeconds,
    retryRecoveryProbability: model.retryRecoveryProbability,
    failureModeProbability: {},
    observedAgentIds: []
  };
}

function emptyRoleObservation(role) {
  return {
    role,
    attempts: 0,
    successes: 0,
    progressed: 0,
    failures: 0,
    affinitySum: 0,
    affinityCount: 0,
    agents: new Set(),
    failureModes: new Map()
  };
}

function sampleProfileFailure(random, profile) {
  const entries = Object.entries(profile.failureModeProbability || {});
  if (entries.length === 0) return "model-failure";
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let draw = random() * total;
  for (const [mode, weight] of entries) {
    draw -= weight;
    if (draw <= 0) return mode;
  }
  return entries.at(-1)[0];
}

function classifyFailureMode(exception, signals = []) {
  if (!exception) return null;
  const text = `${exception.type || ""} ${exception.message || ""} ${(signals || []).join(" ")}`.toLowerCase();
  if (text.includes("contextlength") || text.includes("outputlength") || text.includes("context length")) {
    return "context-overflow";
  }
  if (text.includes("cancel")) return "cancelled";
  if (text.includes("schema") || text.includes("invalid") || text.includes("contract")) {
    return "invalid-artifact";
  }
  if (text.includes("timeout") || text.includes("stopped responding") || text.includes("provider")) {
    return "provider-stall";
  }
  if (text.includes("no-progress")) return "no-progress";
  return "execution-error";
}

function validateTransitionModel(model) {
  if (!model || model.schema !== ORGANISM_TRANSITION_MODEL_SCHEMA || !model.digest) {
    throw new Error("A calibrated organism transition model is required");
  }
  const expected = { ...model };
  delete expected.digest;
  if (digestResearchValue(expected) !== model.digest) {
    throw new Error("Organism transition model digest does not match its contents");
  }
}

function durationSeconds(execution) {
  const started = new Date(execution?.startedAt).getTime();
  const finished = new Date(execution?.finishedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return 0;
  return (finished - started) / 1_000;
}

function sampleDuration(random, meanSeconds, attempt) {
  const baseline = Math.max(0.01, finiteNumber(meanSeconds, 1));
  return baseline * (0.7 + (random() * 0.6)) * (attempt > 0 ? 0.65 : 1);
}

function betaMean(successes, failures) {
  return (successes + 0.5) / (successes + failures + 1);
}

function gaussian(random) {
  const left = Math.max(Number.EPSILON, random());
  const right = random();
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

function seededRandom(seed) {
  let state = integerSeed(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function mixSeeds(...parts) {
  const digest = digestResearchValue(parts).slice(0, 8);
  return Number.parseInt(digest, 16) >>> 0;
}

function integerSeed(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error("seed must be an integer");
  return parsed;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function minimumDeviation(key) {
  const [minimum, maximum] = ORGANISM_POLICY_BOUNDS[key];
  return Math.max((maximum - minimum) * 0.01, 0.0001);
}

function logistic(value) {
  return 1 / (1 + Math.exp(-value));
}

function logit(value) {
  return Math.log(value / (1 - value));
}

function probability(value, label) {
  const parsed = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be from 0 to 1`);
  }
  return parsed;
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInteger(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function uniqueIntegers(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must not be empty`);
  return [...new Set(values.map(integerSeed))];
}

function uniqueTexts(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must not be empty`);
  return [...new Set(values.map((value) => {
    const text = String(value || "").trim();
    if (!text) throw new Error(`${label} contains an empty value`);
    return text;
  }))];
}

function normalizeRole(value) {
  return requiredId(value || "unknown", "role").toLowerCase().replaceAll("_", "-");
}

function requiredId(value, label) {
  const text = String(value || "").trim();
  if (!text || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
