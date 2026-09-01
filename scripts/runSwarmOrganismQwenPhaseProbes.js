#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateAmosOwnedMissionVerifierManifest } from "../src/research/amosOwnedMissionArena.js";
import { OpenAiResearchWorker } from "../src/research/openAiResearchWorker.js";
import { runOrganismQwenPhaseProbe } from "../src/research/swarmOrganismQwenPhaseProbe.js";

const args = process.argv.slice(2);
const missionsPath = resolve(option("--missions") || "benchmarks/swarm-organism-owned-missions-v1.json");
const verifiersPath = resolve(option("--verifiers") || "benchmarks/swarm-organism-owned-verifiers-v1.json");
const policyPath = resolve(option("--policy") || "benchmarks/swarm-organism-ap-stage1-policy-v1.json");
const outputPath = resolve(requiredOption("--output"));
const [missionManifest, verifierInput, policyCandidate] = await Promise.all([
  readJson(missionsPath),
  readJson(verifiersPath),
  readJson(policyPath)
]);
const verifierManifest = validateAmosOwnedMissionVerifierManifest(verifierInput);
const apiKey = process.env.AMOS_LOCAL_BENCHMARK_API_KEY;
const baseUrl = process.env.AMOS_QWEN_RESEARCH_URL;
const model = process.env.AMOS_QWEN_SERVED_MODEL || "qwen3.5-27b-amos";
if (!apiKey || !baseUrl) throw new Error("AMOS Qwen phase probe credentials are unavailable");
const worker = new OpenAiResearchWorker({
  controlId: "organism-qwen-phase-probes",
  model,
  baseUrl,
  apiKey,
  dialect: "qwen",
  reasoningEffort: "medium",
  temperature: 0.2,
  seed: 7,
  allowRemote: true
});
await worker.probe();
const report = await runOrganismQwenPhaseProbe({
  worker,
  missions: missionManifest.missions,
  verifiers: verifierManifest.verifiers,
  candidatePolicy: policyCandidate.policy,
  candidateId: policyCandidate.id,
  maxOutputTokens: integerOption("--max-output-tokens", 800, 128, 4_096)
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  digest: report.digest,
  gate: report.gate,
  baseline: report.baseline,
  candidate: report.candidate,
  lift: report.lift
}, null, 2));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
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
