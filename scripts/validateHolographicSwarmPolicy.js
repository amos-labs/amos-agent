#!/usr/bin/env node

import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { normalizeOrganismPolicy } from "../src/research/swarmOrganismSimulator.js";

const input = JSON.parse(await readStandardInput());
const candidateIndex = Number(input.candidateIndex ?? 0);
if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
  throw new Error("candidateIndex must be a non-negative integer");
}

const source = input.source ?? {};
let candidate = null;
let policySource = source;
if (Array.isArray(source.candidates)) {
  candidate = source.candidates[candidateIndex];
  if (!candidate) throw new Error(`Policy candidate ${candidateIndex} does not exist`);
  policySource = candidate.policy;
} else if (source.policy && typeof source.policy === "object" && !Array.isArray(source.policy)) {
  candidate = source;
  policySource = source.policy;
}

if (candidate?.digest) {
  const { digest, ...unsigned } = candidate;
  if (digestResearchValue(unsigned) !== digest) {
    throw new Error("Organism policy candidate digest mismatch");
  }
}

const policy = normalizeOrganismPolicy(policySource);
const policyDigest = digestResearchValue(policy);
if (input.expectedPolicyDigest && input.expectedPolicyDigest !== policyDigest) {
  throw new Error("Organism policy digest mismatch");
}

process.stdout.write(`${JSON.stringify({
  policy,
  policyDigest,
  candidateId: candidate?.id ?? null,
  candidateDigest: candidate?.digest ?? null,
  provenance: candidate?.provenance ?? null
})}\n`);

async function readStandardInput() {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value;
}
