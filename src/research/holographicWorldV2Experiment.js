import { performance } from "node:perf_hooks";
import { digestResearchValue } from "./experimentProtocol.js";
import {
  HolographicMemory,
  HolographicWorldModel
} from "./holographicSwarmKernel.js";
import {
  HolographicWorldV2,
  UnitaryHolographicMemory
} from "./holographicWorldV2.js";

export const HOLOGRAPHIC_WORLD_V2_EXPERIMENT_SCHEMA =
  "amos.holographic-world-v2-experiment";
export const HOLOGRAPHIC_WORLD_V2_RESULT_SCHEMA =
  "amos.holographic-world-v2-experiment-result";

const EXPECTED_ARMS = new Set([
  "deterministic-hrr-v1-item-memory",
  "unitary-fft-item-memory",
  "unitary-fft-true-hologram"
]);

/**
 * Run the frozen, model-free HRR-v2 stress experiment.
 *
 * This is deliberately disconnected from Harbor, Qwen, the live swarm, and
 * organism policy updates. It tests only vector algebra and lossy retrieval;
 * exact fixture entries remain the sole source of truth.
 */
export function runHolographicWorldV2Experiment(input) {
  const contract = validateExperimentContract(input);
  const rows = [];
  for (const size of contract.fixture.sizes) {
    const fixtures = buildFixtures(contract, size);
    const negatives = fixtures.flatMap((entry) => hardNegatives(entry));
    const legacyArm = arm(contract, "deterministic-hrr-v1-item-memory");
    const itemArm = arm(contract, "unitary-fft-item-memory");
    const hologramArm = arm(contract, "unitary-fft-true-hologram");

    const legacy = buildLegacyWorld({
      contract,
      fixtures,
      dimension: legacyArm.dimension,
      size
    });
    const unitary = buildUnitaryWorld({
      contract,
      fixtures,
      dimension: itemArm.dimension,
      fillerMode: itemArm.fillerMode,
      size
    });
    if (itemArm.dimension !== hologramArm.dimension ||
        itemArm.fillerMode !== hologramArm.fillerMode) {
      throw new Error("HRR-v2 item and hologram arms must share dimension and filler mode");
    }

    rows.push(evaluateArm({
      id: legacyArm.id,
      size,
      dimension: legacyArm.dimension,
      fixtures,
      negatives,
      threshold: contract.hardNegativeThreshold,
      representationDigest: legacy.snapshot().representationDigest,
      search: (query) => {
        const startedAt = performance.now();
        const results = legacy.project(query.text, { limit: 5 });
        return {
          latencyMicros: (performance.now() - startedAt) * 1_000,
          score: results[0]?.similarity ?? Number.NEGATIVE_INFINITY,
          scanned: fixtures.length,
          results
        };
      }
    }));
    rows.push(evaluateArm({
      id: itemArm.id,
      size,
      dimension: itemArm.dimension,
      fixtures,
      negatives,
      threshold: contract.hardNegativeThreshold,
      representationDigest: unitary.snapshot().representationDigest,
      search: (query) => {
        const startedAt = performance.now();
        const result = unitary.itemSearch(query, { limit: 5 });
        return {
          latencyMicros: (performance.now() - startedAt) * 1_000,
          score: result.results[0]?.similarity ?? Number.NEGATIVE_INFINITY,
          scanned: result.scanned,
          results: result.results
        };
      }
    }));
    rows.push(evaluateArm({
      id: hologramArm.id,
      size,
      dimension: hologramArm.dimension,
      fixtures,
      negatives,
      threshold: contract.hardNegativeThreshold,
      representationDigest: unitary.snapshot().representationDigest,
      search: (query) => {
        const startedAt = performance.now();
        const result = unitary.hologramSearch(query, { limit: 5 });
        return {
          latencyMicros: (performance.now() - startedAt) * 1_000,
          score: result.presenceScore,
          scanned: result.scanned,
          results: result.results
        };
      }
    }));
  }

  const gate = evaluatePromotionGate(contract, rows);
  const stableEvidence = {
    schema: HOLOGRAPHIC_WORLD_V2_RESULT_SCHEMA,
    version: 1,
    experimentId: contract.id,
    contractDigest: digestResearchValue(contract),
    seed: contract.seed,
    rows: rows.map(withoutTiming),
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

export function validateExperimentContract(input) {
  const contract = structuredClone(input);
  if (!contract || contract.schema !== HOLOGRAPHIC_WORLD_V2_EXPERIMENT_SCHEMA ||
      contract.version !== 1) {
    throw new Error("Unsupported holographic world v2 experiment contract");
  }
  requiredText(contract.id, "experiment.id");
  requiredText(contract.claimBoundary, "experiment.claimBoundary");
  requiredText(contract.seed, "experiment.seed");
  if (contract.status !== "development-visible") {
    throw new Error("HRR-v2 experiments must remain development-visible");
  }
  if (!Array.isArray(contract.fixture?.sizes) || contract.fixture.sizes.length === 0) {
    throw new Error("Experiment fixture sizes are required");
  }
  for (const size of contract.fixture.sizes) boundedInteger(size, 1, 10_000, "fixture size");
  for (const field of ["kinds", "phases", "polarities", "receiptStatuses"] ) {
    if (!Array.isArray(contract.fixture[field]) || contract.fixture[field].length === 0) {
      throw new Error(`Experiment fixture ${field} are required`);
    }
  }
  if (!Array.isArray(contract.fixture.hardNegativeFamilies) ||
      contract.fixture.hardNegativeFamilies.join("|") !== [
        "negation",
        "proposed-vs-recorded",
        "superseded-vs-current",
        "forged-receipt",
        "missing-receipt"
      ].join("|")) {
    throw new Error("The frozen HRR-v2 hard-negative families changed");
  }
  const arms = new Set((contract.arms || []).map(({ id }) => id));
  if (arms.size !== EXPECTED_ARMS.size ||
      [...EXPECTED_ARMS].some((id) => !arms.has(id))) {
    throw new Error("The frozen HRR-v2 experiment arms changed");
  }
  for (const candidate of contract.arms) {
    boundedInteger(candidate.dimension, 16, 4_096, `${candidate.id}.dimension`);
  }
  const gate = contract.promotionGate;
  if (!gate || gate.arm !== "unitary-fft-true-hologram" ||
      !contract.fixture.sizes.includes(gate.fixtureSize)) {
    throw new Error("The true-hologram promotion gate is required at a declared fixture size");
  }
  for (const [key, value] of Object.entries({
    minimumExactTop1Rate: gate.minimumExactTop1Rate,
    minimumExactTop5Rate: gate.minimumExactTop5Rate,
    maximumHardNegativeFalsePositiveRate: gate.maximumHardNegativeFalsePositiveRate,
    maximumPerFamilyFalsePositiveRate: gate.maximumPerFamilyFalsePositiveRate,
    minimumCleanupScanReduction: gate.minimumCleanupScanReduction
  })) boundedNumber(value, 0, 1, `promotionGate.${key}`);
  boundedNumber(gate.minimumPositiveNegativeGap, -10, 10,
    "promotionGate.minimumPositiveNegativeGap");
  boundedNumber(contract.hardNegativeThreshold, -10, 10, "hardNegativeThreshold");
  if (!contract.isolation || contract.isolation.harbor !== false ||
      contract.isolation.liveSwarm !== false || contract.isolation.qwen !== false ||
      contract.isolation.organismPolicyUpdates !== false ||
      contract.isolation.exactEntriesRemainAuthoritative !== true) {
    throw new Error("HRR-v2 experiment isolation boundary changed");
  }
  return contract;
}

function buildFixtures(contract, size) {
  const { kinds, phases, polarities, receiptStatuses } = contract.fixture;
  return Array.from({ length: size }, (_, index) => {
    const ordinal = index + 1;
    const kind = kinds[index % kinds.length];
    const phase = phases[Math.floor(index / kinds.length) % phases.length];
    const polarity = polarities[
      Math.floor(index / (kinds.length * phases.length)) % polarities.length
    ];
    const receiptStatus = receiptStatuses[index % receiptStatuses.length];
    return {
      id: `entry-${String(ordinal).padStart(4, "0")}`,
      kind,
      phase,
      polarity,
      receiptStatus,
      text: [
        `entity ${ordinal}`,
        `operating signal ${kind}`,
        `cohort ${ordinal % 11}`,
        `region ${ordinal % 7}`,
        `exact record token ${ordinal}`
      ].join(" "),
      evidenceRefs: [`receipt-${String(ordinal).padStart(4, "0")}`],
      verifiedBy: "amos-host-hrr-v2-fixture"
    };
  });
}

function hardNegatives(entry) {
  const base = queryFromEntry(entry);
  return [
    {
      family: "negation",
      sourceId: entry.id,
      query: { ...base, polarity: entry.polarity === "positive" ? "negative" : "positive" }
    },
    {
      family: "proposed-vs-recorded",
      sourceId: entry.id,
      query: { ...base, phase: entry.phase === "recorded" ? "proposed" : "recorded" }
    },
    {
      family: "superseded-vs-current",
      sourceId: entry.id,
      query: { ...base, phase: entry.phase === "superseded" ? "recorded" : "superseded" }
    },
    {
      family: "forged-receipt",
      sourceId: entry.id,
      query: { ...base, receiptStatus: "forged" }
    },
    {
      family: "missing-receipt",
      sourceId: entry.id,
      query: { ...base, receiptStatus: "missing" }
    }
  ];
}

function buildLegacyWorld({ contract, fixtures, dimension, size }) {
  const memory = new HolographicMemory({
    dimension,
    namespace: `${contract.seed}:v1:${size}`
  });
  const world = new HolographicWorldModel({ memory });
  for (const entry of fixtures) {
    world.observe({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      evidenceRefs: entry.evidenceRefs,
      confidence: 1,
      verifiedBy: entry.verifiedBy
    });
  }
  return world;
}

function buildUnitaryWorld({ contract, fixtures, dimension, fillerMode, size }) {
  const memory = new UnitaryHolographicMemory({
    dimension,
    namespace: `${contract.seed}:v2:${size}`
  });
  const world = new HolographicWorldV2({ memory, fillerMode });
  for (const entry of fixtures) world.observe(entry);
  return world;
}

function evaluateArm({
  id,
  size,
  dimension,
  fixtures,
  negatives,
  threshold,
  representationDigest,
  search
}) {
  const positiveRuns = fixtures.map((entry) => {
    const result = search(queryFromEntry(entry));
    return {
      exactTop1: result.results[0]?.id === entry.id,
      exactTop5: result.results.some(({ id: resultId }) => resultId === entry.id),
      score: finiteScore(result.score),
      scanned: result.scanned,
      latencyMicros: result.latencyMicros
    };
  });
  const negativeRuns = negatives.map(({ family, sourceId, query }) => {
    const result = search(query);
    const score = finiteScore(result.score);
    return {
      family,
      sourceId,
      score,
      falsePositive: score >= threshold,
      scanned: result.scanned,
      latencyMicros: result.latencyMicros
    };
  });
  const familyMetrics = Object.fromEntries(
    [...new Set(negativeRuns.map(({ family }) => family))].map((family) => {
      const runs = negativeRuns.filter((run) => run.family === family);
      return [family, {
        count: runs.length,
        meanScore: mean(runs.map(({ score }) => score)),
        falsePositiveRate: rate(runs, ({ falsePositive }) => falsePositive)
      }];
    })
  );
  const positiveMeanScore = mean(positiveRuns.map(({ score }) => score));
  const negativeMeanScore = mean(negativeRuns.map(({ score }) => score));
  const allRuns = [...positiveRuns, ...negativeRuns];
  return {
    arm: id,
    fixtureSize: size,
    dimension,
    positiveCount: positiveRuns.length,
    negativeCount: negativeRuns.length,
    exactTop1Rate: rate(positiveRuns, ({ exactTop1 }) => exactTop1),
    exactTop5Rate: rate(positiveRuns, ({ exactTop5 }) => exactTop5),
    positiveMeanScore,
    negativeMeanScore,
    positiveNegativeGap: positiveMeanScore - negativeMeanScore,
    hardNegativeFalsePositiveRate: rate(
      negativeRuns,
      ({ falsePositive }) => falsePositive
    ),
    hardNegativeFamilies: familyMetrics,
    meanLatencyMicros: mean(allRuns.map(({ latencyMicros }) => latencyMicros)),
    meanItemsScanned: mean(allRuns.map(({ scanned }) => scanned)),
    representationDigest
  };
}

function evaluatePromotionGate(contract, rows) {
  const gate = contract.promotionGate;
  const candidate = rows.find(({ arm: id, fixtureSize }) =>
    id === gate.arm && fixtureSize === gate.fixtureSize
  );
  const control = rows.find(({ arm: id, fixtureSize }) =>
    id === "unitary-fft-item-memory" && fixtureSize === gate.fixtureSize
  );
  if (!candidate || !control) throw new Error("Promotion gate rows are missing");
  const cleanupScanReduction = control.meanItemsScanned === 0
    ? 0
    : 1 - (candidate.meanItemsScanned / control.meanItemsScanned);
  const checks = {
    exactTop1: candidate.exactTop1Rate >= gate.minimumExactTop1Rate,
    exactTop5: candidate.exactTop5Rate >= gate.minimumExactTop5Rate,
    positiveNegativeGap:
      candidate.positiveNegativeGap >= gate.minimumPositiveNegativeGap,
    overallHardNegativeFpr:
      candidate.hardNegativeFalsePositiveRate <=
        gate.maximumHardNegativeFalsePositiveRate,
    everyHardNegativeFamily: Object.values(candidate.hardNegativeFamilies)
      .every(({ falsePositiveRate }) =>
        falsePositiveRate <= gate.maximumPerFamilyFalsePositiveRate
      ),
    cleanupScanReduction: cleanupScanReduction >= gate.minimumCleanupScanReduction
  };
  return {
    passed: Object.values(checks).every(Boolean),
    arm: gate.arm,
    fixtureSize: gate.fixtureSize,
    cleanupScanReduction,
    checks
  };
}

function queryFromEntry({ kind, text, phase, polarity, receiptStatus }) {
  return { kind, text, phase, polarity, receiptStatus };
}

function arm(contract, id) {
  const selected = contract.arms.find((candidate) => candidate.id === id);
  if (!selected) throw new Error(`Missing experiment arm ${id}`);
  return selected;
}

function withoutTiming(row) {
  const { meanLatencyMicros: _meanLatencyMicros, ...stable } = row;
  return stable;
}

function finiteScore(value) {
  return Number.isFinite(value) ? value : -1;
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(values, predicate) {
  return values.length === 0
    ? 0
    : values.filter(predicate).length / values.length;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function boundedNumber(value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}`);
  }
  return value;
}

export const holographicWorldV2ExperimentInternals = Object.freeze({
  buildFixtures,
  hardNegatives,
  evaluatePromotionGate
});
