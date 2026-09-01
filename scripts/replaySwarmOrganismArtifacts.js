#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { replayOrganismPolicyArtifacts } from "../src/research/swarmOrganismArtifactReplay.js";
import { nextOrganismLearningAction } from "../src/research/swarmOrganismLearningCycle.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const args = process.argv.slice(2);
const queuePath = resolve(requiredOption("--queue"));
const outputPath = resolve(requiredOption("--output"));
const storePath = resolve(option("--store") || ".amos-agent/research/swarm-learning");
const limit = integerOption("--limit", 8, 1, 1_000);
const queue = JSON.parse(await readFile(queuePath, "utf8"));
if (queue?.schema !== "amos.swarm-organism-promotion-queue" || queue?.version !== 1) {
  throw new Error("Unsupported organism promotion queue");
}
const store = await openSwarmLearningStore(storePath);
const episodes = (await store.listEpisodes())
  .filter(({ partition }) => partition === "development")
  .sort((left, right) => left.digest.localeCompare(right.digest))
  .slice(0, limit);
if (episodes.length === 0) throw new Error("No development episodes are available for replay");

const evaluated = queue.candidates.map((candidate) =>
  replayOrganismPolicyArtifacts({ candidate, episodes })
);
const artifactQueueBase = {
  schema: "amos.swarm-organism-artifact-replay-queue",
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceQueueDigest: digestResearchValue(queue),
  replayStore: storePath,
  episodeDigests: episodes.map(({ digest }) => digest),
  automaticallyPromoted: false,
  candidates: evaluated.map(({ candidate }) => candidate),
  receipts: evaluated.map(({ receipt }) => receipt),
  nextActions: evaluated
    .map(({ candidate }) => nextOrganismLearningAction(candidate))
    .filter(Boolean)
};
const artifactQueue = {
  ...artifactQueueBase,
  digest: digestResearchValue(artifactQueueBase)
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifactQueue, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  candidates: artifactQueue.candidates.length,
  passed: artifactQueue.receipts.filter(({ status }) => status === "passed").length,
  nextGate: artifactQueue.candidates.find(({ status }) => status === "qualifying")?.nextGate || null,
  digest: artifactQueue.digest
}, null, 2));

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
