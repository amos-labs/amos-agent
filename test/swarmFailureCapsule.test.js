import assert from "node:assert/strict";
import test from "node:test";
import {
  createSwarmFailureCapsule,
  validateSwarmFailureCapsule
} from "../src/research/swarmFailureCapsule.js";

test("failure capsules preserve objective repair evidence and HRR safety telemetry", () => {
  const digest = "a".repeat(64);
  const capsule = createSwarmFailureCapsule({
    task: { source: "terminal-bench", name: "production-planning", ref: "3.0.0" },
    result: {
      exception_info: {
        exception_type: "RuntimeError",
        exception_message: "Task swarm exhausted construction cycles"
      }
    },
    ecology: {
      status: "failed",
      cycle: 6,
      assignments: [{
        cycle: 6,
        role: "solver-builder",
        agentId: "builder",
        status: "incomplete",
        progressArtifacts: [{ path: "/tmp/amos_swarm/solver.py" }],
        verifiedProgressReceipts: []
      }],
      dualChannelShadow: {
        mode: "read-only-shadow",
        authorityEnabled: false,
        behaviorInfluence: false,
        snapshots: [{
          representedEntries: 12,
          exactPositiveRate: 1,
          exactFalsePositiveRate: 0,
          authorityLeakRate: 0,
          representationDigest: digest
        }]
      }
    },
    selfCheck: {
      checks: [
        { id: "inventory", status: "failed", detail: "Substitute component inventory was not allocated." },
        { id: "schema", status: "passed" }
      ]
    },
    artifactReferences: [{ ref: "blob:one", kind: "workspace-artifact", status: "collected", digest }]
  });

  assert.equal(validateSwarmFailureCapsule(capsule).digest, capsule.digest);
  assert.deepEqual(capsule.failedChecks, [{
    id: "inventory",
    detail: "Substitute component inventory was not allocated."
  }]);
  assert.ok(capsule.repairSignals.includes("inventory-substitution-feasibility"));
  assert.equal(capsule.holographicWorld.snapshotCount, 1);
  assert.equal(capsule.holographicWorld.authorityLeakRate, 0);
  assert.equal(capsule.safeguards.authorityGrantedByHrr, false);
});

test("failure capsules never retain raw model or tool content", () => {
  const capsule = createSwarmFailureCapsule({
    task: { source: "test", name: "fixture" },
    result: {},
    ecology: null
  });

  assert.deepEqual(capsule.safeguards, {
    rawMessagesStored: false,
    rawReasoningStored: false,
    rawToolArgumentsStored: false,
    rawToolResultsStored: false,
    authorityGrantedByHrr: false,
    repairReuseOnly: true,
    exactTaskMatchRequired: true,
    freshVerificationRequired: true,
    grantsCompletionCredit: false
  });
  assert.equal(JSON.stringify(capsule).includes("tool_arguments"), false);
});

test("failure capsules bind a repairable challenger to exact task and source digests", () => {
  const sourceDigest = "c".repeat(64);
  const instructionDigest = "d".repeat(64);
  const capsule = createSwarmFailureCapsule({
    task: {
      source: "terminal-bench/terminal-bench",
      name: "production-planning",
      ref: "3.0.0",
      checksum: "e".repeat(64),
      instructionDigest
    },
    result: {
      id: "trial-1",
      started_at: "2026-08-26T20:00:00.000Z",
      finished_at: "2026-08-26T20:10:00.000Z"
    },
    candidateEvolution: {
      selection: "monotonic-incumbent-with-repairable-challenger",
      events: [{ challengerAdvanced: true, mutationReceiptValid: true }],
      challengerEvidence: {
        implementationPresent: true,
        implementationSyntaxValid: true,
        implementationSubstantive: true,
        implementationSha256: sourceDigest
      }
    },
    repairableCandidate: {
      available: true,
      selection: "challenger",
      source: {
        ref: `blob:sha256:${sourceDigest}/challenger%2Fsolver_impl.py`,
        digest: sourceDigest,
        bytes: 9_812
      },
      evidence: {
        implementationPresent: true,
        implementationSyntaxValid: true,
        implementationContractPresent: true,
        implementationSubstantive: true,
        implementationSha256: sourceDigest,
        implementationBytes: 9_812
      }
    },
    sourceRunId: "holographic-v10-r3"
  });

  assert.equal(capsule.task.instructionDigest, instructionDigest);
  assert.match(capsule.task.signature, /^[a-f0-9]{64}$/);
  assert.equal(capsule.execution.elapsedMilliseconds, 600_000);
  assert.equal(capsule.candidateLineage.repairableState.available, true);
  assert.equal(capsule.candidateLineage.repairableState.source.digest, sourceDigest);
  assert.equal(capsule.candidateLineage.authority.grantsCompletionCredit, false);
  assert.equal(validateSwarmFailureCapsule(capsule).digest, capsule.digest);
});

test("failure capsules reject a challenger whose evidence does not bind its source", () => {
  const capsule = createSwarmFailureCapsule({
    task: { source: "test", name: "fixture", instructionDigest: "f".repeat(64) },
    result: {},
    repairableCandidate: {
      available: true,
      selection: "challenger",
      source: { ref: "blob:mismatch", digest: "a".repeat(64), bytes: 100 },
      evidence: {
        implementationPresent: true,
        implementationSyntaxValid: true,
        implementationSubstantive: true,
        implementationSha256: "b".repeat(64)
      }
    }
  });

  assert.equal(capsule.candidateLineage.repairableState.available, false);
  assert.equal(capsule.candidateLineage.repairableState.source, null);
});

test("failure capsules preserve active HRR influence without granting authority", () => {
  const capsule = createSwarmFailureCapsule({
    task: { source: "test", name: "active-hrr" },
    result: {},
    ecology: {
      assignments: [],
      dualChannelWorld: {
        mode: "bounded-active-retrieval",
        authorityEnabled: false,
        behaviorInfluence: true,
        snapshots: [{
          representedEntries: 4,
          exactPositiveRate: 1,
          exactFalsePositiveRate: 0,
          authorityLeakRate: 0,
          representationDigest: "b".repeat(64)
        }]
      }
    }
  });

  assert.equal(capsule.holographicWorld.mode, "bounded-active-retrieval");
  assert.equal(capsule.holographicWorld.behaviorInfluence, true);
  assert.equal(capsule.holographicWorld.authorityEnabled, false);
  assert.equal(capsule.safeguards.authorityGrantedByHrr, false);
});
