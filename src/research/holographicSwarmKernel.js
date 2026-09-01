import { createHash } from "node:crypto";
import { digestResearchValue } from "./experimentProtocol.js";
import {
  DEFAULT_ORGANISM_POLICY,
  normalizeOrganismPolicy
} from "./swarmOrganismSimulator.js";

export const HOLOGRAPHIC_SWARM_VERSION = 1;
export const HOLOGRAPHIC_MEMORY_SCHEMA = "amos.holographic-memory";
export const HOLOGRAPHIC_WORLD_MODEL_SCHEMA = "amos.holographic-world-model";
export const PHEROMONE_FIELD_SCHEMA = "amos.pheromone-field";
export const SWARM_AGENT_SCHEMA = "amos.swarm-agent";
export const SWARM_TASK_GRAPH_SCHEMA = "amos.swarm-task-graph";
export const SWARM_KERNEL_SCHEMA = "amos.holographic-swarm-kernel";

const PHEROMONE_POLARITIES = new Set(["attract", "repel"]);
const TASK_STATUSES = new Set(["blocked", "open", "claimed", "completed", "failed"]);

/**
 * Classical Holographic Reduced Representation memory.
 *
 * Vectors guide association and routing only. Exact facts, authority, and
 * completion remain in the governed task graph and evidence receipts.
 */
export class HolographicMemory {
  constructor({ dimension = 128, namespace = "amos-swarm" } = {}) {
    this.dimension = boundedInteger(dimension, 16, 2_048, "dimension");
    this.namespace = requiredText(namespace, "namespace", 256);
  }

  encode(text) {
    const tokens = tokenize(requiredText(text, "text", 500_000));
    const vectors = tokens.length > 0
      ? tokens.map((token) => this.symbol(token))
      : [this.symbol("empty")];
    return this.superpose(vectors);
  }

  symbol(value) {
    const symbol = requiredText(value, "symbol", 10_000);
    const vector = new Array(this.dimension);
    let block = Buffer.alloc(0);
    let blockIndex = 0;
    for (let index = 0; index < this.dimension; index += 1) {
      if (index % 256 === 0) {
        block = createHash("sha256")
          .update(`${this.namespace}\0${symbol}\0${blockIndex}`)
          .digest();
        blockIndex += 1;
      }
      const bitIndex = index % 256;
      const byte = block[Math.floor(bitIndex / 8)];
      vector[index] = ((byte >> (bitIndex % 8)) & 1) === 1 ? 1 : -1;
    }
    return normalizeVector(vector, this.dimension);
  }

  bind(left, right) {
    const a = validVector(left, this.dimension, "left");
    const b = validVector(right, this.dimension, "right");
    const result = new Array(this.dimension).fill(0);
    for (let index = 0; index < this.dimension; index += 1) {
      for (let offset = 0; offset < this.dimension; offset += 1) {
        result[index] += a[offset] * b[(index - offset + this.dimension) % this.dimension];
      }
    }
    return normalizeVector(result, this.dimension);
  }

  unbind(bound, key) {
    const source = validVector(bound, this.dimension, "bound");
    const correlationKey = approximateInverse(
      validVector(key, this.dimension, "key")
    );
    return this.bind(source, correlationKey);
  }

  superpose(vectors) {
    if (!Array.isArray(vectors) || vectors.length === 0) {
      throw new Error("Holographic superposition requires at least one vector");
    }
    const result = new Array(this.dimension).fill(0);
    for (const vector of vectors) {
      const valid = validVector(vector, this.dimension, "superposition vector");
      for (let index = 0; index < this.dimension; index += 1) {
        result[index] += valid[index];
      }
    }
    return normalizeVector(result, this.dimension);
  }

  similarity(left, right) {
    const a = validVector(left, this.dimension, "left");
    const b = validVector(right, this.dimension, "right");
    return a.reduce((sum, value, index) => sum + (value * b[index]), 0);
  }

  taskVector({ objective, requirements = [], tags = [] }) {
    const parts = [this.encode(objective)];
    for (const requirement of requirements) {
      parts.push(this.bind(this.symbol("requirement"), this.encode(requirement)));
    }
    for (const tag of tags) {
      parts.push(this.bind(this.symbol("skill"), this.encode(tag)));
    }
    return this.superpose(parts);
  }

