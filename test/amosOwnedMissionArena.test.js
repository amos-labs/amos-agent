import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateAmosOwnedMissionVerifierManifest,
  verifyAmosOwnedMissionAnswer
} from "../src/research/amosOwnedMissionArena.js";
import { validateSwarmDevelopmentMissions } from "../src/research/swarmExperimentConfig.js";

const mission = { id: "authority-001" };
const verifier = {
  id: "authority-001-verifier",
  missionId: mission.id,
  family: "authority-precedence",
  criteria: [
    { id: "current", requiredConcepts: [["18%", "18 percent"]] },
    { id: "source", requiredConcepts: [["CFO"], ["memo"]] },
    { id: "superseded", requiredConcepts: [["12%"], ["superseded", "draft"]] }
  ],
  prohibitedConcepts: ["12% is current"]
};

test("owned mission verifier records candidate-independent concept evidence", () => {
  const receipt = verifyAmosOwnedMissionAnswer({
    mission,
    verifier,
    answer: "The CFO memo controls: 18% is current; 12% was the superseded draft."
  });
  assert.equal(receipt.passed, true);
  assert.equal(receipt.passedCriteria, 3);
  assert.equal(receipt.digest.length, 64);
});

test("owned mission verifier fails closed on a missing fact or prohibited contradiction", () => {
  const receipt = verifyAmosOwnedMissionAnswer({
    mission,
    verifier,
    answer: "The CFO memo says that 12% is current."
  });
  assert.equal(receipt.passed, false);
  assert.deepEqual(receipt.failedCriterionIds, ["current", "superseded"]);
  assert.deepEqual(receipt.prohibitedConceptsFound, ["12% is current"]);
});

test("owned mission verifier manifests require unique, development-only mission contracts", () => {
  const manifest = validateAmosOwnedMissionVerifierManifest({
    schema: "amos.owned-mission-verifiers",
    version: 1,
    id: "owned-v1",
    dataClassification: "amos-owned-training-development",
    verifiers: [verifier]
  });
  assert.equal(manifest.verifiers[0].family, "authority-precedence");
});

test("cloud curriculum has one verifier and one evaluation exclusion family per owned mission", async () => {
  const [missions, manifest] = await Promise.all([
    readFile(new URL("../benchmarks/swarm-organism-owned-missions-v1.json", import.meta.url), "utf8")
      .then(JSON.parse)
      .then(validateSwarmDevelopmentMissions),
    readFile(new URL("../benchmarks/swarm-organism-owned-verifiers-v1.json", import.meta.url), "utf8")
      .then(JSON.parse)
      .then(validateAmosOwnedMissionVerifierManifest)
  ]);
  assert.equal(missions.missions.length, 8);
  assert.deepEqual(
    manifest.verifiers.map(({ missionId }) => missionId).sort(),
    missions.missions.map(({ id }) => id).sort()
  );
  assert.equal(new Set(manifest.verifiers.map(({ family }) => family)).size, 8);
});
