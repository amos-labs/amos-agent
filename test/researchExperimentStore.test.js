import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResearchEvaluationAttestation } from "../src/research/evaluationAttestation.js";
import { openResearchExperimentStore } from "../src/research/experimentStore.js";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import {
  RESEARCH_TEST_DIGESTS,
  researchEvaluationManifest,
  researchExperimentOutcome,
  researchExperimentProposal
} from "./fixtures/researchProtocolFixtures.js";

test("the content-addressed store initializes idempotently and appends immutable heads", async (t) => {
  const store = await temporaryStore(t);
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  const initialized = await store.initializeExperiment(proposal, manifest);
  const repeated = await store.initializeExperiment(proposal, manifest);

  assert.equal(initialized.generation, 0);
  assert.equal(repeated.ledgerDigest, initialized.ledgerDigest);
  assert.equal(repeated.proposalDigest, digestResearchValue(proposal));

  const approved = await store.appendEvent(proposal.id, {
    type: "approved",
    at: "2026-08-22T10:01:00.000Z",
    actor: { kind: "human", id: "research-owner" },
    subjectDigest: RESEARCH_TEST_DIGESTS.b
  });
  assert.equal(approved.generation, 1);
  assert.equal(approved.ledger.state, "approved");

  const loaded = await store.loadExperiment(proposal.id);
  assert.equal(loaded.ledgerDigest, approved.ledgerDigest);
  assert.equal(loaded.ledger.events.length, 2);
});

test("the experiment lock serializes racing state transitions", async (t) => {
  const store = await temporaryStore(t);
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  await store.initializeExperiment(proposal, manifest);
  await store.appendEvent(proposal.id, {
    type: "approved",
    at: "2026-08-22T10:01:00.000Z",
    actor: { kind: "human", id: "research-owner" },
    subjectDigest: RESEARCH_TEST_DIGESTS.b
  });
  await store.appendEvent(proposal.id, {
    type: "started",
    at: "2026-08-22T10:02:00.000Z",
    actor: { kind: "service", id: "qwen-research-runner" },
    subjectDigest: RESEARCH_TEST_DIGESTS.c
  });

  const results = await Promise.allSettled([
    store.appendEvent(proposal.id, {
      type: "aborted",
      at: "2026-08-22T10:03:00.000Z",
      actor: { kind: "service", id: "budget-enforcer" },
      subjectDigest: RESEARCH_TEST_DIGESTS.d
    }),
    store.appendEvent(proposal.id, {
      type: "outcome_recorded",
      at: "2026-08-22T10:03:00.000Z",
      actor: { kind: "service", id: "sealed-evaluator" },
      subjectDigest: RESEARCH_TEST_DIGESTS.e
    })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const loaded = await store.loadExperiment(proposal.id);
  assert.equal(loaded.generation, 3);
  assert.equal(loaded.ledger.events.length, 4);
  assert.ok(["aborted", "evaluating"].includes(loaded.ledger.state));
});

test("a stale lock is recovered without discarding completed experiment history", async (t) => {
  const store = await temporaryStore(t, { staleLockMs: 20, lockRetryMs: 2 });
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  await store.initializeExperiment(proposal, manifest);
  const lockPath = store.experimentPaths(proposal.id).lock;
  await writeFile(lockPath, `${JSON.stringify({ token: "crashed-worker" })}\n`, { mode: 0o600 });
  const staleTime = new Date(Date.now() - 1_000);
  await utimes(lockPath, staleTime, staleTime);

  const approved = await store.appendEvent(proposal.id, {
    type: "approved",
    at: "2026-08-22T10:01:00.000Z",
    actor: { kind: "human", id: "research-owner" },
    subjectDigest: RESEARCH_TEST_DIGESTS.b
  });
  assert.equal(approved.ledger.state, "approved");
});

test("tampered objects fail closed while unreferenced crash artifacts are ignored", async (t) => {
  const store = await temporaryStore(t);
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  const initialized = await store.initializeExperiment(proposal, manifest);
  await store.putObject({ orphanedByCrash: true });
  assert.equal((await store.loadExperiment(proposal.id)).ledger.state, "proposed");

  await writeFile(
    store.objectPath(initialized.ledgerDigest),
    `${JSON.stringify({ tampered: true })}\n`
  );
  await assert.rejects(
    () => store.loadExperiment(proposal.id),
    /does not match its content digest/
  );
});

test("the store rejects path traversal experiment ids", async (t) => {
  const store = await temporaryStore(t);
  await assert.rejects(
    () => store.loadExperiment("../outside"),
    /Experiment id must use only/
  );
});

test("a signed evaluator outcome becomes the only recorded evaluation subject", async (t) => {
  const store = await temporaryStore(t);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  const outcome = researchExperimentOutcome(proposal, manifest);
  await store.initializeExperiment(proposal, manifest);
  await store.appendEvent(proposal.id, {
    type: "approved",
    at: "2026-08-22T10:01:00.000Z",
    actor: { kind: "human", id: "research-owner" },
    subjectDigest: RESEARCH_TEST_DIGESTS.b
  });
  await store.appendEvent(proposal.id, {
    type: "started",
    at: "2026-08-22T10:02:00.000Z",
    actor: { kind: "service", id: "qwen-research-runner" },
    subjectDigest: RESEARCH_TEST_DIGESTS.c
  });
  const attestation = createResearchEvaluationAttestation({
    proposal,
    evaluationManifest: manifest,
    outcome,
    evaluator: {
      id: "sealed-evaluator",
      version: "1.0.0",
      environmentDigest: RESEARCH_TEST_DIGESTS.d
    },
    privateKey,
    keyId: "sealed-evaluator-key-2026-08",
    issuedAt: "2026-08-22T10:13:00.000Z"
  });

  const recorded = await store.recordAttestedOutcome(proposal.id, {
    outcome,
    attestation,
    publicKey
  });
  assert.equal(recorded.ledger.state, "evaluating");
  assert.equal(recorded.decision.eligible, true);
  assert.equal(recorded.ledger.events.at(-1).subjectDigest, recorded.attestationDigest);
  assert.deepEqual(await store.readObject(recorded.outcomeDigest), outcome);
  assert.deepEqual(await store.readObject(recorded.attestationDigest), attestation);
});

async function temporaryStore(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "amos-research-store-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return openResearchExperimentStore(root, options);
}
