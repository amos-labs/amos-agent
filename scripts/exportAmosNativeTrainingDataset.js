#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  compileAmosNativeTrainingDataset,
  writeAmosNativeTrainingDataset
} from "../src/research/amosNativeTrainingDataset.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const args = process.argv.slice(2);
const storePath = option("--store") || ".amos-agent/research/swarm-learning";
const outputPath = option("--output") || ".amos-agent/research/amos-native-dataset";
const planPath = option("--plan") || "benchmarks/swarm-qwen-adapter-training-v1.json";
const preflightOnly = args.includes("--preflight-only");
const stageZero = args.includes("--stage0");

const plan = JSON.parse(await readFile(resolve(planPath), "utf8"));
const store = await openSwarmLearningStore(resolve(storePath));
const dataset = await compileAmosNativeTrainingDataset({
  store,
  plan,
  minimums: stageZero ? {
    trainingExamples: 64,
    validationExamples: 16,
    holdoutExamples: 48,
    taskFamilies: 8
  } : null
});
const summary = {
  stage: stageZero ? "pipeline-and-lineage-proof" : "quality-training",
  ready: dataset.ready,
  store: resolve(storePath),
  output: resolve(outputPath),
  manifestDigest: dataset.manifest.digest,
  counts: dataset.manifest.counts,
  blockers: dataset.manifest.blockers
};

if (dataset.ready && !preflightOnly) {
  const written = await writeAmosNativeTrainingDataset(outputPath, dataset);
  summary.written = written.output;
}

console.log(JSON.stringify(summary, null, 2));
if (!dataset.ready && !preflightOnly) process.exitCode = 2;

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}
