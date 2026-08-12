import test from "node:test";
import assert from "node:assert/strict";
import { compileVerifiedSft, validateDistillationDataset } from "../src/research/distillationTrajectory.js";
import {
  generateSyntheticDistillationDataset,
  syntheticDatasetManifest
} from "../src/research/syntheticDistillation.js";

test("synthetic AMOS generator produces a deterministic family-isolated dataset", () => {
  const first = generateSyntheticDistillationDataset();
  const second = generateSyntheticDistillationDataset();
  assert.equal(first.length, 17);
  assert.deepEqual(validateDistillationDataset(first), first);
  assert.equal(syntheticDatasetManifest(first).sha256, syntheticDatasetManifest(second).sha256);
  assert.equal(syntheticDatasetManifest(first).train, 11);
  assert.equal(syntheticDatasetManifest(first).validation, 2);
  assert.equal(syntheticDatasetManifest(first).evaluation, 4);
});

test("synthetic corpus covers tools, recovery, abstention, and required escalation", () => {
  const records = generateSyntheticDistillationDataset();
  assert.ok(records.some((record) => record.input.tools?.length > 0));
  assert.ok(records.some((record) => record.task.workflow === "stale_reference_recovery"));
  assert.ok(records.some((record) => record.task.workflow === "causal_abstention"));
  assert.ok(records.some((record) => record.target.outcome === "escalate"));
});

test("SFT compilation excludes validation and evaluation families", () => {
  const records = generateSyntheticDistillationDataset();
  const compiled = compileVerifiedSft(records);
  assert.equal(compiled.length, records.filter((record) => record.split === "train").length);
  assert.ok(compiled.every((record) => Array.isArray(record.messages)));
});
