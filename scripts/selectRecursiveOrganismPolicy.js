#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { digestResearchValue } from "../src/research/experimentProtocol.js";

const args = process.argv.slice(2);
const queuePath = resolve(requiredOption("--queue"));
const outputPath = resolve(requiredOption("--output"));
const cycleId = requiredOption("--cycle-id");
const queue = JSON.parse(await readFile(queuePath, "utf8"));
if (queue?.schema !== "amos.swarm-organism-artifact-replay-queue" || queue?.version !== 1) {
  throw new Error("Unsupported organism artifact replay queue");
}
const candidate = queue.candidates?.find(({ status, nextGate }) =>
  status === "qualifying" && nextGate === "real-qwen-phase-probes"
);
if (!candidate) throw new Error("No candidate passed immutable artifact replay");
const policyDigest = digestResearchValue(candidate.policy);
const manifestBase = {
  schema: "amos.swarm-organism-recursive-research-policy",
  version: 1,
  id: `${safeId(cycleId)}-${safeId(candidate.id)}`,
  status: "research-cycle-only",
  promotionAllowed: false,
  automaticallyDeployed: false,
  nextGate: candidate.nextGate,
  policyDigest,
  policy: candidate.policy,
  candidateDigest: candidate.digest,
  provenance: {
    sourceArtifactReplayQueueDigest: queue.digest,
    sourceCandidateId: candidate.id,
    completedGates: candidate.gates.map(({ id, receiptDigest }) => ({ id, receiptDigest }))
  }
};
const manifest = { ...manifestBase, digest: digestResearchValue(manifestBase) };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  candidateId: candidate.id,
  policyDigest,
  nextGate: candidate.nextGate,
  promotionAllowed: false
}, null, 2));

function requiredOption(name) {
  const index = args.indexOf(name);
  const value = index === -1 ? null : args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function safeId(value) {
  return String(value).trim().replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 199) || "cycle";
}
