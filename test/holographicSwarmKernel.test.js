import test from "node:test";
import assert from "node:assert/strict";
import {
  HolographicMemory,
  HolographicWorldModel,
  HolographicSwarmKernel,
  PheromoneField,
  SwarmTaskGraph,
  rankHolographicBids
} from "../src/research/holographicSwarmKernel.js";

test("the shared HRR world model projects verified exact entries for every specialist", () => {
  const memory = new HolographicMemory({ dimension: 256, namespace: "shared-world" });
  const world = new HolographicWorldModel({
    memory,
    entries: [
      {
        id: "fact-capacity",
        kind: "constraint",
        text: "Assembly capacity is 80 hours per week.",
        evidenceRefs: ["receipt:capacity"],
        verifiedBy: "amos-host"
      },
      {
        id: "fact-brand",
        kind: "preference",
        text: "Marketing copy uses a warm conversational tone.",
        evidenceRefs: ["receipt:brand"],
        verifiedBy: "amos-host"
      }
    ]
  });

  const [projected] = world.project("finite production capacity", { limit: 1 });
  const snapshot = world.snapshot();

  assert.equal(projected.id, "fact-capacity");
  assert.equal(snapshot.entries.length, 2);
  assert.equal(snapshot.encoder, "deterministic-hrr-v1");
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.updatedBy, "amos-host");
  assert.equal(snapshot.itemDictionary.length, 2);
  assert.equal(snapshot.encoderDigest.length, 64);
  assert.equal(snapshot.roleBasisDigest.length, 64);
  assert.equal(snapshot.representationDigest.length, 64);
  assert.equal(snapshot.digest.length, 64);
  assert.equal(Object.hasOwn(snapshot, "vector"), false);
});

test("bids carry the same host-verified world projection without treating it as score authority", () => {
  const base = {
    memory: new HolographicMemory({ dimension: 128, namespace: "world-bids" }),
    agents: [{
      id: "builder",
      skills: ["solver engineering"],
      energy: 5,
      initialEnergy: 5,
      reputation: 0.5,
      activeTaskId: null
    }],
    tasks: [{
      id: "build",
      objective: "Build the capacity solver.",
      requirements: [],
      tags: ["solver-engineering"]
    }]
  };
  const withoutWorld = rankHolographicBids(base)[0];
  const withWorld = rankHolographicBids({
    ...base,
    worldEntries: [{
      id: "capacity-receipt",
      kind: "constraint",
      text: "Assembly capacity is 80 hours.",
      evidenceRefs: ["artifact-0001"],
      verifiedBy: "amos-host"
    }]
  })[0];

  assert.equal(withWorld.score, withoutWorld.score);
  assert.equal(withWorld.worldContext[0].id, "capacity-receipt");
  assert.equal(withWorld.worldMemoryDigest.length, 64);
});

test("holographic binding can recover a value from its contextual key", () => {
  const memory = new HolographicMemory({ dimension: 256, namespace: "test" });
  const role = memory.symbol("role");
  const builder = memory.symbol("builder");
  const unrelated = memory.symbol("accounting");
  const bound = memory.bind(role, builder);
  const recovered = memory.unbind(bound, role);

  assert.ok(memory.similarity(recovered, builder) > memory.similarity(recovered, unrelated));
  assert.ok(memory.snapshot([{ id: "memory-1", vector: bound }]).digest.length === 64);
});

test("pheromones decay, expire, and preserve attractive versus repellent signals", () => {
  const field = new PheromoneField({ missionId: "mission-1" });
  field.deposit({
    kind: "candidate-needed",
    targetTaskId: "task-1",
    intensity: 1,
    decayRate: 0.2,
    depositedAtCycle: 0,
    ttlCycles: 5
  });
  field.deposit({
    kind: "discovery-complete",
    targetTaskId: "task-1",
    intensity: 0.5,
    polarity: "repel",
    decayRate: 0,
    depositedAtCycle: 0,
    ttlCycles: 5
  });

  const initial = field.netSignal({ cycle: 0, taskId: "task-1" });
  const later = field.netSignal({ cycle: 3, taskId: "task-1" });
  assert.equal(initial, 0.5);
  assert.ok(later < initial);
  assert.equal(field.sense({ cycle: 5, taskId: "task-1" }).length, 0);
});

