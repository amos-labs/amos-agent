import { performance } from "node:perf_hooks";
import { DualChannelHolographicWorld } from "./dualChannelHolographicWorld.js";
import { digestResearchValue } from "./experimentProtocol.js";
import { UnitaryHolographicMemory } from "./holographicWorldV2.js";
import { holographicWorldV2ExperimentInternals } from
  "./holographicWorldV2Experiment.js";

export const DUAL_CHANNEL_EXPERIMENT_SCHEMA =
  "amos.holographic-world-dual-channel-experiment";
export const DUAL_CHANNEL_RESULT_SCHEMA =
  "amos.holographic-world-dual-channel-experiment-result";

const NEGATIVE_FAMILIES = [
  "negation",
  "proposed-vs-recorded",
  "superseded-vs-current",
  "forged-receipt",
  "missing-receipt"
];

export function runDualChannelHolographicExperiment(input) {
  const contract = validateDualChannelExperimentContract(input);
  const rows = [];
  for (const dimension of contract.fixture.dimensions) {
    for (const size of contract.fixture.sizes) {
      const fixtures = holographicWorldV2ExperimentInternals.buildFixtures(contract, size);
      const evaluated = fixtures.slice(0, Math.min(size, contract.fixture.evaluationLimit));
      const negatives = evaluated.flatMap((entry) =>
        holographicWorldV2ExperimentInternals.hardNegatives(entry)
      );
      const memory = new UnitaryHolographicMemory({
        dimension,
        namespace: `${contract.seed}:${dimension}:${size}`
      });
      const world = new DualChannelHolographicWorld({
        memory,
        semanticFillerMode: "unitary",
        identityThreshold: contract.channels.identity.threshold
      });
      for (const entry of fixtures) world.observe(entry);
      rows.push(evaluateWorld({ contract, world, fixtures, evaluated, negatives }));
    }
  }
  const gate = evaluateGate(contract, rows);
  const stableEvidence = {
    schema: DUAL_CHANNEL_RESULT_SCHEMA,
    version: 1,
    experimentId: contract.id,
    contractDigest: digestResearchValue(contract),
    seed: contract.seed,
    rows: rows.map(({ meanLatencyMicros: _timing, ...row }) => row),
    gate
  };
  return {
    ...stableEvidence,
    claimBoundary: contract.claimBoundary,
    isolation: structuredClone(contract.isolation),
    rows,
    evidenceDigest: digestResearchValue(stableEvidence)
  };
}

export function validateDualChannelExperimentContract(input) {
  const contract = structuredClone(input);
  if (!contract || contract.schema !== DUAL_CHANNEL_EXPERIMENT_SCHEMA ||
      contract.version !== 1 || contract.status !== "development-visible") {
    throw new Error("Unsupported dual-channel holographic experiment contract");
  }
  for (const field of ["id", "claimBoundary", "seed"]) requiredText(contract[field], field);
  for (const field of ["sizes", "dimensions"]) {
    if (!Array.isArray(contract.fixture?.[field]) || contract.fixture[field].length === 0) {
      throw new Error(`fixture.${field} is required`);
    }
  }
  for (const size of contract.fixture.sizes) boundedInteger(size, 1, 10_000, "fixture size");
  for (const dimension of contract.fixture.dimensions) {
    boundedInteger(dimension, 16, 4_096, "fixture dimension");
    if ((dimension & (dimension - 1)) !== 0) throw new Error("fixture dimensions must be powers of two");
  }
  boundedInteger(contract.fixture.evaluationLimit, 1, 1_000, "evaluationLimit");
  if (contract.fixture.hardNegativeFamilies.join("|") !== NEGATIVE_FAMILIES.join("|")) {
    throw new Error("The frozen hard-negative families changed");
  }
  if (contract.channels?.identity?.authorityEligible !== true ||
      contract.channels?.semantic?.authorityEligible !== false ||
      contract.channels.identity.worldVectorPolicy !== "raw-sum-never-project") {
    throw new Error("Dual-channel authority boundary changed");
  }
  boundedNumber(contract.channels.identity.threshold, -10, 10, "identity threshold");
  const gate = contract.promotionGate;
  if (!contract.fixture.sizes.includes(gate?.fixtureSize) ||
      !contract.fixture.dimensions.includes(gate?.dimension)) {
    throw new Error("Promotion gate must select a declared size and dimension");
  }
  for (const [key, value] of Object.entries({
    minimumExactPositiveRate: gate.minimumExactPositiveRate,
    maximumExactFalsePositiveRate: gate.maximumExactFalsePositiveRate,
    maximumPerFamilyFalsePositiveRate: gate.maximumPerFamilyFalsePositiveRate,
    minimumSemanticParaphraseTop5Rate: gate.minimumSemanticParaphraseTop5Rate,
    maximumAuthorityLeakRate: gate.maximumAuthorityLeakRate,
    minimumCleanupScanReduction: gate.minimumCleanupScanReduction
  })) boundedNumber(value, 0, 1, `promotionGate.${key}`);
  if (!contract.isolation || contract.isolation.harbor !== false ||
      contract.isolation.liveSwarm !== false || contract.isolation.qwen !== false ||
      contract.isolation.organismPolicyUpdates !== false ||
      contract.isolation.exactEntriesRemainAuthoritative !== true) {
    throw new Error("Dual-channel experiment isolation boundary changed");
  }
  return contract;
}

