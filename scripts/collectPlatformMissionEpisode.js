#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPlatformMissionLearningEpisode } from "../src/research/platformMissionEpisode.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const argumentsList = process.argv.slice(2);
const missionPath = requiredPath("--mission");
const tracePath = requiredPath("--traces");
const dataPolicyPath = requiredPath("--data-policy");
const storePath = resolve(
  option("--store") || process.env.AMOS_SWARM_REPLAY_DIR ||
  ".amos-agent/research/swarm-learning"
);
const outputPath = option("--output") ? resolve(option("--output")) : null;

const [missionDocument, traces, dataPolicy] = await Promise.all([
  readJson(missionPath),
  readJsonLines(tracePath),
  readJson(dataPolicyPath)
]);
const mission = missionDocument?.result && typeof missionDocument.result === "object"
  ? missionDocument.result
  : missionDocument;
const episode = createPlatformMissionLearningEpisode({
  mission,
  gatewayTraces: traces,
  dataPolicy
});
const store = await openSwarmLearningStore(storePath);
const recorded = await store.recordEpisode(episode);
const result = {
  schema: "amos.platform-mission-episode-collection",
  version: 1,
  missionId: mission.mission_id,
  storePath,
  episodeId: recorded.id,
  episodeDigest: recorded.digest,
  outcome: recorded.outcome,
  trainingEligibility: recorded.trainingEligibility,
  correlatedTraceCount: recorded.traces.length
};
if (outputPath) {
  await writeFile(outputPath, `${JSON.stringify({ ...result, episode: recorded }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}
console.log(JSON.stringify(result, null, 2));

function requiredPath(name) {
  const value = option(name);
  if (!value) fail(`${name} is required`);
  return resolve(value);
}

function option(name) {
  const index = argumentsList.indexOf(name);
  if (index < 0) return "";
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON ${path}: ${error.message}`);
  }
}

async function readJsonLines(path) {
  const source = await readFile(path, "utf8");
  return source.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1} is not valid JSON: ${error.message}`);
    }
  });
}

function fail(message) {
  console.error(
    `${message}\n\n` +
    "Usage: node scripts/collectPlatformMissionEpisode.js " +
    "--mission get-mission.json --traces gateway.jsonl --data-policy policy.json " +
    "[--store DIRECTORY] [--output receipt.json]"
  );
  process.exit(2);
}
