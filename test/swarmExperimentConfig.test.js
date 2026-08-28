import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateSwarmDevelopmentMissions,
  validateSwarmExperimentConfig
} from "../src/research/swarmExperimentConfig.js";

test("the Swarm v0 config binds Direct Qwen, Swarm Qwen, and Fable to one comparison", async () => {
  const config = validateSwarmExperimentConfig(JSON.parse(await readFile(
    new URL("../benchmarks/swarm-experiment-v0.json", import.meta.url),
    "utf8"
  )));
  assert.deepEqual(config.controls.map((control) => control.id), [
    "qwen-direct",
    "qwen-swarm",
    "fable-control"
  ]);
  assert.equal(config.comparison.blindJudgeRequired, true);
  assert.equal(config.comparison.minimumRepetitions, 3);
});

test("the alternate control can bind Direct Qwen and Swarm Qwen to Opus 5", async () => {
  const config = validateSwarmExperimentConfig(JSON.parse(await readFile(
    new URL("../benchmarks/swarm-experiment-opus-v0.json", import.meta.url),
    "utf8"
  )));
  assert.deepEqual(config.controls.map((control) => control.id), [
    "qwen-direct",
    "qwen-swarm",
    "opus-control"
  ]);
  assert.equal(config.controls[2].model, "us.anthropic.claude-opus-5");
  assert.equal(config.controls[2].reasoningEffort, "high");
  assert.equal(config.budget.directOutputTokens, config.budget.maxTotalOutputTokens);
  assert.equal(config.comparison.blindJudgeRequired, true);
});

test("the best-quality regime grants every route the same larger total-output ceiling", async () => {
  const config = validateSwarmExperimentConfig(JSON.parse(await readFile(
    new URL("../benchmarks/swarm-experiment-opus-quality-v0.json", import.meta.url),
    "utf8"
  )));
  assert.deepEqual(config.comparison.regimes, ["best-quality"]);
  assert.equal(config.budget.maxTotalOutputTokens, 16_384);
  assert.equal(config.budget.directOutputTokens, 16_384);
  assert.equal(
    (config.budget.workerOutputTokens * 2) + config.budget.verifierOutputTokens +
      config.budget.integratorOutputTokens,
    16_384
  );
});

test("the bounded Swarm treatment preserves the matched total budget", async () => {
  const config = validateSwarmExperimentConfig(JSON.parse(await readFile(
    new URL("../benchmarks/swarm-experiment-opus-bounded-v1.json", import.meta.url),
    "utf8"
  )));
  assert.deepEqual(config.comparison.regimes, ["matched-output-budget"]);
  assert.equal(config.budget.maxTotalOutputTokens, 9_984);
  assert.equal(config.budget.directOutputTokens, 9_984);
  assert.equal(
    (config.budget.workerOutputTokens * 2) + config.budget.verifierOutputTokens +
      config.budget.integratorOutputTokens,
    9_984
  );
  assert.ok(config.budget.integratorOutputTokens > config.budget.workerOutputTokens);
});

test("the complete Swarm treatment makes substantive integration a hard contract", async () => {
  const config = validateSwarmExperimentConfig(JSON.parse(await readFile(
    new URL("../benchmarks/swarm-experiment-opus-complete-v2.json", import.meta.url),
    "utf8"
  )));
  assert.equal(config.budget.integratorMinimumAnswerCharacters, 1_000);
  assert.equal(config.budget.maxTotalOutputTokens, 9_984);
  assert.equal(config.budget.directOutputTokens, 9_984);
});

test("development missions are visible fixtures and cannot masquerade as sealed evidence", async () => {
  const missions = validateSwarmDevelopmentMissions(JSON.parse(await readFile(
    new URL("../benchmarks/swarm-development-missions-v0.json", import.meta.url),
    "utf8"
  )));
  assert.equal(missions.dataClassification, "development-visible");
  assert.equal(missions.missions.length, 3);

  const mislabeled = structuredClone(missions);
  mislabeled.dataClassification = "sealed";
  assert.throws(
    () => validateSwarmDevelopmentMissions(mislabeled),
    /development-visible/
  );
});

test("challenge missions expose multi-constraint development cases for swarm iteration", async () => {
  const missions = validateSwarmDevelopmentMissions(JSON.parse(await readFile(
    new URL("../benchmarks/swarm-challenge-missions-v0.json", import.meta.url),
    "utf8"
  )));
  assert.equal(missions.dataClassification, "development-visible");
  assert.ok(missions.missions.length >= 6);
  assert.ok(missions.missions.every((mission) => mission.successCriteria.length >= 5));
});
