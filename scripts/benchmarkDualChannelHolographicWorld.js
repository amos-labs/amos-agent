#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runDualChannelHolographicExperiment } from
  "../src/research/dualChannelHolographicExperiment.js";

const DEFAULT_CONTRACT = resolve(
  "benchmarks/swarm-holographic-world-dual-channel-experiment-v1.json"
);

export async function main(argv = process.argv.slice(2)) {
  const parsed = { contract: DEFAULT_CONTRACT, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--contract") parsed.contract = resolve(required(argv[++index], "--contract"));
    else if (argv[index] === "--out") parsed.out = resolve(required(argv[++index], "--out"));
    else throw new Error(`Unknown argument ${argv[index]}`);
  }
  const contract = JSON.parse(await readFile(parsed.contract, "utf8"));
  const result = runDualChannelHolographicExperiment(contract);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (parsed.out) await writeFile(parsed.out, output, "utf8");
  process.stdout.write(output);
  if (!result.gate.passed) process.exitCode = 2;
  return result;
}

function required(value, flag) {
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
