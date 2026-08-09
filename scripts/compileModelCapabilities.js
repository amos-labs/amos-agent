#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import {
  CAPABILITY_CONTRACT_SCHEMA,
  CAPABILITY_CONTRACT_VERSION,
  compileCapabilityContracts,
  digestJson
} from "../src/model/capabilityContract.js";

const args = process.argv.slice(2);
const input = positionalArgument(args);
if (!input) {
  console.error(
    "Usage: npm run qualification:compile -- REPORT.json [--output CATALOG.json] " +
    "[--provider NAME] [--deployment local|private|managed] [--runtime NAME] " +
    "[--runtime-version VERSION] [--quantization NAME] [--prompt-version VERSION] " +
    "[--tool-schema-version VERSION] [--latency-class CLASS] [--cost-class CLASS]"
  );
  process.exit(2);
}

const source = await readFile(input, "utf8");
const report = JSON.parse(source);
const contracts = compileCapabilityContracts(report, {
  provider: option(args, "--provider"),
  deployment: option(args, "--deployment"),
  runtime: option(args, "--runtime"),
  runtimeVersion: option(args, "--runtime-version"),
  quantization: option(args, "--quantization"),
  promptVersion: option(args, "--prompt-version"),
  toolSchemaVersion: option(args, "--tool-schema-version"),
  latencyClass: option(args, "--latency-class"),
  costClass: option(args, "--cost-class")
});
const catalog = {
  schema: "amos.model-capability-catalog",
  version: 1,
  contractSchema: CAPABILITY_CONTRACT_SCHEMA,
  contractVersion: CAPABILITY_CONTRACT_VERSION,
  createdAt: new Date().toISOString(),
  sourceReportDigest: digestJson(report),
  contracts
};
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
const output = option(args, "--output");
if (output) {
  await writeFile(output, serialized);
  console.log(`Wrote ${contracts.length} capability contract(s) to ${output}`);
} else {
  process.stdout.write(serialized);
}

function positionalArgument(values) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index].startsWith("--")) {
      index += 1;
      continue;
    }
    return values[index];
  }
  return "";
}

function option(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}
