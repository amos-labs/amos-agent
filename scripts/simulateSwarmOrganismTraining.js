#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";
import { organismPolicyTrainingEligibility } from "../src/research/swarmLearningArena.js";
import {
  calibrateOrganismTransitionModel,
  crossValidateOrganismTransitionModel,
  DEFAULT_ORGANISM_POLICY,
  defaultOrganismScenario,
  searchOrganismPolicies,
  simulateOrganismMission
} from "../src/research/swarmOrganismSimulator.js";

const options = parseArguments(process.argv.slice(2));
const policyStage = await readPolicyStage(options.contract, options.stage);
const scenarios = await readScenarios(options.scenarios, options.scenarioPartition, options.scenarioLimit);
const store = await openSwarmLearningStore(options.store);
const episodes = await store.listEpisodes();
if (episodes.length === 0) throw new Error(`No swarm learning episodes found in ${options.store}`);

const records = [];
for (const episode of episodes) {
  if (!episode.ecology?.digest) continue;
  const ecology = JSON.parse(await store.readBlob(episode.ecology.digest));
  records.push({
    episode,
    ecology,
    organismPolicyTrainingEligibility: organismPolicyTrainingEligibility(episode)
  });
}
if (records.length === 0) throw new Error("No episodes contain a readable ecology artifact");

const model = calibrateOrganismTransitionModel({ records });
const calibrationValidation = crossValidateOrganismTransitionModel({ records });
const trainingRecords = records.filter(({ organismPolicyTrainingEligibility }) =>
  organismPolicyTrainingEligibility.eligible === true
);
const throughputStarted = performance.now();
let passes = 0;
for (let index = 0; index < options.rollouts; index += 1) {
  const result = simulateOrganismMission({
    model,
    scenario: scenarios[index % scenarios.length],
    policy: DEFAULT_ORGANISM_POLICY,
    seed: options.seed + index
  });
  passes += Number(result.outcome.simulatedPass);
}
const throughputSeconds = (performance.now() - throughputStarted) / 1_000;
let policySearch;
if (trainingRecords.length > 0) {
  const trainingModel = calibrateOrganismTransitionModel({ records: trainingRecords });
  const searchStarted = performance.now();
  const search = searchOrganismPolicies({
    model: trainingModel,
    scenarios,
    candidates: options.candidates,
    elites: options.elites,
    generations: options.generations,
    seeds: options.searchSeeds,
    seed: options.seed,
    parameterNames: policyStage.parameters
  });
  policySearch = {
    status: "completed",
    trainingRecordCount: trainingRecords.length,
    elapsedSeconds: (performance.now() - searchStarted) / 1_000,
    result: search
  };
} else {
  policySearch = {
    status: "not-run",
    trainingRecordCount: 0,
    reason: "No rights-approved, contamination-partitioned ecology records are available; diagnostic traces cannot update policy candidates.",
    result: null
  };
}

const report = {
  schema: "amos.swarm-organism-simulation-run",
  version: 1,
  generatedAt: new Date().toISOString(),
  inputs: {
    store: resolve(options.store),
    policyContract: resolve(options.contract),
    policyStage: policyStage.id,
    optimizedParameters: policyStage.parameters,
    scenarioSource: options.scenarios ? resolve(options.scenarios) : "built-in-default",
    scenarioPartition: options.scenarioPartition,
    scenarioCount: scenarios.length,
    episodeCount: episodes.length,
    ecologyRecordCount: records.length
  },
  calibration: model,
  calibrationValidation,
  throughput: {
    rollouts: options.rollouts,
    elapsedSeconds: throughputSeconds,
    rolloutsPerSecond: options.rollouts / Math.max(throughputSeconds, Number.EPSILON),
    baselineSimulatedPassRate: passes / options.rollouts
  },
  policySearch,
  interpretation: {
    predictionNotEvidence: true,
    modelWeightsChanged: false,
    automaticallyPromoted: false,
    nextGate: policySearch.status === "completed"
      ? "Run the rights-cleared promotion queue through real Qwen phase probes."
      : "Generate and verify rights-cleared organism missions before policy search."
  }
};

