import test from "node:test";
import assert from "node:assert/strict";
import {
  calibrateOrganismTransitionModel,
  crossValidateOrganismTransitionModel,
  DEFAULT_ORGANISM_POLICY,
  defaultOrganismScenario,
  evaluateOrganismPolicy,
  searchOrganismPolicies,
  simulateOrganismMission
} from "../src/research/swarmOrganismSimulator.js";

function episode({ id, status = "errored", sourceClass = "public-benchmark", eligible = false }) {
  return {
    id,
    execution: {
      status,
      startedAt: "2026-08-23T00:00:00.000Z",
      finishedAt: "2026-08-23T00:05:00.000Z",
      exception: status === "errored"
        ? { type: "ContextLengthExceededError", message: "output exceeded context length" }
        : null
    },
    verifier: { status: status === "completed" ? "passed" : "not-run", score: status === "completed" ? 1 : null },
    curriculumSignals: status === "errored" ? ["state-compiler"] : [],
    dataPolicy: { sourceClass },
    trainingEligibility: { eligible }
  };
}

function ecology(assignments) {
  return { assignments };
}

function assignment(role, status, agentId = "agent") {
  return {
    role,
    taskId: role,
    status,
    agentId,
    bid: { affinity: role === "state-compiler" ? 0.8 : 0.7 }
  };
}

function calibratedModel() {
  return calibrateOrganismTransitionModel({
    records: [
      {
        episode: episode({ id: "failed" }),
        ecology: ecology([
          assignment("interface-scanner", "completed", "scout"),
          assignment("data-scanner", "completed", "scout"),
          assignment("state-compiler", "progressed", "analyst")
        ])
      },
      {
        episode: episode({
          id: "passed",
          status: "completed",
          sourceClass: "internal-authorized",
          eligible: true
        }),
        ecology: ecology([
          assignment("interface-scanner", "completed", "scout"),
          assignment("data-scanner", "completed", "scout"),
          assignment("state-compiler", "completed", "analyst"),
          assignment("solver-builder", "completed", "builder")
        ])
      }
    ]
  });
}

function trainingCalibratedModel() {
  return calibrateOrganismTransitionModel({
    records: [
      {
        episode: episode({
          id: "rights-cleared-progress",
          status: "completed",
          sourceClass: "internal-authorized",
          eligible: true
        }),
        ecology: ecology([
          assignment("interface-scanner", "completed", "scout"),
          assignment("state-compiler", "progressed", "analyst")
        ])
      },
      {
        episode: episode({
          id: "rights-cleared-pass",
          status: "completed",
          sourceClass: "internal-authorized",
          eligible: true
        }),
        ecology: ecology([
          assignment("interface-scanner", "completed", "scout"),
          assignment("state-compiler", "completed", "analyst"),
          assignment("solver-builder", "completed", "builder")
        ])
      }
    ]
  });
}

test("real ecology records calibrate role transitions without manufacturing promotion evidence", () => {
  const model = calibratedModel();

  assert.equal(model.recordCount, 2);
  assert.equal(model.assignmentCount, 7);
  assert.ok(
    model.roleProfiles["interface-scanner"].successProbability >
    model.roleProfiles["state-compiler"].successProbability
  );
  assert.equal(model.failureModes["state-compiler:context-overflow"], 1);
  assert.ok(model.roleProfiles["state-compiler"].partialProgressProbability > 0.5);
  assert.equal(model.usePolicy.researchOnly, true);
  assert.equal(model.usePolicy.productionPromotionEligible, false);
  assert.equal(model.digest.length, 64);
});

test("recursive calibration carries the HRR world model as non-authoritative learned state", () => {
  const record = {
    episode: episode({
      id: "hrr-observation",
      status: "completed",
      sourceClass: "internal-authorized",
      eligible: true
    }),
    ecology: {
      assignments: [assignment("solver-builder", "completed", "builder")],
      worldMemoryDigests: ["a".repeat(64)],
      dualChannelShadow: {
        mode: "read-only-shadow",
        authorityEnabled: false,
        behaviorInfluence: false,
        snapshots: [{
          representedEntries: 9,
          exactPositiveRate: 1,
          exactFalsePositiveRate: 0,
          authorityLeakRate: 0,
          representationDigest: "b".repeat(64)
        }]
      }
    }
  };
  const model = calibrateOrganismTransitionModel({ records: [record] });
  const simulation = simulateOrganismMission({ model, seed: 17 });

  assert.equal(model.holographicWorld.architecture, "dual-channel-hrr");
  assert.equal(model.holographicWorld.snapshotCount, 1);
  assert.equal(model.holographicWorld.safetyPassed, true);
  assert.equal(model.holographicWorld.behaviorInfluence, false);
  assert.equal(simulation.holographicWorld.influencesSimulation, false);
  assert.equal(simulation.holographicWorld.authorityEnabled, false);
});

