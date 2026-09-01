#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { compileProcessMiningOrganismCurriculum } from "../src/research/processMiningOrganismCurriculum.js";

const args = process.argv.slice(2);
const output = resolve(requiredOption("--output"));
const curriculum = await compileProcessMiningOrganismCurriculum({
  csvPath: resolve(requiredOption("--csv")),
  sourceId: requiredOption("--source-id"),
  sourceDigest: requiredOption("--source-digest"),
  authorizedForInternalTraining: args.includes("--internal-training-authorized"),
  maximumCases: {
    training: integerOption("--training-cases", 2_000),
    validation: integerOption("--validation-cases", 500),
    holdout: integerOption("--holdout-cases", 500)
  }
});
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(curriculum, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  digest: curriculum.digest,
  variants: curriculum.split.variants.length,
  caseCounts: curriculum.split.caseCounts
}, null, 2));

function requiredOption(name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function integerOption(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(requiredOption(name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be positive`);
  return value;
}
