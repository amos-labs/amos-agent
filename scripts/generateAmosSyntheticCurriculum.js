#!/usr/bin/env node
import { resolve } from "node:path";
import { generateAmosSyntheticCurriculum } from "../src/research/amosSyntheticCurriculum.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const args = process.argv.slice(2);
const storePath = option("--store") || ".amos-agent/research/swarm-learning";
const examplesPerFamily = Number(option("--examples-per-family") || 16);
const store = await openSwarmLearningStore(resolve(storePath));
const manifest = await generateAmosSyntheticCurriculum({ store, examplesPerFamily });
console.log(JSON.stringify({
  store: resolve(storePath),
  examples: manifest.exampleDigests.length,
  taskFamilies: manifest.taskFamilies.length,
  manifestDigest: manifest.digest,
  sufficientFor: manifest.sufficientFor,
  insufficientFor: manifest.insufficientFor
}, null, 2));

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}