test("the lightweight task graph tracks dependencies without prescribing execution", () => {
  const graph = new SwarmTaskGraph({ missionId: "mission-graph" });
  graph.addTask({ id: "research", objective: "Compile governed evidence." });
  graph.addTask({
    id: "build",
    objective: "Construct the verified candidate.",
    dependencies: ["research"]
  });

  assert.deepEqual(graph.openTasks().map(({ id }) => id), ["research"]);
  graph.claim("research", "agent-research");
  graph.complete("research", {
    agentId: "agent-research",
    resultRefs: ["artifact:research"],
    verifierScore: 1
  });
  assert.deepEqual(graph.openTasks().map(({ id }) => id), ["build"]);
});

test("agents self-organize through holographic affinity, pheromones, and energy", () => {
  const kernel = new HolographicSwarmKernel({
    missionId: "production-plan",
    memory: new HolographicMemory({ dimension: 256, namespace: "assignment" }),
    initialEnergy: 10,
    claimCost: 1
  });
  kernel.registerAgent({
    id: "scheduler",
    skills: ["production scheduling", "constraint optimization"]
  });
  kernel.registerAgent({
    id: "writer",
    skills: ["marketing copy", "brand storytelling"]
  });
  kernel.addTask({
    id: "schedule",
    objective: "Optimize a production schedule under finite capacity constraints.",
    tags: ["production-scheduling", "constraint-optimization"],
    reward: 10
  });

  const [assignment] = kernel.selfOrganize({ cycle: 0, maximumAssignments: 1 });
  assert.equal(assignment.taskId, "schedule");
  assert.equal(assignment.agentId, "scheduler");
  assert.equal(kernel.snapshot().agents.find(({ id }) => id === "scheduler").energy, 9);
});

test("the pure bidding boundary can drive a non-JavaScript swarm adapter", () => {
  const bids = rankHolographicBids({
    memory: new HolographicMemory({ dimension: 128, namespace: "adapter" }),
    cycle: 2,
    claimCost: 1,
    agents: [
      {
        id: "builder",
        skills: ["solver engineering"],
        experiences: [],
        energy: 5,
        initialEnergy: 5,
        reputation: 0.6,
        activeTaskId: null
      }
    ],
    tasks: [{
      id: "construct",
      objective: "Engineer and run the production planning solver.",
      requirements: [],
      tags: ["solver-engineering"]
    }],
    pheromones: []
  });

  assert.equal(bids.length, 1);
  assert.equal(bids[0].agentId, "builder");
  assert.equal(bids[0].taskId, "construct");
  assert.ok(bids[0].score > 0);
});

test("a failed-approach pheromone makes an equivalent fresh agent win the retry", () => {
  const bids = rankHolographicBids({
    memory: new HolographicMemory({ dimension: 128, namespace: "retry" }),
    cycle: 2,
    claimCost: 1,
    agents: ["agent-a", "agent-b"].map((id) => ({
      id,
      skills: ["state compilation"],
      experiences: [],
      energy: 5,
      initialEnergy: 5,
      reputation: 0.5,
      activeTaskId: null
    })),
    tasks: [{
      id: "state-compiler",
      objective: "Compile the complete planning state.",
      requirements: [],
      tags: ["state-compilation"]
    }],
    pheromones: [{
      id: "pheromone-failed",
      kind: "failed-approach",
      sourceAgentId: "agent-a",
      targetTaskId: "state-compiler",
      payload: {},
      intensity: 0.8,
      confidence: 1,
      polarity: "repel",
      decayRate: 0,
      depositedAtCycle: 1,
      ttlCycles: 20,
      evidenceRefs: []
    }]
  });

  assert.equal(bids[0].agentId, "agent-b");
  assert.ok(bids[0].score > bids[1].score);
});

