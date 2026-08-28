import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSwarmLearningEpisode,
  organismPolicyTrainingEligibility,
  SwarmLearningArena,
  validateSwarmLearningEpisode
} from "../src/research/swarmLearningArena.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";
import { createSwarmFailureCapsule } from "../src/research/swarmFailureCapsule.js";

function episodeInput(overrides = {}) {
  return {
    id: "trial-001",
    treatmentId: "holographic-swarm-v1",
    partition: "operations",
    task: {
      source: "amos-missions",
      name: "production-plan",
      ref: "mission:001",
      checksum: "a".repeat(64)
    },
    model: {
      provider: "amos",
      name: "qwen-27b",
      agent: "amos-holographic-swarm",
      agentVersion: "0.1.0",
      sharedBackbone: true
    },
    execution: {
      status: "completed",
      startedAt: "2026-08-23T10:00:00.000Z",
      finishedAt: "2026-08-23T10:05:00.000Z",
      exception: null
    },
    verifier: {
      kind: "amos-deterministic",
      status: "passed",
      score: 1,
      evidenceRefs: ["receipt:verifier-001"]
    },
    artifacts: [{
      ref: "artifact:plan",
      kind: "solution",
      status: "collected",
      digest: "b".repeat(64)
    }],
    traces: [{
      ref: "trace:agent",
      kind: "trajectory",
      status: "collected",
      digest: "c".repeat(64)
    }],
    ecology: {
      ref: "ecology:001",
      digest: "d".repeat(64),
      status: "completed",
      agentCount: 6,
      assignmentCount: 8
    },
    curriculumSignals: [],
    dataPolicy: {
      sourceClass: "internal-authorized",
      permittedUses: ["evaluation", "research", "training", "distillation"],
      trainingApproved: true,
      contaminationTags: []
    },
    ...overrides
  };
}

test("verified rights-cleared episodes become eligible for replay and distillation", () => {
  const episode = createSwarmLearningEpisode(episodeInput());
  const arena = new SwarmLearningArena({ episodes: [episode] });

  assert.equal(episode.outcome.kind, "verified-pass");
  assert.deepEqual(episode.trainingEligibility, { eligible: true, reasons: [] });
  assert.deepEqual(arena.replayBatch({ purpose: "adapter" }).episodeDigests, [episode.digest]);
  assert.deepEqual(arena.replayBatch({ purpose: "distillation" }).episodeDigests, [episode.digest]);
});

test("public benchmark trajectories remain research evidence but cannot update weights", () => {
  const episode = createSwarmLearningEpisode(episodeInput({
    partition: "development",
    task: {
      source: "terminal-bench/terminal-bench",
      name: "production-planning",
      ref: "sha256:public-task",
      checksum: "e".repeat(64)
    },
    dataPolicy: {
      sourceClass: "public-benchmark",
      permittedUses: ["evaluation", "research"],
      trainingApproved: false,
      contaminationTags: ["terminal-bench-3.0.0:production-planning"]
    }
  }));
  const arena = new SwarmLearningArena({ episodes: [episode] });

  assert.equal(episode.trainingEligibility.eligible, false);
  assert.ok(episode.trainingEligibility.reasons.includes("training-use-not-permitted"));
  assert.deepEqual(arena.replayBatch({ purpose: "research" }).episodeDigests, [episode.digest]);
  assert.deepEqual(arena.replayBatch({ purpose: "router" }).episodeDigests, []);
  assert.equal(arena.buildCurriculum().challenges[0].mayUpdateWeights, false);
});

test("public benchmark training fails closed without license and evaluation exclusions", () => {
  assert.throws(
    () => createSwarmLearningEpisode(episodeInput({
      partition: "development",
      dataPolicy: {
        sourceClass: "public-benchmark",
        permittedUses: ["evaluation", "research", "training"],
        trainingApproved: true,
        contaminationTags: []
      }
    })),
    /cannot be both training and evaluation|license evidence|evaluation exclusion/
  );
});

test("licensed public development failures can train organism policy but not adapter weights", () => {
  const episode = createSwarmLearningEpisode(episodeInput({
    id: "terminal-bench-negative-001",
    partition: "development",
    execution: {
      status: "errored",
      startedAt: "2026-08-23T10:00:00.000Z",
      finishedAt: "2026-08-23T10:05:00.000Z",
      exception: { type: "RuntimeError", message: "repeated control-envelope failure" }
    },
    verifier: {
      kind: "harbor-official-deterministic",
      status: "not-run",
      score: null,
      evidenceRefs: []
    },
    dataPolicy: {
      sourceClass: "public-benchmark",
      permittedUses: ["research", "training"],
      trainingApproved: true,
      contaminationTags: [
        "license:apache-2.0:terminal-bench-3.0.0-production-planning",
        "exclude-eval:terminal-bench-3.0.0:production-planning"
      ]
    }
  }));
  const arena = new SwarmLearningArena({ episodes: [episode] });

  assert.equal(episode.trainingEligibility.eligible, false);
  assert.deepEqual(organismPolicyTrainingEligibility(episode), { eligible: true, reasons: [] });
  assert.deepEqual(arena.replayBatch({ purpose: "router" }).episodeDigests, [episode.digest]);
  assert.deepEqual(arena.replayBatch({ purpose: "adapter" }).episodeDigests, []);
  assert.equal(arena.buildCurriculum().challenges[0].mayUpdateOrganismPolicy, true);
});