  agentVector({ skills, experiences = [] }) {
    if (!Array.isArray(skills) || skills.length === 0) {
      throw new Error("A swarm agent requires at least one skill");
    }
    const parts = skills.map((skill) =>
      this.bind(this.symbol("skill"), this.encode(skill))
    );
    for (const experience of experiences) {
      parts.push(this.bind(this.symbol("experience"), this.encode(experience)));
    }
    return this.superpose(parts);
  }

  snapshot(entries = []) {
    const memory = {
      schema: HOLOGRAPHIC_MEMORY_SCHEMA,
      version: HOLOGRAPHIC_SWARM_VERSION,
      dimension: this.dimension,
      namespace: this.namespace,
      entries: structuredClone(entries)
    };
    return { ...memory, digest: digestResearchValue(memory) };
  }
}

/**
 * Shared associative world representation for every logical specialist.
 *
 * Exact, host-verified entries remain available beside the HRR projection.
 * The vector is an attention and retrieval surface, never evidence or
 * authority. This deterministic encoder is the replaceable Stage-1 baseline
 * for a learned encoder/codebook trained from successful mission traces.
 */
export class HolographicWorldModel {
  constructor({
    memory = new HolographicMemory(),
    entries = [],
    boardDigest = null,
    encoderDigest = null,
    roleBasisDigest = null
  } = {}) {
    if (!(memory instanceof HolographicMemory)) {
      throw new Error("HolographicWorldModel requires HolographicMemory");
    }
    this.memory = memory;
    this.boardDigest = optionalSha256(boardDigest, "worldModel.boardDigest");
    this.encoderDigest = optionalSha256(encoderDigest, "worldModel.encoderDigest") ||
      digestResearchValue({ encoder: "deterministic-hrr-v1", namespace: memory.namespace });
    this.roleBasisDigest = optionalSha256(roleBasisDigest, "worldModel.roleBasisDigest");
    this.entries = [];
    for (const entry of entries) this.observe(entry);
  }

  observe({ id, kind, text, evidenceRefs = [], confidence = 1, verifiedBy }) {
    const entry = {
      id: requiredId(id, "worldEntry.id"),
      kind: requiredId(kind, "worldEntry.kind"),
      text: requiredText(text, "worldEntry.text", 100_000),
      evidenceRefs: uniqueIds(evidenceRefs, "worldEntry.evidenceRefs", 1_000),
      confidence: boundedNumber(confidence, 0, 1, "worldEntry.confidence"),
      verifiedBy: requiredId(verifiedBy, "worldEntry.verifiedBy")
    };
    if (this.entries.some(({ id }) => id === entry.id)) {
      throw new Error(`Duplicate holographic world entry ${entry.id}`);
    }
    this.entries.push({
      ...entry,
      vector: this.memory.bind(
        this.memory.symbol(`world:${entry.kind}`),
        this.memory.encode(entry.text)
      )
    });
    return structuredClone(entry);
  }

  project(query, { limit = 8 } = {}) {
    const maximum = boundedInteger(limit, 1, 100, "worldProjection.limit");
    const queryVector = this.memory.encode(requiredText(query, "worldProjection.query", 500_000));
    return this.entries
      .map(({ vector, ...entry }) => ({
        ...structuredClone(entry),
        similarity: this.memory.similarity(queryVector, vector)
      }))
      .sort((left, right) =>
        right.similarity - left.similarity || left.id.localeCompare(right.id)
      )
      .slice(0, maximum);
  }

  snapshot() {
    const exactEntries = this.entries.map(({ vector: _vector, ...entry }) =>
      structuredClone(entry)
    );
    const vector = this.entries.length > 0
      ? this.memory.superpose(this.entries.map(({ vector }) => vector))
      : new Array(this.memory.dimension).fill(0);
    const kinds = [...new Set(exactEntries.map(({ kind }) => kind))].sort();
    const state = {
      schema: HOLOGRAPHIC_WORLD_MODEL_SCHEMA,
      version: HOLOGRAPHIC_SWARM_VERSION,
      encoder: "deterministic-hrr-v1",
      encoderDigest: this.encoderDigest,
      roleBasisDigest: this.roleBasisDigest || digestResearchValue({
        algebra: "circular-convolution",
        roles: kinds.map((kind) => ({
          kind,
          vectorDigest: digestResearchValue(this.memory.symbol(`world:${kind}`))
        }))
      }),
      boardDigest: this.boardDigest,
      readOnly: true,
      updatedBy: "amos-host",
      memoryKind: "vector",
      namespace: this.memory.namespace,
      dimension: this.memory.dimension,
      entries: exactEntries,
      itemDictionary: exactEntries.map(({ id, kind, evidenceRefs }) => ({
        id,
        kind,
        evidenceRefs
      })),
      representationDigest: digestResearchValue(vector)
    };
    return { ...state, digest: digestResearchValue(state) };
  }
}

