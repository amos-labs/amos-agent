#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { DualChannelHolographicWorld } from
  "../src/research/dualChannelHolographicWorld.js";
import {
  HolographicMemory,
  rankHolographicBids
} from "../src/research/holographicSwarmKernel.js";
import { UnitaryHolographicMemory } from "../src/research/holographicWorldV2.js";

const SHADOW_DIMENSION = 4_096;
const SHADOW_SAMPLE_LIMIT = 32;
const ACTIVE_CONTEXT_LIMIT = 8;

export function rankHarborHolographicBids(input, { shadowEnabled = true } = {}) {
  const memory = new HolographicMemory({
    dimension: input.dimension ?? 128,
    namespace: input.namespace ?? "amos-harbor-swarm"
  });
  const bids = rankHolographicBids({
    memory,
    agents: input.agents,
    tasks: input.tasks,
    pheromones: input.pheromones ?? [],
    cycle: input.cycle ?? 0,
    claimCost: input.claimCost ?? 0,
    policy: input.policy,
    attempts: input.attempts ?? [],
    worldEntries: input.worldEntries ?? [],
    worldBoardDigest: input.worldBoardDigest ?? null,
    worldEncoderDigest: input.worldEncoderDigest ?? null,
    worldRoleBasisDigest: input.worldRoleBasisDigest ?? null
  });
  if (input.dualChannelMode === "active") {
    return buildDualChannelActive(input, bids);
  }
  return {
    bids,
    ...(shadowEnabled ? { dualChannelShadow: buildDualChannelShadow(input) } : {})
  };
}

/**
 * Use the dual-channel HRR as a bounded attention and routing surface.
 *
 * Every returned item resolves through the host-provided exact dictionary.
 * Vector similarity may influence attention and specialist affinity, but it
 * can never mint evidence, completion credit, or authority.
 */
export function buildDualChannelActive(input, baseBids) {
  const entries = Array.isArray(input.worldEntries) ? input.worldEntries : [];
  const { world, memory } = createDualChannelWorld(input, ":dual-active-v1");
  const safety = evaluateSafety(world, entries);
  const tasks = new Map((input.tasks ?? []).map((task) => [task.id, task]));
  const agents = new Map((input.agents ?? []).map((agent) => [agent.id, agent]));
  const taskContexts = new Map();
  for (const task of tasks.values()) {
    taskContexts.set(task.id, activeContext(world, entries, taskQuery(task)));
  }
  const affinityWeight = finitePolicyWeight(input.policy?.["bid.affinityWeight"], 1);
  const bids = baseBids.map((bid) => {
    const task = tasks.get(bid.taskId) || {};
    const agent = agents.get(bid.agentId) || {};
    const worldContext = taskContexts.get(bid.taskId) || [];
    const holographicWorldAffinity = agentWorldAffinity({
      memory,
      agent,
      task,
      worldContext
    });
    const baseAffinity = boundedAffinity(bid.affinity);
    const affinity = boundedAffinity((baseAffinity + holographicWorldAffinity) / 2);
    const score = bid.score * ((affinity / Math.max(0.001, baseAffinity)) ** affinityWeight);
    return {
      ...bid,
      score,
      affinity,
      baseAffinity,
      holographicWorldAffinity,
      worldContext,
      worldMemoryDigest: safety.representationDigest,
      worldBehaviorInfluence: true,
      worldAuthorityGranted: false
    };
  }).sort((left, right) =>
    right.score - left.score ||
    left.agentId.localeCompare(right.agentId) ||
    left.taskId.localeCompare(right.taskId)
  );
  return {
    bids,
    dualChannelWorld: {
      schema: "amos.holographic-world-dual-channel-active",
      version: 1,
      mode: "bounded-active-retrieval",
      authorityEnabled: false,
      behaviorInfluence: true,
      dimension: SHADOW_DIMENSION,
      representedEntries: entries.length,
      evaluatedEntries: safety.evaluatedEntries,
      exactPositiveRate: safety.exactPositiveRate,
      exactFalsePositiveRate: safety.exactFalsePositiveRate,
      authorityLeakRate: safety.authorityLeakRate,
      falsePositiveByFamily: safety.falsePositiveByFamily,
      retrievals: [...taskContexts.entries()].map(([taskId, context]) => ({
        taskId,
        proposedEntryIds: context.map(({ id }) => id),
        exactDictionaryResolved: true,
        authorityGranted: false
      })),
      representationDigest: safety.representationDigest
    }
  };
}