test("active HRR calibration records behavioral influence but never simulation authority", () => {
  const record = {
    episode: episode({
      id: "active-hrr-observation",
      status: "completed",
      sourceClass: "internal-authorized",
      eligible: true
    }),
    ecology: {
      assignments: [assignment("solver-builder", "completed", "builder")],
      worldMemoryDigests: ["c".repeat(64)],
      dualChannelWorld: {
        mode: "bounded-active-retrieval",
        authorityEnabled: false,
        behaviorInfluence: true,
        snapshots: [{
          representedEntries: 6,
          exactPositiveRate: 1,
          exactFalsePositiveRate: 0,
          authorityLeakRate: 0,
          representationDigest: "d".repeat(64)
        }]
      }
    }
  };
  const model = calibrateOrganismTransitionModel({ records: [record] });
  const simulation = simulateOrganismMission({ model, seed: 23 });

  assert.equal(model.holographicWorld.mode, "bounded-active-retrieval");
  assert.equal(model.holographicWorld.behaviorInfluence, true);
  assert.equal(model.holographicWorld.authorityEnabled, false);
  assert.equal(simulation.holographicWorld.influencesSimulation, false);
  assert.equal(simulation.holographicWorld.authorityEnabled, false);
});

test("digital ecology rollouts are seeded, deterministic, and never verifier evidence", () => {
  const model = calibratedModel();
  const input = {
    model,
    scenario: defaultOrganismScenario(),
    policy: DEFAULT_ORGANISM_POLICY,
    seed: 42
  };
  const first = simulateOrganismMission(input);
  const second = simulateOrganismMission(input);

  assert.deepEqual(first, second);
  assert.equal(first.simulated, true);
  assert.equal(first.verifierEvidence, null);
  assert.equal(first.promotionEligible, false);
  assert.equal(first.frozenSubstrate, true);
  assert.ok(first.outcome.modelCalls > 0);
});

test("leave-one-execution-out validation quantifies simulation error", () => {
  const records = [
    {
      episode: episode({ id: "failure" }),
      ecology: ecology([
        assignment("interface-scanner", "completed", "scout"),
        assignment("state-compiler", "incomplete", "analyst")
      ])
    },
    {
      episode: episode({ id: "second-failure" }),
      ecology: ecology([
        assignment("interface-scanner", "completed", "scout"),
        assignment("state-compiler", "incomplete", "analyst")
      ])
    }
  ];
  const validation = crossValidateOrganismTransitionModel({ records });

  assert.equal(validation.method, "leave-one-execution-out");
  assert.equal(validation.predictionCount, 4);
  assert.ok(validation.brierScore >= 0 && validation.brierScore <= 1);
  assert.ok(validation.logLoss >= 0);
  assert.equal(validation.interpretation.promotionEligible, false);
});

test("CEM searches ecological policy while preserving real-Qwen promotion gates", () => {
  const model = trainingCalibratedModel();
  const search = searchOrganismPolicies({
    model,
    scenarios: [defaultOrganismScenario()],
    candidates: 8,
    elites: 2,
    generations: 2,
    seeds: [3, 5],
    seed: 19
  });

  assert.equal(search.history.length, 2);
  assert.equal(search.promotionQueue.length, 2);
  assert.equal(search.promotionQueue[0].automaticallyPromoted, false);
  assert.equal(search.usePolicy.createsVerifierEvidence, false);
  assert.ok(search.usePolicy.requiredRealGates.includes("independent-verifier"));
  assert.equal(search.digest.length, 64);
});

test("standalone policy evaluation uses the same paired protocol as search", () => {
  const model = trainingCalibratedModel();
  const scenario = defaultOrganismScenario();
  const evaluation = evaluateOrganismPolicy({
    model,
    scenarios: [scenario],
    policy: DEFAULT_ORGANISM_POLICY,
    seeds: [3, 5],
    seed: 19
  });
  const repeated = evaluateOrganismPolicy({
    model,
    scenarios: [scenario],
    policy: DEFAULT_ORGANISM_POLICY,
    seeds: [3, 5],
    seed: 19
  });

  assert.equal(evaluation.rolloutCount, 2);
  assert.deepEqual(evaluation.policy, DEFAULT_ORGANISM_POLICY);
  assert.deepEqual(repeated, evaluation);
});