/** Event-sourced stigmergic field with deterministic decay. */
export class PheromoneField {
  constructor({ missionId }) {
    this.missionId = requiredId(missionId, "missionId");
    this.events = [];
  }

  deposit({
    kind,
    sourceAgentId = null,
    targetTaskId = null,
    payload = {},
    intensity = 1,
    confidence = 1,
    polarity = "attract",
    decayRate = 0.1,
    depositedAtCycle = 0,
    ttlCycles = 10,
    evidenceRefs = []
  }) {
    const event = {
      id: `pheromone-${String(this.events.length + 1).padStart(5, "0")}`,
      kind: requiredId(kind, "pheromone.kind"),
      sourceAgentId: optionalId(sourceAgentId, "pheromone.sourceAgentId"),
      targetTaskId: optionalId(targetTaskId, "pheromone.targetTaskId"),
      payload: jsonObject(payload, "pheromone.payload"),
      intensity: boundedNumber(intensity, 0, 1, "pheromone.intensity"),
      confidence: boundedNumber(confidence, 0, 1, "pheromone.confidence"),
      polarity: enumValue(polarity, PHEROMONE_POLARITIES, "pheromone.polarity"),
      decayRate: boundedNumber(decayRate, 0, 1, "pheromone.decayRate"),
      depositedAtCycle: boundedInteger(
        depositedAtCycle,
        0,
        Number.MAX_SAFE_INTEGER,
        "pheromone.depositedAtCycle"
      ),
      ttlCycles: boundedInteger(ttlCycles, 1, 1_000_000, "pheromone.ttlCycles"),
      evidenceRefs: uniqueIds(evidenceRefs, "pheromone.evidenceRefs", 100)
    };
    this.events.push(event);
    return structuredClone(event);
  }

  sense({ cycle, taskId = null, kinds = null } = {}) {
    const currentCycle = boundedInteger(
      cycle,
      0,
      Number.MAX_SAFE_INTEGER,
      "cycle"
    );
    const selectedKinds = kinds === null
      ? null
      : new Set(uniqueIds(kinds, "kinds", 100));
    return this.events
      .filter((event) => taskId === null || event.targetTaskId === taskId)
      .filter((event) => selectedKinds === null || selectedKinds.has(event.kind))
      .map((event) => sensedPheromone(event, currentCycle))
      .filter((event) => event !== null)
      .sort((left, right) => Math.abs(right.signal) - Math.abs(left.signal));
  }

  netSignal({ cycle, taskId, kinds = null }) {
    return this.sense({ cycle, taskId, kinds })
      .reduce((sum, event) => sum + event.signal, 0);
  }

  snapshot({ cycle = 0 } = {}) {
    const field = {
      schema: PHEROMONE_FIELD_SCHEMA,
      version: HOLOGRAPHIC_SWARM_VERSION,
      missionId: this.missionId,
      cycle: boundedInteger(cycle, 0, Number.MAX_SAFE_INTEGER, "cycle"),
      events: structuredClone(this.events),
      active: this.sense({ cycle })
    };
    return { ...field, digest: digestResearchValue(field) };
  }
}

/** Minimal dependency tracker. It records state but does not prescribe agent behavior. */
export class SwarmTaskGraph {
  constructor({ missionId }) {
    this.missionId = requiredId(missionId, "missionId");
    this.tasks = new Map();
  }

