import assert from "node:assert/strict";
import test from "node:test";
import {
  createVerifiedProcedureApproval,
  extractVerifiedSwarmProcedure
} from "../src/research/swarmProcedureExtraction.js";

function episode(overrides = {}) {
  return {
    outcome: { kind: "verified-pass" },
    verifier: { status: "passed", evidenceRefs: ["verifier:1"] },
    dataPolicy: {
      sourceClass: "public-development",
      permittedUses: ["research", "training"],
      contaminationTags: ["development-visible"],
    },
    ...overrides,
  };
}

function ecology() {
  return {
    schema: "amos.holographic-swarm-harbor-run",
    outcomeMemories: [{
      schema: "amos.holographic-outcome-memory",
      id: "outcome-1",
      verifiedBy: "amos-host-outcome-boundary",
      authority: { hostObservedOnly: true, grantsCompletionCredit: false },
      evidenceRefs: ["host-outcome:abc"],
      stateBefore: { boardPhase: "construction-checkpoint-2" },
      reward: { amount: 0.5 },
      attemptedStrategy: {
        role: "solver-builder",
        procedure: {
          schema: "amos.holographic-procedural-gene",
          version: 1,
          stateSignature: "a".repeat(64),
          preconditions: {
            repairSignals: ["sequence-repair"],
            failedCheckIds: ["seq-contiguous"],
          },
          operation: {
            hypothesis: "The interval update skips the next contiguous position.",
            nextAction: "Advance from the emitted interval boundary and rerun every check.",
            transport: "bounded-atomic-mutation",
          },
          observedEffects: { promoted: true },
          portability: {
            role: "solver-builder",
            taskSpecificIdentifiersExcluded: true,
          },
          authority: { retrievalOnly: true, grantsCompletionCredit: false },
        },
      },
    }],
  };
}

test("verified host outcomes become portable organism procedure candidates", () => {
  const procedure = extractVerifiedSwarmProcedure({ ecology: ecology(), episode: episode() });

  assert.ok(procedure);
  assert.equal(procedure.schema, "amos.strategy-gene-procedure");
  assert.equal(procedure.schemaVersion, 1);
  assert.match(procedure.spec.name, /^learned-solver-builder-/);
  assert.deepEqual(procedure.spec.preconditions.failureModes, ["seq-contiguous", "sequence-repair"]);
  assert.equal(procedure.spec.procedure.length, 2);
  assert.deepEqual(procedure.evidenceRefs, ["host-outcome:abc", "verifier:1"]);
});

test("failed or model-authored outcomes cannot become inherited procedure", () => {
  assert.equal(extractVerifiedSwarmProcedure({ ecology: ecology(), episode: episode({
    outcome: { kind: "verified-fail" },
  }) }), null);
  const forged = ecology();
  forged.outcomeMemories[0].verifiedBy = "model-claim";
  assert.equal(extractVerifiedSwarmProcedure({ ecology: forged, episode: episode() }), null);
});

test("verified procedure admission uses a separate deterministic host receipt", () => {
  const procedure = extractVerifiedSwarmProcedure({ ecology: ecology(), episode: episode() });
  const approval = createVerifiedProcedureApproval({
    trace: {
      runId: "run-1",
      trialId: "trial-1",
      finishedAt: "2026-08-26T00:00:00.000Z",
      outcome: { kind: "verified-success" },
      procedure,
    },
  });

  assert.ok(approval);
  assert.equal(approval.receipt.kind, "gene-approved");
  assert.equal(approval.receipt.authority, "host");
  assert.equal(approval.receipt.payloadDigest.length, 64);
  assert.equal(createVerifiedProcedureApproval({
    trace: { outcome: { kind: "verified-failure" }, procedure },
  }), null);
});
