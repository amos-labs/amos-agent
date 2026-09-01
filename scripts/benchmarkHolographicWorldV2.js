#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runHolographicWorldV2Experiment } from
  "../src/research/holographicWorldV2Experiment.js";

const DEFAULT_CONTRACT = resolve(
  "benchmarks/swarm-holographic-world-v2-experiment-v1.json"
);

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const contract = JSON.parse(await readFile(args.contract, "utf8"));
  const result = runHolographicWorldV2Experiment(contract);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) await writeFile(args.out, output, "utf8");
  process.stdout.write(output);
  if (!result.gate.passed) process.exitCode = 2;
  return result;
}

function parseArgs(argv) {
  const parsed = { contract: DEFAULT_CONTRACT, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--contract") parsed.contract = resolve(requiredNext(argv, ++index, argument));
    else if (argument === "--out") parsed.out = resolve(requiredNext(argv, ++index, argument));
    else throw new Error(`Unknown argument ${argument}`);
  }
  return parsed;
}

function requiredNext(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
