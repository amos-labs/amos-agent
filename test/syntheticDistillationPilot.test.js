import test from "node:test";
import assert from "node:assert/strict";
import { compileVerifiedSft, validateDistillationDataset } from "../src/research/distillationTrajectory.js";
import {
  generateSyntheticDistillationPilot,
  syntheticPilotManifest
} from "../src/research/syntheticDistillationPilot.js";

test("pilot corpus deterministically reaches the 1000/200 whole-family gate", () => {
  const records = generateSyntheticDistillationPilot();
  const manifest = syntheticPilotManifest(records);

  assert.equal(records.length, 1200);
  assert.equal(manifest.train, 1000);
  assert.equal(manifest.validation, 200);
  assert.equal(manifest.evaluation, 0);
  assert.equal(manifest.family_count, 600);
  assert.deepEqual(manifest.variants_per_family, { 2: 600 });
  assert.equal(manifest.sha256, syntheticPilotManifest(generateSyntheticDistillationPilot()).sha256);
  assert.deepEqual(validateDistillationDataset(records), records);
});

test("pilot mix matches the frozen training plan in both splits", () => {
  const manifest = syntheticPilotManifest(generateSyntheticDistillationPilot());
  assert.deepEqual(manifest.splits.train.skill_groups, {
    authority_receipts_and_idempotency: 250,
    causal_abstention_and_escalation: 150,
    deterministic_math_and_constraint_checking: 250,
    executable_code_and_repair: 150,
    tool_recovery_and_evidence_reconciliation: 200
  });
  assert.deepEqual(manifest.splits.validation.skill_groups, {
    authority_receipts_and_idempotency: 50,
    causal_abstention_and_escalation: 30,
    deterministic_math_and_constraint_checking: 50,
    executable_code_and_repair: 30,
    tool_recovery_and_evidence_reconciliation: 40
  });
  assert.equal(manifest.tool_trajectories, 660);
  assert.equal(manifest.executable_trajectories, 180);
  assert.equal(manifest.code_repair_trajectories, 90);
  assert.ok(generateSyntheticDistillationPilot().filter((record) =>
    record.task.workflow === "stale_reference_recovery"
  ).every((record) => record.task.state.saved_page_id !== record.task.state.current_page_id));
});

test("pilot SFT preserves tool definitions and complete tool trajectories", () => {
  const records = generateSyntheticDistillationPilot({ train: 40, validation: 20 });
  const compiled = compileVerifiedSft(records, { split: "train" });
  const toolRows = compiled.filter((row) => row.tools?.length > 0);

  assert.equal(compiled.length, 40);
  assert.ok(toolRows.length > 0);
  assert.ok(toolRows.every((row) => row.messages.some((message) => message.tool_calls?.length)));
  assert.ok(toolRows.every((row) => row.messages.some((message) => message.role === "tool")));
  assert.ok(toolRows.every((row) => row.messages.at(-1).role === "assistant"));
});

test("changing the pilot seed changes scenarios without changing the contract", () => {
  const first = generateSyntheticDistillationPilot({ train: 40, validation: 20, seed: "pilot-seed-a" });
  const second = generateSyntheticDistillationPilot({ train: 40, validation: 20, seed: "pilot-seed-b" });

  assert.notEqual(syntheticPilotManifest(first).sha256, syntheticPilotManifest(second).sha256);
  assert.deepEqual(
    syntheticPilotManifest(first).splits.train.skill_groups,
    syntheticPilotManifest(second).splits.train.skill_groups
  );
});