  addTask({ id, objective, dependencies = [], reward = 1, tags = [], requirements = [] }) {
    const taskId = requiredId(id, "task.id");
    if (this.tasks.has(taskId)) throw new Error(`Duplicate swarm task ${taskId}`);
    const task = {
      id: taskId,
      objective: requiredText(objective, "task.objective", 100_000),
      dependencies: uniqueIds(dependencies, "task.dependencies", 100),
      reward: boundedNumber(reward, 0, 1_000_000, "task.reward"),
      tags: uniqueIds(tags, "task.tags", 100),
      requirements: uniqueTexts(requirements, "task.requirements", 100),
      status: dependencies.length === 0 ? "open" : "blocked",
      claimedBy: null,
      resultRefs: [],
      verifierScore: null
    };
    this.tasks.set(taskId, task);
    this.#assertAcyclic();
    this.#refreshOpenTasks();
    return structuredClone(task);
  }

  openTasks() {
    this.#refreshOpenTasks();
    return [...this.tasks.values()]
      .filter((task) => task.status === "open")
      .map((task) => structuredClone(task));
  }

  claim(taskId, agentId) {
    const task = this.#task(taskId);
    if (task.status !== "open") throw new Error(`Swarm task ${task.id} is not open`);
    task.status = "claimed";
    task.claimedBy = requiredId(agentId, "agentId");
    return structuredClone(task);
  }

  complete(taskId, { agentId, resultRefs, verifierScore }) {
    const task = this.#task(taskId);
    if (task.status !== "claimed" || task.claimedBy !== agentId) {
      throw new Error(`Agent ${agentId} does not hold swarm task ${task.id}`);
    }
    const score = boundedNumber(verifierScore, 0, 1, "verifierScore");
    if (score <= 0) throw new Error("A completed swarm task requires positive verifier evidence");
    task.status = "completed";
    task.resultRefs = uniqueIds(resultRefs, "task.resultRefs", 1_000);
    task.verifierScore = score;
    this.#refreshOpenTasks();
    return structuredClone(task);
  }

  progress(taskId, { agentId, resultRefs = [] }) {
    const task = this.#task(taskId);
    if (task.status !== "claimed" || task.claimedBy !== agentId) {
      throw new Error(`Agent ${agentId} does not hold swarm task ${task.id}`);
    }
    task.status = "open";
    task.claimedBy = null;
    task.resultRefs = uniqueIds([...task.resultRefs, ...resultRefs], "task.resultRefs", 1_000);
    return structuredClone(task);
  }

  fail(taskId, { agentId, resultRefs = [] }) {
    const task = this.#task(taskId);
    if (task.status !== "claimed" || task.claimedBy !== agentId) {
      throw new Error(`Agent ${agentId} does not hold swarm task ${task.id}`);
    }
    task.status = "failed";
    task.resultRefs = uniqueIds(resultRefs, "task.resultRefs", 1_000);
    return structuredClone(task);
  }

  snapshot() {
    const graph = {
      schema: SWARM_TASK_GRAPH_SCHEMA,
      version: HOLOGRAPHIC_SWARM_VERSION,
      missionId: this.missionId,
      tasks: [...this.tasks.values()].map((task) => structuredClone(task))
    };
    return { ...graph, digest: digestResearchValue(graph) };
  }

  #task(taskId) {
    const task = this.tasks.get(requiredId(taskId, "taskId"));
    if (!task) throw new Error(`Unknown swarm task ${taskId}`);
    return task;
  }

  #refreshOpenTasks() {
    for (const task of this.tasks.values()) {
      if (task.status !== "blocked") continue;
      const ready = task.dependencies.every((dependencyId) =>
        this.tasks.get(dependencyId)?.status === "completed"
      );
      if (ready) task.status = "open";
    }
  }

  #assertAcyclic() {
    const visiting = new Set();
    const visited = new Set();
    const visit = (taskId) => {
      if (visiting.has(taskId)) throw new Error("Swarm task graph contains a dependency cycle");
      if (visited.has(taskId)) return;
      visiting.add(taskId);
      const task = this.tasks.get(taskId);
      for (const dependencyId of task.dependencies) {
        if (!this.tasks.has(dependencyId)) {
          throw new Error(`Swarm task ${taskId} has unknown dependency ${dependencyId}`);
        }
        visit(dependencyId);
      }
      visiting.delete(taskId);
      visited.add(taskId);
    };
    for (const taskId of this.tasks.keys()) visit(taskId);
  }
}

