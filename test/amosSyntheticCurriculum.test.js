import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import {
  AMOS_SYSTEM_CURRICULUM_FAMILIES,
  generateAmosSyntheticCurriculum
} from "../src/research/amosSyntheticCurriculum.js";
import { compileAmosNativeTrainingDataset } from "../src/research/amosNativeTrainingDataset.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const planUrl = new URL("../benchmarks/swarm-qwen-adapter-training-v1.json", import.meta.url);

test("the AMOS-owned stage-zero curriculum qualifies only the pipeline-proof dataset", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-synthetic-curriculum-"));
  const store = await openSwarmLearningStore(root);
  const manifest = await generateAmosSyntheticCurriculum({ store, examplesPerFamily: 16 });

  assert.equal(manifest.exampleDigests.length, 128);
  assert.equal(manifest.taskFamilies.length, 8);
  assert.deepEqual(manifest.taskFamilies, AMOS_SYSTEM_CURRICULUM_FAMILIES);
  assert.deepEqual(manifest.sufficientFor, ["stage0-pipeline-proof"]);
  assert.ok(manifest.insufficientFor.includes("stage1-quality-training"));
  assert.equal(
    (await store.arena()).replayBatch({ purpose: "adapter", limit: 1_000 }).episodeDigests.length,
    128
  );

  const plan = JSON.parse(await readFile(planUrl, "utf8"));
  const stageZero = await compileAmosNativeTrainingDataset({
    store,
    plan,
    minimums: {
      trainingExamples: 64,
      validationExamples: 16,
      holdoutExamples: 48,
      taskFamilies: 8
    }
  });
  assert.equal(stageZero.ready, true);
  assert.deepEqual(stageZero.manifest.counts, {
    episodes: 128,
    publicBenchmarkEpisodes: 0,
    taskFamilies: 8,
    examples: 128,
    trainingExamples: 64,
    validationExamples: 16,
    holdoutExamples: 48,
    preferencePairs: 128
  });

  const qualityStage = await compileAmosNativeTrainingDataset({ store, plan });
  assert.equal(qualityStage.ready, false);
  assert.ok(qualityStage.manifest.blockers.includes("training-examples:64/200"));
  assert.ok(qualityStage.manifest.blockers.includes("validation-examples:16/50"));
  assert.ok(qualityStage.manifest.blockers.includes("holdout-examples:48/50"));

  const replayed = await generateAmosSyntheticCurriculum({ store, examplesPerFamily: 16 });
  assert.equal(replayed.digest, manifest.digest);
  assert.equal((await store.listEpisodes()).length, 128);
});
