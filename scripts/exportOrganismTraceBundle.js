#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";
import {
  createVerifiedProcedureApproval,
  extractVerifiedSwarmProcedure
} from "../src/research/swarmProcedureExtraction.js";
import {
  ORGANISM_CONTRACT_VERSION,
  ORGANISM_TRACE_BUNDLE_SCHEMA,
} from "../src/research/organismContracts.js";

const args = process.argv.slice(2);
const collectionPath = resolve(requiredOption("--collection"));
const storePath = resolve(requiredOption("--store"));
const outputPath = resolve(requiredOption("--output"));
const explicitRunId = optionalOption("--run-id");
const autoApproveVerifiedGenes = args.includes("--auto-approve-verified-genes");
const collection = JSON.parse(await readFile(collectionPath, "utf8"));
if (collection.schema !== "amos.harbor-swarm-collection" || collection.version !== 1) {
  throw new Error("Unsupported Harbor swarm collection summary");
}
const runId = explicitRunId || collection.sourceRunId;
if (!runId) throw new Error("A source run id is required");

const store = await openSwarmLearningStore(storePath);
const entries = [];
for (const record of collection.recorded || []) {
  const episode = await store.readEpisode(String(record.id));
  if (episode.digest !== record.digest) {
    throw new Error(`Collection digest does not match episode ${episode.id}`);
  }
  const ecology = episode.ecology?.digest
    ? JSON.parse((await store.readBlob(episode.ecology.digest)).toString("utf8"))
    : null;
  const trace = episodeToTrace(episode, runId, ecology);
  entries.push({
    receipt: {
      id: `trace-imported-${episode.digest.slice(0, 24)}`,
      missionId: runId,
      kind: "trace-imported",
      issuedAt: episode.execution.finishedAt,
      payloadDigest: digestResearchValue(trace),
      authority: "host"
    },
    trace
  });
}
if (entries.length === 0) throw new Error("Collection contains no recorded episodes");

const bundle = {
  schema: ORGANISM_TRACE_BUNDLE_SCHEMA,
  schemaVersion: ORGANISM_CONTRACT_VERSION,
  source: {
    kind: "amos-harbor-swarm-collection",
    runId,
    collectionPath,
    episodeDigests: entries.map(({ trace }) => trace.sourceEpisodeDigest)
  },
  entries,
  approvals: autoApproveVerifiedGenes
    ? entries.map(({ trace }) => createVerifiedProcedureApproval({ trace })).filter(Boolean)
    : []
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({
  output: outputPath,
  runId,
  entries: entries.length,
  geneApprovals: bundle.approvals.length,
  verified: entries.filter(({ trace }) => trace.outcome.kind === "verified-success").length,
  negative: entries.filter(({ trace }) => trace.outcome.kind !== "verified-success").length
}, null, 2));

function episodeToTrace(episode, runId, ecology) {
  const outcomeKind = ({
    "verified-pass": "verified-success",
    "verified-fail": "verified-failure",
    "execution-error": "execution-error",
    cancelled: "cancelled",
    unverified: "unverified"
  })[episode.outcome.kind];
  if (!outcomeKind) throw new Error(`Unsupported episode outcome: ${episode.outcome.kind}`);
  const expressionReceipts = Array.isArray(ecology?.geneExpressions?.receipts)
    ? ecology.geneExpressions.receipts
    : [];
  const trace = {
    runId,
    trialId: episode.id,
    taskName: episode.task.name,
    taskFamily: episode.task.source,
    startedAt: episode.execution.startedAt,
    finishedAt: episode.execution.finishedAt,
    outcome: { kind: outcomeKind, score: episode.outcome.score },
    trainingEligibility: episode.trainingEligibility,
    verifier: episode.verifier.status === "not-run" ? null : {
      status: episode.verifier.status === "passed" ? "pass" : "fail",
      evidenceRefs: episode.verifier.evidenceRefs
    },
    artifactReceiptIds: episode.artifacts
      .filter(({ status, digest }) => status === "collected" && digest)
      .map(({ ref }) => ref),
    expressedGeneIds: [...new Set(expressionReceipts.flatMap(({ selections }) =>
      Array.isArray(selections)
        ? selections.map(({ geneId }) => String(geneId || "")).filter(Boolean)
        : []
    ))].sort(),
    geneExpressionReceiptIds: [...new Set(expressionReceipts
      .map(({ id }) => String(id || ""))
      .filter(Boolean))].sort(),
    procedure: extractVerifiedSwarmProcedure({ ecology, episode }),
    rightsTags: [
      `source-class:${episode.dataPolicy.sourceClass}`,
      ...episode.dataPolicy.permittedUses.map((use) => `permitted-use:${use}`)
    ].sort(),
    contaminationTags: episode.dataPolicy.contaminationTags,
    sourceEpisodeDigest: episode.digest
  };
  if (episode.execution.exception) trace.exception = episode.execution.exception;
  return trace;
}

function requiredOption(name) {
  const value = optionalOption(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalOption(name) {
  const index = args.indexOf(name);
  const value = index === -1 ? null : args[index + 1];
  if (index !== -1 && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