function evaluateWorld({ contract, world, fixtures, evaluated, negatives }) {
  const timings = [];
  const positives = evaluated.map((entry) => {
    const result = timedRetrieve(world, query(entry), timings);
    return {
      accepted: result.identity.present &&
        result.identity.matches.some(({ id }) => id === entry.id),
      score: result.identity.presenceScore,
      scanned: result.identity.scanned
    };
  });
  const negativeRuns = negatives.map(({ family, sourceId, query: negativeQuery }) => {
    const result = timedRetrieve(world, negativeQuery, timings);
    return {
      family,
      sourceId,
      falsePositive: result.identity.present,
      authorityLeak: result.authorized,
      score: result.identity.presenceScore,
      scanned: result.identity.scanned
    };
  });
  const paraphrases = evaluated.map((entry) => {
    const result = timedRetrieve(world, {
      ...query(entry),
      text: paraphrase(entry)
    }, timings);
    return {
      top1: result.semantic.results[0]?.id === entry.id,
      top5: result.semantic.results.some(({ id }) => id === entry.id),
      authorityLeak: result.authorized,
      scanned: result.semantic.scanned
    };
  });
  const hardNegativeFamilies = Object.fromEntries(NEGATIVE_FAMILIES.map((family) => {
    const selected = negativeRuns.filter((run) => run.family === family);
    return [family, {
      count: selected.length,
      falsePositiveRate: rate(selected, ({ falsePositive }) => falsePositive),
      authorityLeakRate: rate(selected, ({ authorityLeak }) => authorityLeak),
      meanScore: mean(selected.map(({ score }) => score))
    }];
  }));
  const semanticMeanScanned = mean(paraphrases.map(({ scanned }) => scanned));
  return {
    fixtureSize: fixtures.length,
    evaluatedEntries: evaluated.length,
    dimension: world.memory.dimension,
    exactPositiveRate: rate(positives, ({ accepted }) => accepted),
    exactPositiveMeanScore: mean(positives.map(({ score }) => score)),
    exactFalsePositiveRate: rate(negativeRuns, ({ falsePositive }) => falsePositive),
    exactNegativeMeanScore: mean(negativeRuns.map(({ score }) => score)),
    hardNegativeFamilies,
    semanticParaphraseTop1Rate: rate(paraphrases, ({ top1 }) => top1),
    semanticParaphraseTop5Rate: rate(paraphrases, ({ top5 }) => top5),
    authorityLeakRate: rate(
      [...negativeRuns, ...paraphrases],
      ({ authorityLeak }) => authorityLeak
    ),
    meanIdentityItemsScanned: mean([
      ...positives.map(({ scanned }) => scanned),
      ...negativeRuns.map(({ scanned }) => scanned)
    ]),
    meanSemanticItemsScanned: semanticMeanScanned,
    cleanupScanReduction: 1 - (semanticMeanScanned / fixtures.length),
    meanLatencyMicros: mean(timings),
    representationDigest: world.snapshot().digest,
    threshold: contract.channels.identity.threshold
  };
}

function evaluateGate(contract, rows) {
  const gate = contract.promotionGate;
  const row = rows.find(({ fixtureSize, dimension }) =>
    fixtureSize === gate.fixtureSize && dimension === gate.dimension
  );
  if (!row) throw new Error("Dual-channel promotion row is missing");
  const checks = {
    exactPositiveRate: row.exactPositiveRate >= gate.minimumExactPositiveRate,
    exactFalsePositiveRate:
      row.exactFalsePositiveRate <= gate.maximumExactFalsePositiveRate,
    everyHardNegativeFamily: Object.values(row.hardNegativeFamilies).every(
      ({ falsePositiveRate }) =>
        falsePositiveRate <= gate.maximumPerFamilyFalsePositiveRate
    ),
    semanticParaphraseTop5Rate:
      row.semanticParaphraseTop5Rate >= gate.minimumSemanticParaphraseTop5Rate,
    authorityLeakRate: row.authorityLeakRate <= gate.maximumAuthorityLeakRate,
    cleanupScanReduction: row.cleanupScanReduction >= gate.minimumCleanupScanReduction
  };
  return {
    passed: Object.values(checks).every(Boolean),
    fixtureSize: gate.fixtureSize,
    dimension: gate.dimension,
    checks
  };
}

function timedRetrieve(world, value, timings) {
  const startedAt = performance.now();
  const result = world.retrieve(value, { limit: 5 });
  timings.push((performance.now() - startedAt) * 1_000);
  return result;
}

function paraphrase(entry) {
  const ordinal = Number(entry.id.split("-").at(-1));
  return `verified ${entry.kind} record for entity ${ordinal} in region ${ordinal % 7} group ${ordinal % 11}`;
}

function query({ kind, text, phase, polarity, receiptStatus }) {
  return { kind, text, phase, polarity, receiptStatus };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rate(values, predicate) {
  return values.length ? values.filter(predicate).length / values.length : 0;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function boundedNumber(value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}`);
  }
}

export const dualChannelHolographicExperimentInternals = Object.freeze({
  evaluateGate,
  paraphrase
});
