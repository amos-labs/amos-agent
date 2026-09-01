#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  validateAmosOwnedMissionVerifierManifest,
  verifyAmosOwnedMissionAnswer
} from "../src/research/amosOwnedMissionArena.js";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { validateSwarmDevelopmentMissions } from "../src/research/swarmExperimentConfig.js";
import { createSwarmLearningEpisode } from "../src/research/swarmLearningArena.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const args = process.argv.slice(2);
const reportPath = resolve(requiredOption("--report"));
const storePath = resolve(option("--store") || ".amos-agent/research/swarm-learning");
const missionsPath = resolve(option("--missions") ||
  "benchmarks/swarm-organism-owned-missions-v1.json");
const verifiersPath = resolve(option("--verifiers") ||
  "benchmarks/swarm-organism-owned-verifiers-v1.json");

const [report, missionManifest, verifierManifest] = await Promise.all([
  readJson(reportPath),
  readJson(missionsPath).then(validateSwarmDevelopmentMissions),
  readJson(verifiersPath).then(validateAmosOwnedMissionVerifierManifest)
]);
validateReport(report, missionManifest);
const missions = new Map(missionManifest.missions.map((mission) => [mission.id, mission]));
const verifiers = new Map(verifierManifest.verifiers.map((verifier) =>
  [verifier.missionId, verifier]));
const store = await openSwarmLearningStore(storePath);
const reportBytes = await readFile(reportPath);
const reportBlobDigest = await store.putBlob(reportBytes);
const recorded = [];

for (const record of report.runs) {
  const run = record.run;
  const mission = missions.get(record.missionId);
  const verifier = verifiers.get(record.missionId);
  if (!mission || !verifier) throw new Error(`Missing mission verifier for ${record.missionId}`);
  if (run.mode !== "swarm" || run.controlId !== "qwen-swarm") {
    throw new Error("AMOS-owned organism episodes require Qwen Swarm runs");
  }
  const receipt = verifyAmosOwnedMissionAnswer({
    mission,
    verifier,
    answer: run.result.answer
  });
  const receiptDigest = await store.putBlob(Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
  const runDigest = record.runDigest || digestResearchValue(run);
  if (runDigest !== digestResearchValue(run)) throw new Error("Run digest mismatch");
  const runBlobDigest = await store.putBlob(Buffer.from(`${JSON.stringify(run, null, 2)}\n`));
  const answerDigest = await store.putBlob(Buffer.from(run.result.answer, "utf8"));
  const ecology = ecologyRecord({ run, receipt, verifier });
  const ecologyDigest = await store.putBlob(Buffer.from(`${JSON.stringify(ecology, null, 2)}\n`));
  const episode = createSwarmLearningEpisode({
    id: `amos-owned-${mission.id}-r${record.repetition}-${runDigest.slice(0, 12)}`,
    treatmentId: "amos-owned-qwen-swarm-curriculum-v1",
    partition: "development",
    task: {
      source: "amos-owned-mission-curriculum",
      name: verifier.family,
      ref: `${missionManifest.id}:${mission.id}`,
      checksum: digestResearchValue(mission)
    },
    model: {
      provider: "amos",
      name: report.control.model,
      agent: "amos-qwen-swarm-v0",
      agentVersion: report.sourceDigest || report.sourceRevision,
      sharedBackbone: true
    },
    execution: {
      status: "completed",
      startedAt: run.startedAt,
      finishedAt: run.completedAt,
      exception: null
    },
    verifier: {
      kind: "amos-owned-pre-registered-concept-verifier",
      status: receipt.passed ? "passed" : "failed",
      score: receipt.passed ? 1 : 0,
      evidenceRefs: [blobReference(receiptDigest, "verifier-receipt.json")]
    },
    artifacts: [{
      ref: blobReference(answerDigest, "answer.txt"),
      kind: "final-answer",
      status: "collected",
      digest: answerDigest
    }],
    traces: [
      {
        ref: blobReference(runBlobDigest, "swarm-run.json"),
        kind: "qwen-swarm-trajectory",
        status: "collected",
        digest: runBlobDigest
      },
      {
        ref: blobReference(reportBlobDigest, "experiment-report.json"),
        kind: "experiment-report",
        status: "collected",
        digest: reportBlobDigest
      }
    ],
    ecology: {
      ref: blobReference(ecologyDigest, "organism-ecology.json"),
      digest: ecologyDigest,
      status: "completed",
      agentCount: new Set(ecology.assignments.map(({ agentId }) => agentId)).size,
      assignmentCount: ecology.assignments.length
    },
    curriculumSignals: receipt.failedCriterionIds.map((id) => `verifier-gap:${id}`),
    dataPolicy: {
      sourceClass: "internal-authorized",
      permittedUses: ["research", "training"],
      trainingApproved: true,
      contaminationTags: [
        `amos-owned-development:${missionManifest.id}`,
        `exclude-eval:${missionManifest.id}:${verifier.family}`
      ]
    }
  });
  recorded.push(await store.recordEpisode(episode));
}

const arena = await store.arena();
console.log(JSON.stringify({
  store: storePath,
  reportDigest: report.reportDigest,
  recorded: recorded.map(({ id, digest, outcome, trainingEligibility }) => ({
    id,
    digest,
    outcome,
    trainingEligibility
  })),
  organismPolicyEpisodes: arena.replayBatch({ purpose: "router", limit: 100_000 })
    .episodeDigests.length,
  adapterReplayEpisodes: arena.replayBatch({ purpose: "adapter", limit: 100_000 })
    .episodeDigests.length
}, null, 2));

function ecologyRecord({ run, receipt, verifier }) {
  const assignments = run.stages.map((stage, index) => ({
    taskId: `${run.mission.id}:${stage.role}`,
    role: stage.role,
    agentId: `qwen-${stage.role}`,
    status: receipt.passed || stage.role !== "integrator" ? "completed" : "progressed",
    bid: { affinity: 0.5, source: "baseline-untrained" },
    modelCalls: Array.isArray(stage.observations) ? stage.observations.length : 0,
    outputTokens: Number(stage.metrics?.outputTokens || 0),
    sequence: index + 1
  }));
  return {
    schema: "amos.owned-mission-ecology",
    version: 1,
    missionId: run.mission.id,
    verifierId: verifier.id,
    verifierPassed: receipt.passed,
    evidenceBoardDigest: run.evidenceBoard?.digest || null,
    assignments
  };
}

function validateReport(report, missionManifest) {
  if (report?.schema !== "amos.swarm-experiment-report" || report.version !== 1) {
    throw new Error("Unsupported swarm experiment report");
  }
  if (!Array.isArray(report.runs) || report.runs.length < 1) {
    throw new Error("Swarm experiment report has no completed runs");
  }
  if (report.control?.id !== "qwen-swarm" || report.control?.mode !== "swarm") {
    throw new Error("Report is not a Qwen Swarm treatment");
  }
  if (report.missionManifestId !== missionManifest.id ||
      report.missionManifestDigest !== digestResearchValue(missionManifest)) {
    throw new Error("Report mission manifest lineage does not match");
  }
  const claimed = report.reportDigest;
  const unsigned = structuredClone(report);
  unsigned.reportDigest = null;
  if (digestResearchValue(unsigned) !== claimed) throw new Error("Report digest mismatch");
}

function blobReference(digest, label) {
  return `sha256:${digest}:${label}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}
