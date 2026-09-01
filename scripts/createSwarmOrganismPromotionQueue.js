#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  candidatesFromOrganismPolicySearch,
  nextOrganismLearningAction
} from "../src/research/swarmOrganismLearningCycle.js";

const args = process.argv.slice(2);
const simulationPath = requiredOption("--simulation");
const outputPath = requiredOption("--output");
const simulation = JSON.parse(await readFile(resolve(simulationPath), "utf8"));
if (simulation?.policySearch?.status !== "completed" || !simulation.policySearch.result) {
  throw new Error("Simulation report does not contain a completed policy search");
}
const candidates = candidatesFromOrganismPolicySearch(simulation.policySearch.result, {
  prefix: simulationPath.split("/").at(-2) || "organism"
});
const queue = {
  schema: "amos.swarm-organism-promotion-queue",
  version: 1,
  generatedAt: new Date().toISOString(),
  simulationPath: resolve(simulationPath),
  automaticallyPromoted: false,
  candidates,
  nextActions: candidates.map(nextOrganismLearningAction)
};
const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: destination,
  candidates: candidates.length,
  nextGate: candidates[0]?.nextGate || null
}, null, 2));

function requiredOption(name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}