test("adapter pipeline proofs cannot masquerade as organism experience", () => {
  const episode = createSwarmLearningEpisode(episodeInput({
    id: "stage0-pipeline-proof-001",
    dataPolicy: {
      sourceClass: "rights-cleared-synthetic",
      permittedUses: ["research", "training"],
      trainingApproved: true,
      contaminationTags: ["stage0-pipeline-proof"]
    }
  }));

  assert.equal(episode.trainingEligibility.eligible, true);
  assert.deepEqual(organismPolicyTrainingEligibility(episode), {
    eligible: false,
    reasons: ["pipeline-proof-not-organism-experience"]
  });
});

test("validation episodes stay outside replay even with otherwise valid evidence", () => {
  const episode = createSwarmLearningEpisode(episodeInput({ partition: "validation" }));
  assert.equal(episode.trainingEligibility.eligible, false);
  assert.ok(episode.trainingEligibility.reasons.includes("protected-evaluation-partition"));
});

test("execution errors generate targeted curriculum but never enter training replay", () => {
  const episode = createSwarmLearningEpisode(episodeInput({
    execution: {
      status: "errored",
      startedAt: "2026-08-23T10:00:00.000Z",
      finishedAt: "2026-08-23T10:01:00.000Z",
      exception: { type: "RuntimeError", message: "state compiler made no progress" }
    },
    verifier: {
      kind: "official-deterministic",
      status: "not-run",
      score: null,
      evidenceRefs: []
    },
    curriculumSignals: ["state-compiler", "no-progress"]
  }));
  const arena = new SwarmLearningArena({ episodes: [episode] });
  const [challenge] = arena.buildCurriculum().challenges;

  assert.equal(episode.outcome.kind, "execution-error");
  assert.equal(challenge.mode, "targeted-repair");
  assert.deepEqual(challenge.focus, ["no-progress", "state-compiler"]);
  assert.deepEqual(arena.replayBatch({ purpose: "adapter" }).episodeDigests, []);
});

test("derived eligibility and outcome cannot be forged", () => {
  const episode = createSwarmLearningEpisode(episodeInput());
  assert.throws(
    () => validateSwarmLearningEpisode({
      ...episode,
      trainingEligibility: { eligible: false, reasons: ["forged"] }
    }),
    /digest|eligibility/
  );
});

test("the file-backed store is content-addressed, immutable, and replayable", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-swarm-learning-"));
  const store = await openSwarmLearningStore(root);
  const episode = createSwarmLearningEpisode(episodeInput());
  const stored = await store.recordEpisode(episode);
  const blobDigest = await store.putBlob(Buffer.from("durable trajectory"));
  const reread = await store.readEpisode(episode.id);

  assert.equal(stored.digest, episode.digest);
  assert.equal((await store.readBlob(blobDigest)).toString("utf8"), "durable trajectory");
  assert.equal(reread.digest, episode.digest);
  assert.equal((await store.listEpisodes()).length, 1);
  assert.deepEqual((await store.arena()).replayBatch({ purpose: "adapter" }).episodeDigests, [
    episode.digest
  ]);
  assert.match(
    await readFile(join(root, "episodes", `${episode.id}.ref`), "utf8"),
    new RegExp(`^${episode.digest}`)
  );
  const mutated = createSwarmLearningEpisode(episodeInput({ treatmentId: "mutated" }));
  await assert.rejects(() => store.recordEpisode(mutated), /Immutable swarm learning record differs/);
});

test("the store indexes exact-task failure capsules without making them authoritative", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-swarm-capsules-"));
  const store = await openSwarmLearningStore(root);
  const instructionDigest = "9".repeat(64);
  const sourceDigest = await store.putBlob(Buffer.from("def construct():\n    return 1\n"));
  const capsule = createSwarmFailureCapsule({
    task: {
      source: "terminal-bench/terminal-bench",
      name: "production-planning",
      ref: "3.0.0",
      instructionDigest
    },
    result: {
      started_at: "2026-08-26T20:00:00.000Z",
      finished_at: "2026-08-26T20:01:00.000Z"
    },
    repairableCandidate: {
      available: true,
      selection: "challenger",
      source: {
        ref: `blob:sha256:${sourceDigest}/challenger%2Fsolver_impl.py`,
        digest: sourceDigest,
        bytes: 30
      },
      evidence: {
        implementationPresent: true,
        implementationSyntaxValid: true,
        implementationSubstantive: true,
        implementationSha256: sourceDigest
      }
    }
  });

  const recorded = await store.recordFailureCapsule(capsule);
  const indexed = await store.listFailureCapsules({ instructionDigest });

  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].blobDigest, recorded.blobDigest);
  assert.equal(indexed[0].capsule.digest, capsule.digest);
  assert.equal(indexed[0].capsule.safeguards.grantsCompletionCredit, false);
  assert.match(
    await readFile(
      join(root, "capsules", "by-instruction", instructionDigest, `${capsule.digest}.ref`),
      "utf8"
    ),
    new RegExp(`^${recorded.blobDigest}`)
  );
});
