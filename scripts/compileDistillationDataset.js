#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import process from "node:process";
import {
  compileVerifiedSft,
  datasetIdentity,
  validateDistillationDataset
} from "../src/research/distillationTrajectory.js";

const options = parseArguments(process.argv.slice(2));
if (!options.input) {
  throw new Error(
    "Usage: npm run dataset:distillation -- --input PATH [--output PATH] " +
    "[--split train|validation|evaluation] [--exclude-tools]"
  );
}

const inputPath = resolve(options.input);
const records = await readRecords(inputPath);
validateDistillationDataset(records, {
  allowConsentedProduct: options.allowConsentedProduct
});
const identity = datasetIdentity(records);

if (options.output) {
  const outputPath = resolve(options.output);
  const compiled = compileVerifiedSft(records, {
    allowConsentedProduct: options.allowConsentedProduct,
    split: options.split,
    includeTools: options.includeTools
  });
  await writeFile(outputPath, `${compiled.map((record) => JSON.stringify(record)).join("\n")}\n`, {
    mode: 0o600
  });
  console.log(JSON.stringify({
    ...identity,
    compiled_split: options.split,
    include_tools: options.includeTools,
    compiled_records: compiled.length,
    output: outputPath
  }, null, 2));
} else {
  console.log(JSON.stringify(identity, null, 2));
}

function parseArguments(args) {
  const parsed = {
    input: null,
    output: null,
    split: "train",
    includeTools: true,
    allowConsentedProduct: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") parsed.input = args[++index];
    else if (argument === "--output") parsed.output = args[++index];
    else if (argument === "--split") parsed.split = args[++index];
    else if (argument === "--exclude-tools") parsed.includeTools = false;
    else if (argument === "--allow-consented-product") parsed.allowConsentedProduct = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

async function readRecords(path) {
  const text = await readFile(path, "utf8");
  if (extname(path).toLowerCase() === ".jsonl") {
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL record ${index + 1}: ${error.message}`);
      }
    });
  }
  const value = JSON.parse(text);
  return Array.isArray(value) ? value : value.records;
}
