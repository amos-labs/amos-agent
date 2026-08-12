import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileVerifiedSft, validateDistillationDataset } from "../src/research/distillationTrajectory.js";
import { validatePairedSuite } from "../src/research/pairedModelQualification.js";
import {
  generateSyntheticDistillationRetention,
  syntheticRetentionManifest
} from "../src/research/syntheticDistillationRetention.js";

test("retention corpus deterministically reaches the 2000/400 whole-family gate", () => {
  const records = generateSyntheticDistillationRetention();
  const manifest = syntheticRetentionManifest(records);
  assert.equal(records.length, 2400);
  assert.equal(manifest.train, 2000);
  assert.equal(manifest.validation, 400);
  assert.equal(manifest.family_count, 1200);
  assert.deepEqual(manifest.variants_per_family, { 2: 1200 });
  assert.equal(manifest.sha256, "4480c9b945369c2aab6889987ea989992a34dc9416153c911a19ce0800af298d");
  assert.equal(manifest.sha256, syntheticRetentionManifest(generateSyntheticDistillationRetention()).sha256);
  assert.deepEqual(validateDistillationDataset(records), records);
});

test("retention mix matches the preregistered trajectory allocation", () => {
  const manifest = syntheticRetentionManifest(generateSyntheticDistillationRetention());
  assert.deepEqual(manifest.splits.train.skill_groups, {
    amos_tool_and_authority_trajectories: 500,
    broad_verified_capability_replay: 1000,
    hard_algorithmic_code_and_repair: 300,
    receipt_grounding_and_exact_value_copy: 200
  });
  assert.deepEqual(manifest.splits.validation.skill_groups, {
    amos_tool_and_authority_trajectories: 100,
    broad_verified_capability_replay: 200,
    hard_algorithmic_code_and_repair: 60,
    receipt_grounding_and_exact_value_copy: 40
  });
  assert.equal(manifest.tool_trajectories, 720);
  assert.equal(manifest.executable_trajectories, 360);
});

test("retention SFT contains complete tools and executable replay targets", () => {
  const records = generateSyntheticDistillationRetention({ train: 40, validation: 20 });
  const compiled = compileVerifiedSft(records, { split: "train" });
  const toolRows = compiled.filter((row) => row.tools?.length > 0);
  const codeRows = records.filter((record) =>
    record.verification.methods.some((method) => method.type === "executable")
  );
  assert.equal(compiled.length, 40);
  assert.ok(toolRows.every((row) => row.messages.some((message) => message.tool_calls?.length)));
  assert.ok(toolRows.every((row) => row.messages.some((message) => message.role === "tool")));
  assert.ok(toolRows.every((row) => row.messages.at(-1).role === "assistant"));
  assert.ok(codeRows.length > 0);
});

test("v2 preservation suite is frozen and validates independently", () => {
  const bytes = readFileSync(new URL("../benchmarks/amos-operator-preservation-v2.json", import.meta.url));
  const suite = validatePairedSuite(JSON.parse(bytes));
  assert.equal(suite.status, "frozen");
  assert.equal(suite.cases.length, 14);
  assert.equal(suite.cases.reduce((total, testCase) => total + testCase.weight, 0), 40);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "41d09dad0f44247f804d8fffb3cb36df6f7e7e42ccacfe90c25dc5dc789ab078"
  );
});
