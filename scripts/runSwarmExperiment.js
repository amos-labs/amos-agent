#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { OpenAiResearchWorker } from "../src/research/openAiResearchWorker.js";
import { SwarmExperimentRunner } from "../src/research/swarmExperiment.js";
import {
  validateSwarmDevelopmentMissions,
  validateSwarmExperimentConfig
} from "../src/research/swarmExperimentConfig.js";
import {
  finalizeSwarmExperimentReport,
  swarmExperimentFailure
} from "../src/research/swarmExperimentReport.js";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const args = process.argv.slice(2);
const configPath = resolve(option("--config") ||
  resolve(repositoryRoot, "benchmarks/swarm-experiment-v0.json"));
const missionsPath = resolve(option("--missions") ||
  resolve(repositoryRoot, "benchmarks/swarm-development-missions-v0.json"));
const outputPath = option("--output");
const controlId = option("--control");
const missionId = option("--mission-id");
const endpointOverride = option("--url");
const repetitions = integerOption("--repetitions", 1, 1, 20);
const probeOnly = args.includes("--probe-only");
const allowRemote = args.includes("--allow-remote");

if (!controlId) fail("--control qwen-direct|qwen-swarm|fable-control is required");
if (!outputPath) fail("--output REPORT.json is required");

const config = validateSwarmExperimentConfig(await readJson(configPath));
const missionManifest = validateSwarmDevelopmentMissions(await readJson(missionsPath));
const control = config.controls.find((candidate) => candidate.id === controlId);
if (!control) fail(`Unknown control: ${controlId}`);
const missions = missionId
  ? missionManifest.missions.filter((mission) => mission.id === missionId)
  : missionManifest.missions;
if (missions.length === 0) fail(`Unknown mission: ${missionId}`);

const baseUrl = endpointOverride || process.env[control.endpointEnv] || control.defaultEndpoint;
const apiKey = control.apiKeyEnv ? process.env[control.apiKeyEnv] || null : null;
if (allowRemote && !apiKey) fail("--allow-remote requires the selected control's API key");
const worker = new OpenAiResearchWorker({
  controlId: control.id,
  model: control.model,
  baseUrl,
  apiKey,
  dialect: control.dialect,
  reasoningEffort: control.reasoningEffort,
  requestTimeoutMs: config.budget.maxWallMilliseconds,
  allowRemote
});
const readiness = await worker.probe();
const sourceRevision = await resolveSourceRevision();
const sourceDigest = optionalSourceDigest(process.env.AMOS_SOURCE_DIGEST);
const report = {
  schema: "amos.swarm-experiment-report",
  version: 1,
  createdAt: new Date().toISOString(),
  sourceRevision,
  sourceDigest,
  configId: config.id,
  configDigest: digestResearchValue(config),
  missionManifestId: missionManifest.id,
  missionManifestDigest: digestResearchValue(missionManifest),
  dataClassification: missionManifest.dataClassification,
  control,
  endpoint: redactedEndpoint(baseUrl),
  readiness,
  repetitions: probeOnly ? 0 : repetitions,
  status: "running",
  failure: null,
  runs: []
};

let activeCase = null;
let finalizedReport;
let executionError = null;
try {
  if (!probeOnly) {
    const runner = new SwarmExperimentRunner({ worker, controlId: control.id });
    const budget = config.budget;
    for (const mission of missions) {
      const dataManifestDigest = digestResearchValue({
        manifestId: missionManifest.id,
        mission
      });
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        activeCase = { missionId: mission.id, repetition };
        console.log(
          `Running ${control.id} · ${mission.id} · repetition ${repetition}/${repetitions}`
        );
        const common = {
          missionId: mission.id,
          objective: mission.objective,
          context: mission.context,
          successCriteria: mission.successCriteria,
          dataManifestDigest,
          repetition,
          budget
        };
        const run = control.mode === "swarm"
          ? await runner.runSwarm(common)
          : await runner.runDirect(common);
        report.runs.push({
          missionId: mission.id,
          repetition,
          runDigest: digestResearchValue(run),
          run
        });
      }
    }
  }
  finalizedReport = finalizeSwarmExperimentReport(report, { status: "completed" });
} catch (error) {
  executionError = error;
  const caseReference = activeCase || {
    missionId: missions[0].id,
    repetition: 1
  };
  finalizedReport = finalizeSwarmExperimentReport(report, {
    status: "failed",
    failure: swarmExperimentFailure(error, caseReference)
  });
}

await atomicWriteJson(outputPath, finalizedReport);
console.log(`Report: ${resolve(outputPath)}`);
console.log(`Digest: ${finalizedReport.reportDigest}`);
if (executionError) {
  console.error(
    `Experiment failed at ${finalizedReport.failure.missionId} ` +
    `repetition ${finalizedReport.failure.repetition}: ${finalizedReport.failure.message}`
  );
  process.exitCode = 1;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

async function atomicWriteJson(path, value) {
  const destination = resolve(path);
  const temporary = `${destination}.tmp-${process.pid}`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, destination);
}

async function resolveSourceRevision() {
  const embedded = String(process.env.AMOS_SOURCE_REVISION || "").trim();
  if (/^[a-f0-9]{40}$/.test(embedded)) return embedded;
  try {
    return (await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot
    })).stdout.trim();
  } catch {
    throw new Error("Research source revision is unavailable from the image or git checkout");
  }
}

function optionalSourceDigest(value) {
  const digest = String(value || "").trim();
  if (!digest) return null;
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("AMOS_SOURCE_DIGEST is invalid");
  return digest;
}

function redactedEndpoint(value) {
  const endpoint = new URL(value);
  endpoint.username = "";
  endpoint.password = "";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString().replace(/\/$/, "");
}

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function integerOption(name, fallback, minimum, maximum) {
  const raw = option(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function fail(message) {
  console.error(
    `${message}\n\n` +
    "Usage: node scripts/runSwarmExperiment.js --control CONTROL --output REPORT.json " +
    "[--mission-id ID] [--repetitions 3] [--url URL] [--allow-remote] [--probe-only]"
  );
  process.exit(2);
}