export class HolographicSwarmKernel {
  constructor({
    missionId,
    memory = new HolographicMemory(),
    initialEnergy = 10,
    claimCost = null,
    policy = DEFAULT_ORGANISM_POLICY
  }) {
    this.missionId = requiredId(missionId, "missionId");
    this.memory = memory;
    this.field = new PheromoneField({ missionId: this.missionId });
    this.graph = new SwarmTaskGraph({ missionId: this.missionId });
    this.policy = normalizeOrganismPolicy(policy);
    this.initialEnergy = boundedNumber(initialEnergy, 0.01, 1_000_000, "initialEnergy");
    this.claimCost = boundedNumber(
      claimCost ?? this.policy["energy.claimCost"],
      0,
      this.initialEnergy,
      "claimCost"
    );
    this.agents = new Map();
    this.assignments = [];
    this.energyEvents = [];
    this.outcomes = [];
  }

  registerAgent({ id, skills, identity = {}, energy = this.initialEnergy }) {
    const agentId = requiredId(id, "agent.id");
    if (this.agents.has(agentId)) throw new Error(`Duplicate swarm agent ${agentId}`);
    const normalizedSkills = uniqueTexts(skills, "agent.skills", 100);
    if (normalizedSkills.length === 0) throw new Error("A swarm agent requires skills");
    const agent = {
      schema: SWARM_AGENT_SCHEMA,
      version: HOLOGRAPHIC_SWARM_VERSION,
      id: agentId,
      skills: normalizedSkills,
      experiences: [],
      identity: jsonObject(identity, "agent.identity"),
      energy: boundedNumber(energy, 0, 1_000_000, "agent.energy"),
      initialEnergy: boundedNumber(energy, 0.01, 1_000_000, "agent.energy"),
      reputation: 0.5,
      completedTasks: 0,
      failedTasks: 0,
      activeTaskId: null,
      memoryVector: this.memory.agentVector({ skills: normalizedSkills })
    };
    this.agents.set(agentId, agent);
    this.#recordEnergy(agentId, agent.energy, "initial-endowment", null);
    return publicAgent(agent);
  }

  addTask(task, { cycle = 0 } = {}) {
    const added = this.graph.addTask(task);
    this.field.deposit({
      kind: "task-available",
      targetTaskId: added.id,
      payload: {
        objectiveDigest: digestResearchValue(added.objective),
        tags: added.tags,
        reward: added.reward
      },
      intensity: Math.min(1, Math.max(0.1, added.reward / 10)),
      confidence: 1,
      decayRate: 0.03,
      depositedAtCycle: cycle,
      ttlCycles: 100
    });
    return added;
  }

  bids({ cycle = 0 } = {}) {
    return rankHolographicBids({
      memory: this.memory,
      agents: [...this.agents.values()],
      tasks: this.graph.openTasks(),
      pheromones: this.field.events,
      cycle,
      claimCost: this.claimCost,
      policy: this.policy,
      attempts: this.assignments
    });
  }

  selfOrganize({ cycle = 0, maximumAssignments = Number.MAX_SAFE_INTEGER } = {}) {
    const limit = boundedInteger(
      maximumAssignments,
      1,
      Number.MAX_SAFE_INTEGER,
      "maximumAssignments"
    );
    const assignments = [];
    const assignedAgents = new Set();
    const assignedTasks = new Set();
    for (const bid of this.bids({ cycle })) {
      if (assignments.length >= limit) break;
      if (assignedAgents.has(bid.agentId) || assignedTasks.has(bid.taskId)) continue;
      const agent = this.agents.get(bid.agentId);
      this.graph.claim(bid.taskId, bid.agentId);
      agent.activeTaskId = bid.taskId;
      agent.energy -= this.claimCost;
      this.#recordEnergy(bid.agentId, -this.claimCost, "task-claim", bid.taskId);
      this.field.deposit({
        kind: "task-claimed",
        sourceAgentId: bid.agentId,
        targetTaskId: bid.taskId,
        payload: { bidScore: bid.score },
        intensity: 0.8,
        confidence: 1,
        polarity: "repel",
        decayRate: 0.25,
        depositedAtCycle: cycle,
        ttlCycles: 4
      });
      assignments.push(structuredClone(bid));
      this.assignments.push({
        cycle,
        taskId: bid.taskId,
        agentId: bid.agentId,
        bidScore: bid.score
      });
      assignedAgents.add(bid.agentId);
      assignedTasks.add(bid.taskId);
    }
    return assignments;
  }

