#!/usr/bin/env node
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createQwenAdapterStageZeroContract,
  validateQwenAdapterStageZeroContract
} from "../src/research/qwenAdapterTrainingContract.js";

const args = process.argv.slice(2);
const datasetManifestPath = requiredOption("--dataset-manifest");
const outputPath = resolve(requiredOption("--output"));
const planPath = option("--plan") || "benchmarks/swarm-qwen-adapter-training-v1.json";
const checkpointPath = option("--checkpoint") ||
  "benchmarks/qwen38-27b-training-checkpoint-v1.json";

const [plan, datasetManifest, checkpoint] = await Promise.all([
  readJson(resolve(planPath)),
  readJson(resolve(datasetManifestPath)),
  readJson(resolve(checkpointPath))
]);
const contract = createQwenAdapterStageZeroContract({
  id: requiredOption("--id"),
  plan,
  datasetManifest,
  checkpoint,
  trainerImageUri: requiredOption("--trainer-image"),
  datasetUri: requiredOption("--dataset-uri"),
  outputUri: requiredOption("--output-uri"),
  sourceRevision: requiredOption("--source-revision"),
  seed: Number(option("--seed") || 20260823)
});
validateQwenAdapterStageZeroContract(contract);
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeImmutable(outputPath, `${JSON.stringify(contract, null, 2)}\n`);
console.log(JSON.stringify({
  contract: outputPath,
  id: contract.id,
  digest: contract.digest,
  datasetDigest: contract.dataset.manifestDigest,
  checkpointDigest: contract.base.checkpointDigest,
  qualityClaimAllowed: contract.qualityClaimAllowed,
  promotionAllowed: contract.promotionAllowed
}, null, 2));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeImmutable(path, contents) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await readFile(path, "utf8") !== contents) {
      throw new Error(`Immutable stage-zero contract differs: ${path}`);
    }
  } finally {
    await handle?.close();
  }
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
