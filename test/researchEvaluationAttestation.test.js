import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  createResearchEvaluationAttestation,
  validateResearchEvaluationAttestation,
  verifyResearchEvaluationAttestation
} from "../src/research/evaluationAttestation.js";
import {
  RESEARCH_TEST_DIGESTS,
  researchEvaluationManifest,
  researchExperimentOutcome,
  researchExperimentProposal
} from "./fixtures/researchProtocolFixtures.js";

const EVALUATOR = Object.freeze({
  id: "sealed-evaluator",
  version: "1.0.0",
  environmentDigest: RESEARCH_TEST_DIGESTS.d
});

test("a sealed evaluator signs the exact evidence and deterministic promotion decision", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  const outcome = researchExperimentOutcome(proposal, manifest);
  const attestation = createResearchEvaluationAttestation({
    proposal,
    evaluationManifest: manifest,
    outcome,
    evaluator: EVALUATOR,
    privateKey,
    keyId: "sealed-evaluator-key-2026-08",
    issuedAt: "2026-08-22T10:13:00.000Z"
  });

  assert.deepEqual(validateResearchEvaluationAttestation(attestation), attestation);
  const verified = verifyResearchEvaluationAttestation({
    attestation,
    proposal,
    evaluationManifest: manifest,
    outcome,
    publicKey
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.decision.eligible, true);
  assert.deepEqual(attestation.payload.reasons, []);
});

test("attestation verification fails closed when evidence or the decision is changed", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  const outcome = researchExperimentOutcome(proposal, manifest);
  const attestation = createResearchEvaluationAttestation({
    proposal,
    evaluationManifest: manifest,
    outcome,
    evaluator: EVALUATOR,
    privateKey,
    keyId: "sealed-evaluator-key-2026-08",
    issuedAt: "2026-08-22T10:13:00.000Z"
  });

  const tamperedAttestation = structuredClone(attestation);
  tamperedAttestation.payload.outcomeDigest = RESEARCH_TEST_DIGESTS.a;
  assert.throws(
    () => verifyResearchEvaluationAttestation({
      attestation: tamperedAttestation,
      proposal,
      evaluationManifest: manifest,
      outcome,
      publicKey
    }),
    /does not match the supplied research evidence/
  );

  const tamperedKeyId = structuredClone(attestation);
  tamperedKeyId.keyId = "another-evaluator-key";
  assert.throws(
    () => verifyResearchEvaluationAttestation({
      attestation: tamperedKeyId,
      proposal,
      evaluationManifest: manifest,
      outcome,
      publicKey
    }),
    /signature is invalid/
  );

  const tamperedOutcome = structuredClone(outcome);
  tamperedOutcome.usage.costUsd += 1;
  assert.throws(
    () => verifyResearchEvaluationAttestation({
      attestation,
      proposal,
      evaluationManifest: manifest,
      outcome: tamperedOutcome,
      publicKey
    }),
    /does not match the supplied research evidence/
  );
});

test("an otherwise valid attestation cannot be verified with another evaluator key", () => {
  const signer = generateKeyPairSync("ed25519");
  const otherEvaluator = generateKeyPairSync("ed25519");
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  const outcome = researchExperimentOutcome(proposal, manifest);
  const attestation = createResearchEvaluationAttestation({
    proposal,
    evaluationManifest: manifest,
    outcome,
    evaluator: EVALUATOR,
    privateKey: signer.privateKey,
    keyId: "sealed-evaluator-key-2026-08",
    issuedAt: "2026-08-22T10:13:00.000Z"
  });

  assert.throws(
    () => verifyResearchEvaluationAttestation({
      attestation,
      proposal,
      evaluationManifest: manifest,
      outcome,
      publicKey: otherEvaluator.publicKey
    }),
    /signature is invalid/
  );
});

test("attestations preserve a deterministic rejection reason set", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  const outcome = researchExperimentOutcome(proposal, manifest);
  outcome.usage.costUsd = proposal.budget.maxCostUsd + 1;
  const attestation = createResearchEvaluationAttestation({
    proposal,
    evaluationManifest: manifest,
    outcome,
    evaluator: EVALUATOR,
    privateKey,
    keyId: "sealed-evaluator-key-2026-08",
    issuedAt: "2026-08-22T10:13:00.000Z"
  });

  const verified = verifyResearchEvaluationAttestation({
    attestation,
    proposal,
    evaluationManifest: manifest,
    outcome,
    publicKey
  });
  assert.equal(verified.decision.eligible, false);
  assert.deepEqual(attestation.payload.reasons, ["budget-exceeded:costUsd"]);
});

test("the signing boundary rejects a non-Ed25519 key", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const manifest = researchEvaluationManifest();
  const proposal = researchExperimentProposal(manifest);
  const outcome = researchExperimentOutcome(proposal, manifest);

  assert.throws(
    () => createResearchEvaluationAttestation({
      proposal,
      evaluationManifest: manifest,
      outcome,
      evaluator: EVALUATOR,
      privateKey,
      keyId: "wrong-key",
      issuedAt: "2026-08-22T10:13:00.000Z"
    }),
    /private key must be Ed25519/
  );
});