  recordPartialProgress({
    cycle,
    taskId,
    agentId,
    confidence,
    resultRefs = []
  }) {
    const agent = this.#activeAgent(agentId, taskId);
    const normalizedConfidence = boundedNumber(confidence, 0, 1, "confidence");
    const task = this.graph.progress(taskId, { agentId, resultRefs });
    const reward = task.reward * normalizedConfidence *
      this.policy["energy.partialProgressReward"];
    agent.energy += reward;
    agent.activeTaskId = null;
    this.#recordEnergy(agentId, reward, "partial-progress-reward", taskId);
    this.field.deposit({
      kind: "partial-progress",
      sourceAgentId: agentId,
      targetTaskId: taskId,
      payload: { resultRefs: task.resultRefs, confidence: normalizedConfidence },
      intensity: this.policy["pheromone.partialProgressIntensity"],
      confidence: normalizedConfidence,
      decayRate: this.policy["pheromone.successDecay"],
      depositedAtCycle: cycle,
      ttlCycles: 20,
      evidenceRefs: task.resultRefs
    });
    const outcome = {
      taskId,
      agentId,
      status: "progressed",
      confidence: normalizedConfidence,
      reward,
      resultRefs: task.resultRefs
    };
    this.outcomes.push(outcome);
    return structuredClone(outcome);
  }

  recordVerifiedOutcome({
    cycle,
    taskId,
    agentId,
    verifierScore,
    resultRefs,
    learnedSkills = []
  }) {
    const agent = this.#activeAgent(agentId, taskId);
    const task = this.graph.complete(taskId, { agentId, verifierScore, resultRefs });
    const reward = task.reward * task.verifierScore;
    agent.energy += reward;
    agent.reputation = Math.min(1, agent.reputation + (0.1 * task.verifierScore));
    agent.completedTasks += 1;
    agent.activeTaskId = null;
    agent.experiences.push(task.objective, ...uniqueTexts(learnedSkills, "learnedSkills", 100));
    agent.memoryVector = this.memory.agentVector({
      skills: agent.skills,
      experiences: agent.experiences
    });
    this.#recordEnergy(agentId, reward, "verified-reward", taskId);
    this.field.deposit({
      kind: "verified-knowledge",
      sourceAgentId: agentId,
      targetTaskId: taskId,
      payload: { resultRefs: task.resultRefs, verifierScore: task.verifierScore },
      intensity: task.verifierScore,
      confidence: task.verifierScore,
      decayRate: 0.02,
      depositedAtCycle: cycle,
      ttlCycles: 100,
      evidenceRefs: task.resultRefs
    });
    const outcome = {
      taskId,
      agentId,
      status: "completed",
      verifierScore: task.verifierScore,
      reward,
      resultRefs: task.resultRefs
    };
    this.outcomes.push(outcome);
    return structuredClone(outcome);
  }

  recordFailedOutcome({ cycle, taskId, agentId, resultRefs = [] }) {
    const agent = this.#activeAgent(agentId, taskId);
    const task = this.graph.fail(taskId, { agentId, resultRefs });
    agent.reputation = Math.max(0, agent.reputation - 0.1);
    agent.failedTasks += 1;
    agent.activeTaskId = null;
    this.field.deposit({
      kind: "failed-approach",
      sourceAgentId: agentId,
      targetTaskId: taskId,
      payload: { resultRefs: task.resultRefs },
      intensity: 0.8,
      confidence: 1,
      polarity: "repel",
      decayRate: 0.12,
      depositedAtCycle: cycle,
      ttlCycles: 20,
      evidenceRefs: task.resultRefs
    });
    const outcome = { taskId, agentId, status: "failed", resultRefs: task.resultRefs };
    this.outcomes.push(outcome);
    return structuredClone(outcome);
  }

  snapshot({ cycle = 0 } = {}) {
    const state = {
      schema: SWARM_KERNEL_SCHEMA,
      version: HOLOGRAPHIC_SWARM_VERSION,
      missionId: this.missionId,
      cycle,
      policy: structuredClone(this.policy),
      taskGraph: this.graph.snapshot(),
      pheromoneField: this.field.snapshot({ cycle }),
      agents: [...this.agents.values()].map(publicAgent),
      assignments: structuredClone(this.assignments),
      energyEvents: structuredClone(this.energyEvents),
      outcomes: structuredClone(this.outcomes)
    };
    return { ...state, digest: digestResearchValue(state) };
  }