test("verified outcomes reinforce the successful agent and leave knowledge pheromones", () => {
  const kernel = new HolographicSwarmKernel({ missionId: "learning-loop" });
  kernel.registerAgent({ id: "agent-1", skills: ["database planning"] });
  kernel.addTask({
    id: "task-1",
    objective: "Build a database-backed production plan.",
    reward: 5
  });
  kernel.selfOrganize({ cycle: 0, maximumAssignments: 1 });
  const outcome = kernel.recordVerifiedOutcome({
    cycle: 1,
    taskId: "task-1",
    agentId: "agent-1",
    verifierScore: 0.8,
    resultRefs: ["receipt:abc"],
    learnedSkills: ["finite-capacity scheduling"]
  });
  const snapshot = kernel.snapshot({ cycle: 1 });
  const agent = snapshot.agents[0];

  assert.equal(outcome.reward, 4);
  assert.equal(agent.completedTasks, 1);
  assert.equal(agent.energy, 13);
  assert.ok(agent.reputation > 0.5);
  assert.equal(
    snapshot.pheromoneField.active.some(({ kind }) => kind === "verified-knowledge"),
    true
  );
});

test("failed approaches leave temporary repellent trails", () => {
  const kernel = new HolographicSwarmKernel({ missionId: "failure-loop" });
  kernel.registerAgent({ id: "agent-1", skills: ["research"] });
  kernel.addTask({ id: "task-1", objective: "Research a difficult topic." });
  kernel.selfOrganize({ cycle: 0, maximumAssignments: 1 });
  kernel.recordFailedOutcome({
    cycle: 1,
    taskId: "task-1",
    agentId: "agent-1",
    resultRefs: ["trace:failed"]
  });
  const failed = kernel.field.sense({ cycle: 1, taskId: "task-1", kinds: ["failed-approach"] });

  assert.equal(failed.length, 1);
  assert.ok(failed[0].signal < 0);
});

test("a learned credit-assignment policy rewards progress and routes the retry to a challenger", () => {
  const kernel = new HolographicSwarmKernel({
    missionId: "credit-assignment-loop",
    policy: {
      "bid.repetitionPenalty": 4,
      "pheromone.partialProgressIntensity": 0.7,
      "energy.partialProgressReward": 0.5,
      "retry.challengerExploration": 1
    }
  });
  for (const id of ["agent-a", "agent-b"]) {
    kernel.registerAgent({ id, skills: ["invoice process analysis"] });
  }
  kernel.addTask({
    id: "analyze-ap-log",
    objective: "Analyze an accounts-payable event log and produce verified process findings.",
    reward: 4
  });

  const [first] = kernel.selfOrganize({ cycle: 0, maximumAssignments: 1 });
  const progress = kernel.recordPartialProgress({
    cycle: 1,
    taskId: "analyze-ap-log",
    agentId: first.agentId,
    confidence: 0.5,
    resultRefs: ["receipt:partial-analysis"]
  });
  const [second] = kernel.selfOrganize({ cycle: 2, maximumAssignments: 1 });
  const snapshot = kernel.snapshot({ cycle: 2 });

  assert.equal(progress.status, "progressed");
  assert.equal(progress.reward, 1);
  assert.notEqual(second.agentId, first.agentId);
  assert.equal(snapshot.taskGraph.tasks[0].status, "claimed");
  assert.equal(snapshot.policy["bid.repetitionPenalty"], 4);
  assert.ok(snapshot.pheromoneField.events.some(({ kind, intensity }) =>
    kind === "partial-progress" && intensity === 0.7
  ));
});