if (options.output) {
  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`Wrote ${outputPath}`);
}
console.log(JSON.stringify(report, null, 2));

function parseArguments(argumentsList) {
  const values = {
    store: ".amos-agent/research/swarm-learning",
    contract: "benchmarks/swarm-organism-policy-training-v1.json",
    stage: "credit-assignment",
    scenarios: null,
    scenarioPartition: "training",
    scenarioLimit: 24,
    output: null,
    rollouts: 10_000,
    candidates: 64,
    elites: 8,
    generations: 4,
    searchSeeds: Array.from({ length: 32 }, (_, index) => 1_009 + (index * 7_919)),
    seed: 7
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (flag === "--help") {
      console.log(`Usage: node scripts/simulateSwarmOrganismTraining.js [options]

Options:
  --store PATH       Immutable swarm-learning store
  --contract PATH    Organism policy-training contract
  --stage ID         Contract stage to optimize (default credit-assignment)
  --scenarios PATH   Optional process-mining organism curriculum
  --scenario-partition NAME  Curriculum partition (default training)
  --scenario-limit N Maximum scenarios used in one search (default 24)
  --output PATH      Optional report path
  --rollouts N       Throughput rollouts (default 10000)
  --candidates N     CEM candidates per generation (default 64)
  --elites N         CEM elites per generation (default 8)
  --generations N    CEM generations (default 4)
  --seeds CSV        Evaluation seeds (default 11,29,47)
  --seed N           Search and throughput seed (default 7)`);
      process.exit(0);
    }
    if (!value || !flag.startsWith("--")) throw new Error(`Unsupported argument ${flag}`);
    index += 1;
    if (flag === "--store") values.store = value;
    else if (flag === "--contract") values.contract = value;
    else if (flag === "--stage") values.stage = value;
    else if (flag === "--scenarios") values.scenarios = value;
    else if (flag === "--scenario-partition") values.scenarioPartition = value;
    else if (flag === "--scenario-limit") values.scenarioLimit = positiveInteger(value, flag);
    else if (flag === "--output") values.output = value;
    else if (flag === "--rollouts") values.rollouts = positiveInteger(value, flag);
    else if (flag === "--candidates") values.candidates = positiveInteger(value, flag);
    else if (flag === "--elites") values.elites = positiveInteger(value, flag);
    else if (flag === "--generations") values.generations = positiveInteger(value, flag);
    else if (flag === "--seed") values.seed = integer(value, flag);
    else if (flag === "--seeds") values.searchSeeds = value.split(",").map((item) => integer(item, flag));
    else throw new Error(`Unsupported option ${flag}`);
  }
  if (values.elites >= values.candidates) throw new Error("--elites must be smaller than --candidates");
  return values;
}

async function readScenarios(path, partition, limit) {
  if (!path) return [defaultOrganismScenario()];
  const curriculum = JSON.parse(await readFile(resolve(path), "utf8"));
  if (curriculum?.schema !== "amos.process-mining-organism-curriculum") {
    throw new Error(`Unsupported organism scenario curriculum ${path}`);
  }
  const scenarios = curriculum.partitions?.[partition];
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error(`Scenario curriculum has no ${partition} partition`);
  }
  return scenarios.slice(0, limit);
}

async function readPolicyStage(contractPath, stageId) {
  const path = resolve(contractPath);
  const contract = JSON.parse(await readFile(path, "utf8"));
  const stages = contract?.policy?.stages;
  if (!Array.isArray(stages)) throw new Error(`Policy contract ${path} has no stages`);
  const stage = stages.find(({ id }) => id === stageId);
  if (!stage) throw new Error(`Unknown policy stage ${stageId} in ${path}`);
  if (!Array.isArray(stage.parameters) || stage.parameters.length === 0) {
    throw new Error(`Policy stage ${stageId} has no parameters`);
  }
  return { id: stage.id, parameters: [...stage.parameters] };
}

function positiveInteger(value, label) {
  const parsed = integer(value, label);
  if (parsed < 1) throw new Error(`${label} must be positive`);
  return parsed;
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}
