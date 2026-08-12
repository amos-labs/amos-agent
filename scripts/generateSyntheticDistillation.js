#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  generateSyntheticDistillationDataset,
  syntheticDatasetManifest
} from "../src/research/syntheticDistillation.js";

const outputArgument = argumentValue(process.argv.slice(2), "--output");
if (!outputArgument) {
  throw new Error("Usage: npm run dataset:synthetic -- --output PATH");
}

const output = resolve(outputArgument);
const records = generateSyntheticDistillationDataset();
const manifest = syntheticDatasetManifest(records);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ manifest, records }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, ...manifest }, null, 2));

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}
