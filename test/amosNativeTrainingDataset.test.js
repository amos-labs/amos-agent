import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compileAmosNativeTrainingDataset,
  createAmosSystemTrainingExample,
  writeAmosNativeTrainingDataset
} from "../src/research/amosNativeTrainingDataset.js";
import { createSwarmLearningEpisode } from "../src/research/swarmLearningArena.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const plan = {
  schema: "amos.swarm-substrate-adapter-training",
  id: "adapter-test-v1",
  base: { model: "qwen-test" },
  data: {
    minimumTrainingEpisodes: 1,
    minimumValidationEpisodes: 1,
    minimumHoldoutEpisodes: 1,
    minimumTaskFamilies: 3
  }
};

function exampleInput(id, episodeId, family, correction = false) {
  return {
    id,
    sourceEpisodeId: episodeId,
    taskFamily: family,
    role: "tool-specialist",
    input: {
      system: "Follow the governed AMOS tool contract.",
      user: `Produce the verified ${family} transition.`
    },
    target: { kind: "tool-call", content: `{"operation":"${family}"}` },
    correction: correction ? {
      rejectedContent: "{}",
      verifierSignal: "required operation was absent"
    } : null,
    safeguards: {
      credentialsRemoved: true,
      tenantFactsRemoved: true,
      hiddenReasoningExcluded: true,
      independentVerifierSelected: true,
      licensedForTraining: true
    }
  };
}

async function recordTrainingEpisode(store, index, family, correction = false, dataPolicy = null) {
  const id = `episode-${index}`;
  const example = createAmosSystemTrainingExample(
    exampleInput(`example-${index}`, id, family, correction)
  );
  const exampleDigest = await store.putBlob(`${JSON.stringify(example)}\n`);
  return store.recordEpisode(createSwarmLearningEpisode({
    id,
    treatmentId: "amos-native-fixture",
    partition: dataPolicy?.sourceClass === "public-benchmark" ? "development" : "operations",
    task: { source: "amos-missions", name: family, ref: `mission:${index}`, checksum: null },
    model: {
      provider: "amos",
      name: "qwen-test",
      agent: "amos-holographic-swarm",
      agentVersion: "1",
      sharedBackbone: true
    },
    execution: {
      status: "completed",
      startedAt: "2026-08-23T10:00:00Z",
      finishedAt: "2026-08-23T10:01:00Z",
      exception: null
    },
    verifier: {
      kind: "fixture-verifier",
      status: "passed",
      score: 1,
      evidenceRefs: [`receipt:${index}`]
    },
    artifacts: [{
      ref: `artifact:${index}`,
      kind: "fixture",
      status: "collected",
      digest: String(index).padStart(64, "a").slice(-64)
    }],
    traces: [{
      ref: `blob:sha256:${exampleDigest}/example.json`,
      kind: "amos-system-training-example",
      status: "collected",
      digest: exampleDigest
    }],
    ecology: {
      ref: `ecology:${index}`,
      digest: String(index).padStart(64, "b").slice(-64),
      status: "completed",
      agentCount: 3,
      assignmentCount: 4
    },
    curriculumSignals: [],
    dataPolicy: dataPolicy || {
      sourceClass: "internal-authorized",
      permittedUses: ["evaluation", "research", "training"],
      trainingApproved: true,
      contaminationTags: []
    }
  }));
}

test("AMOS system training examples require every privacy and verification safeguard", () => {
  const input = exampleInput("example-1", "episode-1", "tool-use");
  input.safeguards.hiddenReasoningExcluded = false;
  assert.throws(() => createAmosSystemTrainingExample(input), /hiddenReasoningExcluded/);
});

test("the exporter produces immutable family-disjoint SFT and preference datasets", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-native-store-"));
  const output = await mkdtemp(join(tmpdir(), "amos-native-output-"));
  const store = await openSwarmLearningStore(root);
  await recordTrainingEpisode(store, 1, "tool-use", true);
  await recordTrainingEpisode(store, 2, "artifact-build");
  await recordTrainingEpisode(store, 3, "recovery");

  const dataset = await compileAmosNativeTrainingDataset({ store, plan });
  assert.equal(dataset.ready, true);
  assert.deepEqual(dataset.manifest.blockers, []);
  assert.equal(dataset.manifest.counts.examples, 3);
  assert.equal(dataset.manifest.counts.preferencePairs, 1);
  assert.equal(dataset.manifest.safeguards.publicBenchmarksExcluded, true);

  const written = await writeAmosNativeTrainingDataset(output, dataset);
  const manifest = JSON.parse(await readFile(join(written.output, "dataset-manifest.json"), "utf8"));
  assert.equal(manifest.digest, dataset.manifest.digest);
  assert.match(await readFile(join(output, "training.sft.jsonl"), "utf8"), /messages/);
  await writeAmosNativeTrainingDataset(output, dataset);
});

test("licensed public development examples mix into training and remain excluded from evaluation", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-native-mixed-"));
  const store = await openSwarmLearningStore(root);
  await recordTrainingEpisode(store, 1, "tool-use", true, {
    sourceClass: "public-benchmark",
    permittedUses: ["research", "training"],
    trainingApproved: true,
    contaminationTags: [
      "license:apache-2.0:terminal-bench-3.0.0-production-planning",
      "exclude-eval:terminal-bench-3.0.0:production-planning"
    ]
  });
  await recordTrainingEpisode(store, 2, "artifact-build");
  await recordTrainingEpisode(store, 3, "recovery");

  const dataset = await compileAmosNativeTrainingDataset({ store, plan });
  assert.equal(dataset.ready, true);
  assert.equal(dataset.manifest.counts.publicBenchmarkEpisodes, 1);
  assert.equal(dataset.manifest.safeguards.publicBenchmarksExcluded, false);
  assert.equal(dataset.manifest.safeguards.publicBenchmarkEvaluationReuseForbidden, true);
  assert.deepEqual(dataset.manifest.evaluationExclusions, [
    "exclude-eval:terminal-bench-3.0.0:production-planning"
  ]);
});

test("the current public-benchmark-only store stays safely data-gated", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-native-empty-"));
  const store = await openSwarmLearningStore(root);
  const dataset = await compileAmosNativeTrainingDataset({ store, plan });
  assert.equal(dataset.ready, false);
  assert.ok(dataset.manifest.blockers.includes("training-examples:0/1"));
  await assert.rejects(
    () => writeAmosNativeTrainingDataset(join(root, "output"), dataset),
    /unqualified/
  );
});
