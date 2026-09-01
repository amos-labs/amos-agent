#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { organismPolicyTrainingEligibility } from "../src/research/swarmLearningArena.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";
import {
  calibrateOrganismTransitionModel,
  DEFAULT_ORGANISM_POLICY,
  evaluateOrganismPolicy
} from "../src/research/swarmOrganismSimulator.js";

const args = process.argv.slice(2);
const simulationPath = resolve(requiredOption("--simulation"));
const scenariosPath = resolve(requiredOption("--scenarios"));
const storePath = resolve(requiredOption("--store"));
const outputPath = option("--output") ? resolve(option("--output")) : null;
const partition = option("--partition") || "training";
const limit = integerOption("--limit", 24, 1, 10_000);
const fallbackSeed = integerOption("--seed", 7, 0, 2_147_483_647);
const [simulation, curriculum] = await Promise.all([
  readJson(simulationPath),
  readJson(scenariosPath)
]);
const search = simulation?.policySearch?.result;
if (simulation?.policySearch?.status !== "completed" || !search) {
  throw new Error("Simulation has no completed policy search");
}
if (curriculum?.schema !== "amos.process-mining-organism-curriculum") {
  throw new Error("Unsupported scenario curriculum");
}
const scenarios = curriculum.partitions?.[partition]?.slice(0, limit);
if (!Array.isArray(scenarios) || scenarios.length === 0) {
  throw new Error(`Scenario curriculum has no ${partition} cases`);
}

const store = await openSwarmLearningStore(storePath);
const records = [];
for (const episode of await store.listEpisodes()) {
  const eligibility = organismPolicyTrainingEligibility(episode);
  if (!eligibility.eligible || !episode.ecology?.digest) continue;
  records.push({
    episode,
    ecology: JSON.parse(await store.readBlob(episode.ecology.digest)),
    organismPolicyTrainingEligibility: eligibility
  });
}
if (records.length === 0) throw new Error("No organism-policy training episodes are available");
const model = calibrateOrganismTransitionModel({ records });
const protocol = {
  scenarioCount: scenarios.length,
  scenarioPartition: partition,
  seeds: search.seeds,
  seed: search.seed ?? fallbackSeed,
  commonRandomNumbers: true,
  transitionModelDigest: model.digest
};
const baseline = evaluateOrganismPolicy({
  model,
  scenarios,
  policy: DEFAULT_ORGANISM_POLICY,
  seeds: protocol.seeds,
  seed: protocol.seed
});
const candidates = search.promotionQueue.map(({ rank, policy }) => {
  const evaluation = evaluateOrganismPolicy({
    model,
    scenarios,
    policy,
    seeds: protocol.seeds,
    seed: protocol.seed
  });
  return {
    rank,
    policy,
    metrics: evaluation.metrics,
    lift: metricLift(baseline.metrics, evaluation.metrics)
  };
});
const comparisonBase = {
  schema: "amos.swarm-organism-paired-policy-comparison",
  version: 1,
  generatedAt: new Date().toISOString(),
  simulationDigest: search.digest,
  curriculumDigest: curriculum.digest,
  trainingRecordCount: records.length,
  protocol,
  baseline: baseline.metrics,
  candidates,
  interpretation: {
    simulatedPredictionOnly: true,
    createsVerifierEvidence: false,
    automaticallyPromotes: false
  }
};
const comparison = {
  ...comparisonBase,
  digest: digestResearchValue(comparisonBase)
};
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(comparison, null, 2));

function metricLift(baseline, candidate) {
  return {
    simulatedPassRate: candidate.simulatedPassRate - baseline.simulatedPassRate,
    phaseCompletionRate: candidate.phaseCompletionRate - baseline.phaseCompletionRate,
    recoveryRate: candidate.recoveryRate - baseline.recoveryRate,
    artifactCompliance: candidate.artifactCompliance - baseline.artifactCompliance,
    meanModelCalls: candidate.meanModelCalls - baseline.meanModelCalls,
    meanWallTimeSeconds: candidate.meanWallTimeSeconds - baseline.meanWallTimeSeconds
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function integerOption(name, fallback, minimum, maximum) {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
