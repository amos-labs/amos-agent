#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  generateSyntheticDistillationDataset,
  syntheticDatasetManifest
} from "../src/research/syntheticDistillation.js";
import {
  generateSyntheticDistillationPilot,
  syntheticPilotManifest
} from "../src/research/syntheticDistillationPilot.js";
import {
  generateSyntheticDistillationRetention,
  syntheticRetentionManifest
} from "../src/research/syntheticDistillationRetention.js";

const args = process.argv.slice(2);
const outputArgument = argumentValue(args, "--output");
if (!outputArgument) {
  throw new Error(
    "Usage: npm run dataset:synthetic -- --output PATH [--profile seed|pilot|retention] " +
    "[--train 1000] [--validation 200] [--variants-per-family 2] [--seed VALUE]"
  );
}

const output = resolve(outputArgument);
const profile = argumentValue(args, "--profile") || "seed";
const { records, manifest } = generateProfile(profile, args);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ manifest, records }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, ...manifest }, null, 2));

function generateProfile(profileName, argumentsValue) {
  if (profileName === "seed") {
    const records = generateSyntheticDistillationDataset();
    return { records, manifest: syntheticDatasetManifest(records) };
  }
  if (profileName === "pilot") {
    const records = generateSyntheticDistillationPilot({
      train: integerArgument(argumentsValue, "--train", 1000),
      validation: integerArgument(argumentsValue, "--validation", 200),
      variantsPerFamily: integerArgument(argumentsValue, "--variants-per-family", 2),
      seed: argumentValue(argumentsValue, "--seed") || "amos-operator-pilot-v1"
    });
    return { records, manifest: syntheticPilotManifest(records) };
  }
  if (profileName === "retention") {
    const records = generateSyntheticDistillationRetention({
      train: integerArgument(argumentsValue, "--train", 2000),
      validation: integerArgument(argumentsValue, "--validation", 400),
      variantsPerFamily: integerArgument(argumentsValue, "--variants-per-family", 2),
      seed: argumentValue(argumentsValue, "--seed") || "amos-operator-retention-v2"
    });
    return { records, manifest: syntheticRetentionManifest(records) };
  }
  throw new Error(`Unsupported synthetic dataset profile: ${profileName}`);
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function integerArgument(args, name, fallback) {
  const value = argumentValue(args, name);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}
