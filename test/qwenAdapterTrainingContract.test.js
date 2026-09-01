import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAmosNativeTrainingDataset } from "../src/research/amosNativeTrainingDataset.js";
import { generateAmosSyntheticCurriculum } from "../src/research/amosSyntheticCurriculum.js";
import {
  createQwenAdapterStageZeroContract,
  validateCheckpoint,
  validateQwenAdapterStageZeroContract
} from "../src/research/qwenAdapterTrainingContract.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const planUrl = new URL("../benchmarks/swarm-qwen-adapter-training-v1.json", import.meta.url);
const checkpointUrl = new URL(
  "../benchmarks/qwen38-27b-training-checkpoint-v1.json",
  import.meta.url
);

test("stage-zero QLoRA contract pins data, checkpoint, container, and isolation", async () => {
  const { plan, checkpoint, dataset } = await fixture();
  const contract = createQwenAdapterStageZeroContract({
    id: "qwen38-stage0-20260823-1",
    plan,
    datasetManifest: dataset.manifest,
    checkpoint,
    trainerImageUri: `637423327454.dkr.ecr.us-east-1.amazonaws.com/amos/trainer@sha256:${"a".repeat(64)}`,
    datasetUri: "s3://amos-stage0/runs/dataset-1/dataset",
    outputUri: "s3://amos-stage0/runs/trainer-1",
    sourceRevision: "b".repeat(40)
  });

  assert.equal(contract.qualityClaimAllowed, false);
  assert.equal(contract.promotionAllowed, false);
  assert.equal(contract.recipe.modelClass, "Qwen3_5ForConditionalGeneration");
  assert.equal(contract.recipe.includeVisionTowerInAdapter, false);
  assert.equal(contract.recipe.optimization.loss, "assistant-tokens-only");
  assert.equal(contract.execution.torchNativeJitDisabled, true);
  assert.equal(contract.dataset.trainingFile.rows, 64);
  assert.equal(contract.base.expectedShardDigests.length, 18);
  assert.equal(contract.base.checkpointBytes, 55_563_006_776);
  assert.equal(
    validateQwenAdapterStageZeroContract(contract).digest,
    contract.digest
  );
});

test("stage-zero contract rejects mutated data, moving images, and checkpoint drift", async () => {
  const { plan, checkpoint, dataset } = await fixture();
  const mutatedDataset = structuredClone(dataset.manifest);
  mutatedDataset.counts.trainingExamples = 65;
  assert.throws(
    () => createQwenAdapterStageZeroContract({
      id: "qwen38-stage0-mutated",
      plan,
      datasetManifest: mutatedDataset,
      checkpoint,
      trainerImageUri: `example.invalid/trainer@sha256:${"a".repeat(64)}`,
      datasetUri: "s3://amos-stage0/dataset",
      outputUri: "s3://amos-stage0/output",
      sourceRevision: "b".repeat(40)
    }),
    /dataset manifest digest/
  );

  assert.throws(
    () => createQwenAdapterStageZeroContract({
      id: "qwen38-stage0-moving-image",
      plan,
      datasetManifest: dataset.manifest,
      checkpoint,
      trainerImageUri: "example.invalid/trainer:latest",
      datasetUri: "s3://amos-stage0/dataset",
      outputUri: "s3://amos-stage0/output",
      sourceRevision: "b".repeat(40)
    }),
    /must end in @sha256/
  );

  const changedCheckpoint = structuredClone(checkpoint);
  changedCheckpoint.shards[0].bytes += 1;
  assert.throws(
    () => validateCheckpoint(changedCheckpoint, plan),
    /checkpointBytes does not match/
  );
});

test("validated stage-zero contract fails closed after mutation", async () => {
  const { plan, checkpoint, dataset } = await fixture();
  const contract = createQwenAdapterStageZeroContract({
    id: "qwen38-stage0-tamper-proof",
    plan,
    datasetManifest: dataset.manifest,
    checkpoint,
    trainerImageUri: `example.invalid/trainer@sha256:${"a".repeat(64)}`,
    datasetUri: "s3://amos-stage0/dataset",
    outputUri: "s3://amos-stage0/output",
    sourceRevision: "b".repeat(40)
  });
  contract.recipe.optimization.epochs = 1;
  assert.throws(
    () => validateQwenAdapterStageZeroContract(contract),
    /digest does not match/
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "amos-qwen-stage0-contract-"));
  const store = await openSwarmLearningStore(root);
  const plan = JSON.parse(await readFile(planUrl, "utf8"));
  const checkpoint = JSON.parse(await readFile(checkpointUrl, "utf8"));
  await generateAmosSyntheticCurriculum({ store, examplesPerFamily: 16 });
  const dataset = await compileAmosNativeTrainingDataset({
    store,
    plan,
    minimums: {
      trainingExamples: 64,
      validationExamples: 16,
      holdoutExamples: 48,
      taskFamilies: 8
    }
  });
  assert.equal(dataset.ready, true);
  return { plan, checkpoint, dataset };
}
