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