export function buildDualChannelShadow(input) {
  const entries = Array.isArray(input.worldEntries) ? input.worldEntries : [];
  const { world } = createDualChannelWorld(input, ":dual-shadow-v1");
  const safety = evaluateSafety(world, entries);
  const semanticTaskObservations = (input.tasks ?? []).flatMap((task) =>
    [...new Set(entries.map(({ kind }) => kind))].sort().map((kind) => {
      const result = world.retrieve({
        kind,
        text: task.objective,
        phase: "recorded",
        polarity: "positive",
        receiptStatus: "verified"
      }, { limit: 3 });
      return {
        taskId: task.id,
        kind,
        semanticPresenceScore: result.semantic.presenceScore,
        semanticItemsScanned: result.semantic.scanned,
        proposedEntryIds: result.semantic.results.map(({ id }) => id),
        exactAuthorityGranted: result.authorized
      };
    })
  );
  return {
    schema: "amos.holographic-world-dual-channel-shadow",
    version: 1,
    mode: "read-only-shadow",
    authorityEnabled: false,
    behaviorInfluence: false,
    dimension: SHADOW_DIMENSION,
    representedEntries: entries.length,
    evaluatedEntries: safety.evaluatedEntries,
    exactPositiveRate: safety.exactPositiveRate,
    exactFalsePositiveRate: safety.exactFalsePositiveRate,
    authorityLeakRate: safety.authorityLeakRate,
    falsePositiveByFamily: safety.falsePositiveByFamily,
    semanticTaskObservations,
    representationDigest: safety.representationDigest
  };
}

function createDualChannelWorld(input, namespaceSuffix) {
  const entries = Array.isArray(input.worldEntries) ? input.worldEntries : [];
  const memory = new UnitaryHolographicMemory({
    dimension: SHADOW_DIMENSION,
    namespace: `${input.namespace ?? "amos-harbor-swarm"}${namespaceSuffix}`
  });
  const world = new DualChannelHolographicWorld({
    memory,
    identityThreshold: 0.5,
    boardDigest: input.worldBoardDigest ?? null
  });
  for (const entry of entries) {
    world.observe({
      ...entry,
      phase: "recorded",
      polarity: "positive",
      receiptStatus: "verified"
    });
  }
  return { world, memory };
}

function evaluateSafety(world, entries) {
  const sample = entries.slice(0, SHADOW_SAMPLE_LIMIT);
  const positives = sample.map((entry) => world.identitySearch(shadowQuery(entry)));
  const negatives = sample.flatMap((entry) => shadowNegatives(entry)
    .map(({ family, query }) => ({ family, result: world.retrieve(query, { limit: 3 }) }))
  );
  const falsePositiveByFamily = Object.fromEntries(
    ["negation", "proposed-vs-recorded", "forged-receipt", "missing-receipt"]
      .map((family) => {
        const selected = negatives.filter((negative) => negative.family === family);
        return [family, rate(selected, ({ result }) => result.identity.present)];
      })
  );
  return {
    evaluatedEntries: sample.length,
    exactPositiveRate: rate(
      positives,
      ({ present, matches }) => present && matches.length > 0
    ),
    exactFalsePositiveRate: rate(negatives, ({ result }) => result.identity.present),
    authorityLeakRate: rate(negatives, ({ result }) => result.authorized),
    falsePositiveByFamily,
    representationDigest: world.snapshot().digest
  };
}

function activeContext(world, entries, text) {
  const candidates = [...new Set(entries.map(({ kind }) => kind))].flatMap((kind) =>
    world.retrieve({
      kind,
      text,
      phase: "recorded",
      polarity: "positive",
      receiptStatus: "verified"
    }, { limit: 3 }).semantic.results.map((entry) => ({
      ...entry,
      retrievalArm: "unitary-fft-true-hologram",
      authorityGranted: false
    }))
  );
  const unique = new Map();
  for (const entry of candidates) {
    const previous = unique.get(entry.id);
    if (!previous || entry.similarity > previous.similarity) unique.set(entry.id, entry);
  }
  return [...unique.values()]
    .sort((left, right) =>
      right.similarity - left.similarity || left.id.localeCompare(right.id)
    )
    .slice(0, ACTIVE_CONTEXT_LIMIT);
}

function taskQuery(task) {
  return [task.objective, ...(task.requirements || []), ...(task.tags || [])]
    .filter(Boolean)
    .join("\n");
}

function agentWorldAffinity({ memory, agent, task, worldContext }) {
  const agentText = [
    agent.identity,
    ...(agent.skills || []),
    ...(agent.experiences || [])
  ].filter(Boolean).join("\n");
  const taskText = [taskQuery(task), ...worldContext.map(({ text }) => text)]
    .filter(Boolean).join("\n");
  if (!agentText || !taskText) return 0.5;
  return boundedAffinity((memory.similarity(
    memory.encode(agentText, { mode: "l2" }),
    memory.encode(taskText, { mode: "l2" })
  ) + 1) / 2);
}

function boundedAffinity(value) {
  return Math.max(0.001, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0.5));
}

function finitePolicyWeight(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function shadowQuery({ kind, text }) {
  return {
    kind,
    text,
    phase: "recorded",
    polarity: "positive",
    receiptStatus: "verified"
  };
}

function shadowNegatives(entry) {
  const base = shadowQuery(entry);
  return [
    { family: "negation", query: { ...base, polarity: "negative" } },
    { family: "proposed-vs-recorded", query: { ...base, phase: "proposed" } },
    { family: "forged-receipt", query: { ...base, receiptStatus: "forged" } },
    { family: "missing-receipt", query: { ...base, receiptStatus: "missing" } }
  ];
}

function rate(values, predicate) {
  return values.length === 0 ? 0 : values.filter(predicate).length / values.length;
}

async function readStandardInput() {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const input = JSON.parse(await readStandardInput());
  process.stdout.write(`${JSON.stringify(rankHarborHolographicBids(input))}\n`);
}