test("staged CEM changes only the policy parameters authorized by the training contract", () => {
  const model = trainingCalibratedModel();
  const parameterNames = [
    "bid.repetitionPenalty",
    "pheromone.partialProgressIntensity",
    "energy.partialProgressReward",
    "retry.challengerExploration"
  ];
  const search = searchOrganismPolicies({
    model,
    candidates: 8,
    elites: 2,
    generations: 2,
    seeds: [3, 5],
    seed: 23,
    parameterNames
  });

  assert.deepEqual(search.optimizedParameters, parameterNames);
  assert.equal(
    search.fixedParameters.length,
    Object.keys(DEFAULT_ORGANISM_POLICY).length - parameterNames.length
  );
  for (const candidate of search.promotionQueue) {
    for (const fixed of search.fixedParameters) {
      assert.equal(candidate.policy[fixed], DEFAULT_ORGANISM_POLICY[fixed]);
    }
  }
  assert.throws(
    () => searchOrganismPolicies({
      model,
      candidates: 4,
      elites: 1,
      generations: 1,
      parameterNames: ["not-a-real-policy-control"]
    }),
    /Unknown organism policy parameter/
  );
});

test("public benchmark calibration cannot produce policy candidates", () => {
  const model = calibratedModel();
  assert.equal(model.usePolicy.researchOnly, true);
  assert.throws(
    () => searchOrganismPolicies({ model, candidates: 4, elites: 1, generations: 1 }),
    /exclusively training-eligible/
  );
});

test("rights-approved public failures can mix with owned traces while excluding their eval task", () => {
  const publicFailure = episode({ id: "licensed-public-failure" });
  publicFailure.dataPolicy.contaminationTags = [
    "exclude-eval:terminal-bench-3.0.0:production-planning"
  ];
  const ownedPass = episode({
    id: "owned-pass",
    status: "completed",
    sourceClass: "internal-authorized",
    eligible: true
  });
  const model = calibrateOrganismTransitionModel({
    records: [
      {
        episode: publicFailure,
        ecology: ecology([assignment("solver-builder", "progressed", "builder")]),
        organismPolicyTrainingEligibility: { eligible: true, reasons: [] }
      },
      {
        episode: ownedPass,
        ecology: ecology([assignment("solver-builder", "completed", "challenger")]),
        organismPolicyTrainingEligibility: { eligible: true, reasons: [] }
      }
    ]
  });

  assert.equal(model.usePolicy.researchOnly, false);
  assert.deepEqual(model.usePolicy.evaluationExclusions, [
    "exclude-eval:terminal-bench-3.0.0:production-planning"
  ]);
  assert.doesNotThrow(() => searchOrganismPolicies({
    model,
    candidates: 4,
    elites: 1,
    generations: 1,
    seeds: [7]
  }));
});

test("the model digest prevents silent calibration mutation", () => {
  const model = calibratedModel();
  model.roleProfiles["state-compiler"].successProbability = 1;
  assert.throws(
    () => simulateOrganismMission({ model, seed: 1 }),
    /digest does not match/
  );
});

test("partial progress creates a learnable intervention point without becoming success", () => {
  const model = calibrateOrganismTransitionModel({
    records: Array.from({ length: 10 }, (_, index) => ({
      episode: episode({ id: `progress-${index + 1}` }),
      ecology: ecology([assignment("solver-builder", "progressed", "builder")])
    }))
  });
  const scenario = {
    id: "credit-assignment-probe",
    phases: [{
      id: "build",
      role: "solver-builder",
      difficulty: 0.99,
      artifactRisk: 0,
      contextRisk: 0,
      providerRisk: 0
    }],
    agents: [
      { id: "builder", specialties: ["solver-builder"] },
      { id: "challenger", specialties: ["solver-builder"] }
    ]
  };
  const policy = {
    ...DEFAULT_ORGANISM_POLICY,
    "phase.retryLimit": 4,
    "retry.challengerExploration": 1,
    "bid.repetitionPenalty": 4
  };
  const result = Array.from({ length: 100 }, (_, index) =>
    simulateOrganismMission({ model, scenario, policy, seed: index + 1 })
  ).find(({ outcome }) => outcome.partialProgressAttempts > 0);

  assert.ok(result);
  assert.equal(result.promotionEligible, false);
  assert.ok(result.events.some(({ outcome }) => outcome === "progressed"));
  assert.ok(result.events
    .filter(({ outcome }) => outcome === "progressed")
    .every(({ artifactContractMet }) => artifactContractMet === false));
  assert.ok(result.events.slice(1).some(({ challengerSelected }) => challengerSelected));
});