  #activeAgent(agentId, taskId) {
    const agent = this.agents.get(requiredId(agentId, "agentId"));
    if (!agent) throw new Error(`Unknown swarm agent ${agentId}`);
    if (agent.activeTaskId !== taskId) {
      throw new Error(`Agent ${agentId} is not working on swarm task ${taskId}`);
    }
    return agent;
  }

  #recordEnergy(agentId, amount, reason, taskId) {
    this.energyEvents.push({
      id: `energy-${String(this.energyEvents.length + 1).padStart(5, "0")}`,
      agentId,
      amount,
      reason,
      taskId
    });
  }
}

export function rankHolographicBids({
  memory = new HolographicMemory(),
  agents,
  tasks,
  pheromones = [],
  cycle = 0,
  claimCost = 0,
  policy = DEFAULT_ORGANISM_POLICY,
  attempts = [],
  worldEntries = [],
  worldBoardDigest = null,
  worldEncoderDigest = null,
  worldRoleBasisDigest = null
}) {
  if (!(memory instanceof HolographicMemory)) {
    throw new Error("rankHolographicBids requires HolographicMemory");
  }
  const currentCycle = boundedInteger(cycle, 0, Number.MAX_SAFE_INTEGER, "cycle");
  const minimumEnergy = boundedNumber(claimCost, 0, 1_000_000, "claimCost");
  const normalizedPolicy = normalizeOrganismPolicy(policy);
  if (
    !Array.isArray(agents) ||
    !Array.isArray(tasks) ||
    !Array.isArray(pheromones) ||
    !Array.isArray(attempts) ||
    !Array.isArray(worldEntries)
  ) {
    throw new Error("Holographic bidding requires agent, task, pheromone, attempt, and world-entry arrays");
  }
  const world = new HolographicWorldModel({
    memory,
    entries: worldEntries,
    boardDigest: worldBoardDigest,
    encoderDigest: worldEncoderDigest,
    roleBasisDigest: worldRoleBasisDigest
  });
  const worldMemory = world.snapshot();
  const bids = [];
  for (const agent of agents) {
    if (agent.activeTaskId !== null && agent.activeTaskId !== undefined) continue;
    if (Number(agent.energy) < minimumEnergy) continue;
    const initialEnergy = boundedNumber(
      agent.initialEnergy ?? agent.energy,
      0.01,
      1_000_000,
      "agent.initialEnergy"
    );
    const energyFactor = Math.min(1, Number(agent.energy) / initialEnergy);
    const reputation = boundedNumber(agent.reputation ?? 0.5, 0, 1, "agent.reputation");
    const agentVector = Array.isArray(agent.memoryVector)
      ? validVector(agent.memoryVector, memory.dimension, "agent.memoryVector")
      : memory.agentVector({
          skills: uniqueTexts(agent.skills, "agent.skills", 100),
          experiences: uniqueTexts(agent.experiences || [], "agent.experiences", 1_000)
        });
    for (const task of tasks) {
      const taskVector = memory.taskVector(task);
      const worldContext = worldEntries.length > 0
        ? world.project(
            [task.objective, ...(task.requirements || []), ...(task.tags || [])].join("\n"),
            { limit: Math.min(8, worldEntries.length) }
          )
        : [];
      const similarity = memory.similarity(agentVector, taskVector);
      const affinity = Math.max(0, (similarity + 1) / 2);
      const sensed = pheromones
        .filter((event) => event.targetTaskId === null || event.targetTaskId === task.id)
        .map((event) => sensedPheromone(event, currentCycle))
        .filter((event) => event !== null);
      const pheromoneSignal = sensed.reduce((sum, event) => {
        if (
          event.kind === "failed-approach" &&
          event.sourceAgentId !== null &&
          event.sourceAgentId !== agent.id
        ) {
          return sum + (event.signal * 0.25);
        }
        return sum + event.signal;
      }, 0);
      const attraction = Math.max(0, 1 + pheromoneSignal);
      const taskAttempts = attempts.filter((attempt) => attempt.taskId === task.id);
      const repetitionCount = taskAttempts.filter((attempt) => attempt.agentId === agent.id).length;
      const previousAgentId = taskAttempts.at(-1)?.agentId ?? null;
      const repetitionPenalty = (1 + repetitionCount) **
        normalizedPolicy["bid.repetitionPenalty"];
      const challengerBoost = previousAgentId !== null && previousAgentId !== agent.id
        ? 1 + normalizedPolicy["retry.challengerExploration"]
        : 1;
      const score =
        (Math.max(0.001, affinity) ** normalizedPolicy["bid.affinityWeight"]) *
        (Math.max(0.001, attraction) ** normalizedPolicy["bid.pheromoneWeight"]) *
        (Math.max(0.001, energyFactor) ** normalizedPolicy["bid.energyWeight"]) *
        (Math.max(0.001, 0.5 + reputation) ** normalizedPolicy["bid.reputationWeight"]) *
        challengerBoost /
        repetitionPenalty;
      bids.push({
        agentId: requiredId(agent.id, "agent.id"),
        taskId: requiredId(task.id, "task.id"),
        score,
        affinity,
        pheromoneSignal,
        energyFactor,
        reputation,
        repetitionCount,
        challengerBoost,
        worldContext,
        worldMemoryDigest: worldMemory.digest
      });
    }
  }
  return bids.sort((left, right) =>
    right.score - left.score ||
    left.agentId.localeCompare(right.agentId) ||
    left.taskId.localeCompare(right.taskId)
  );
}

function sensedPheromone(event, cycle) {
  const age = cycle - event.depositedAtCycle;
  if (age < 0 || age >= event.ttlCycles) return null;
  const currentIntensity = event.intensity * Math.exp(-event.decayRate * age);
  const direction = event.polarity === "attract" ? 1 : -1;
  return {
    ...structuredClone(event),
    age,
    currentIntensity,
    signal: direction * currentIntensity * event.confidence
  };
}

function publicAgent(agent) {
  return structuredClone({
    schema: agent.schema,
    version: agent.version,
    id: agent.id,
    skills: agent.skills,
    experiences: agent.experiences,
    identity: agent.identity,
    energy: agent.energy,
    initialEnergy: agent.initialEnergy,
    reputation: agent.reputation,
    completedTasks: agent.completedTasks,
    failedTasks: agent.failedTasks,
    activeTaskId: agent.activeTaskId,
    memoryDigest: digestResearchValue(agent.memoryVector)
  });
}

function approximateInverse(vector) {
  return vector.map((_, index) => vector[(vector.length - index) % vector.length]);
}

function normalizeVector(vector, dimension) {
  const valid = validVector(vector, dimension, "vector");
  const magnitude = Math.sqrt(valid.reduce((sum, value) => sum + (value * value), 0));
  if (magnitude === 0) return new Array(dimension).fill(0);
  return valid.map((value) => value / magnitude);
}

function validVector(vector, dimension, label) {
  if (!Array.isArray(vector) || vector.length !== dimension) {
    throw new Error(`${label} must contain exactly ${dimension} dimensions`);
  }
  return vector.map((value) => {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite value`);
    return value;
  });
}

function optionalSha256(value, label) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function tokenize(text) {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) || [])];
}

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value);
}

function uniqueTexts(values, label, maximum) {
  if (!Array.isArray(values) || values.length > maximum) {
    throw new Error(`${label} must be an array with no more than ${maximum} entries`);
  }
  return [...new Set(values.map((value, index) =>
    requiredText(value, `${label}[${index}]`, 20_000)
  ))];
}

function uniqueIds(values, label, maximum) {
  if (!Array.isArray(values) || values.length > maximum) {
    throw new Error(`${label} must be an array with no more than ${maximum} entries`);
  }
  return [...new Set(values.map((value, index) =>
    requiredId(value, `${label}[${index}]`)
  ))];
}

function requiredText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function requiredId(value, label) {
  const id = requiredText(value, label, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
}

function optionalId(value, label) {
  return value === null || value === undefined || value === ""
    ? null
    : requiredId(value, label);
}

function boundedInteger(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function boundedNumber(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a number from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`${label} is unsupported`);
  return value;
}

export const holographicSwarmInternals = Object.freeze({
  TASK_STATUSES
});
