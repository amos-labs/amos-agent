import test from "node:test";
import assert from "node:assert/strict";
import {
  SWARM_TASK_BOARD_SCHEMA,
  SWARM_TASK_ROLES,
  SwarmTaskBoard,
  SwarmTaskCoordinator,
  compileSwarmTaskMission,
  validateSwarmTaskPolicy
} from "../src/research/swarmTaskCoordinator.js";

const ARTIFACT_RECEIPT = "a".repeat(64);
const REPAIRED_ARTIFACT_RECEIPT = "b".repeat(64);
const TEST_RECEIPT = "c".repeat(64);

test("the task mission compiler assigns bounded specialist roles and typed criteria", () => {
  const mission = compileSwarmTaskMission({
    missionId: "terminal-production-plan",
    objective: "Build and verify the production plan.",
    successCriteria: ["All three writebacks exist.", "The official verifier passes."]
  });

  assert.deepEqual(mission.workUnits.map(({ role }) => role), SWARM_TASK_ROLES);
  assert.deepEqual(mission.successCriteria.map(({ id }) => id), [
    "criterion-001",
    "criterion-002"
  ]);
  assert.match(mission.workUnits[0].objective, /compact requirements and facts/);
  assert.match(mission.workUnits[3].objective, /never restart broad discovery/);
});

test("the task coordinator completes only after artifact and test receipts prove every criterion", async () => {
  const calls = [];
  const checkpoints = [];
  const worker = {
    async runUnit(input) {
      calls.push(structuredClone({
        role: input.unit.role,
        cycle: input.cycle,
        board: input.board
      }));
      if (input.unit.role === "state-compiler") {
        return { entries: [entry({
          kind: "requirement",
          statement: "Create three consistent writeback files.",
          status: "verified",
          criterionIds: ["criterion-001"]
        })] };
      }
      if (input.unit.role === "solver-builder") {
        return { entries: [entry({
          kind: "artifact",
          statement: "The production-plan writebacks were constructed.",
          status: "verified",
          artifactPath: "/app/output/erp_writeback.sql",
          receiptDigest: ARTIFACT_RECEIPT,
          criterionIds: ["criterion-001"]
        })] };
      }
      if (input.unit.role === "verifier") {
        return {
          entries: [entry({
            kind: "test",
            statement: "The independent production-plan verifier passed.",
            status: "verified",
            receiptDigest: TEST_RECEIPT,
            criterionIds: ["criterion-001", "criterion-002"]
          })],
          verdict: {
            status: "pass",
            criteria: input.mission.successCriteria.map(({ id }) => ({
              criterionId: id,
              status: "pass",
              evidenceIds: ["state-0002"]
            })),
            gaps: []
          }
        };
      }
      if (input.unit.role === "integrator") {
        return {
          entries: [entry({
            kind: "decision",
            statement: "Return the verifier-backed completion to the user.",
            status: "verified"
          })],
          finalAnswer: "The production plan was created and independently verified."
        };
      }
      throw new Error(`Unexpected role ${input.unit.role}`);
    }
  };
  const coordinator = new SwarmTaskCoordinator({
    worker,
    now: tickingClock(),
    monotonicNow: tickingMonotonicClock(),
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint)
  });

  const run = await coordinator.run({
    missionId: "terminal-production-plan",
    objective: "Build and verify the production plan.",
    successCriteria: ["All three writebacks exist.", "The official verifier passes."]
  });

  assert.equal(run.status, "completed");
  assert.equal(run.board.schema, SWARM_TASK_BOARD_SCHEMA);
  assert.equal(run.verdict.status, "pass");
  assert.deepEqual(run.stages.map(({ role }) => role), [
    "state-compiler",
    "solver-builder",
    "verifier",
    "integrator"
  ]);
  assert.equal(run.board.items.length, 4);
  assert.equal(calls[1].board.items.length, 1);
  assert.equal(calls[2].board.items.length, 2);
  assert.equal(checkpoints.length, 4);
  assert.equal(typeof run.digest, "string");
  assert.equal(run.digest.length, 64);
});

test("the coordinator repairs verifier gaps without replaying discovery", async () => {
  const roles = [];
  const worker = {
    async runUnit(input) {
      roles.push(`${input.unit.role}:${input.cycle}`);
      if (input.unit.role === "state-compiler") {
        return { entries: [entry({
          kind: "fact",
          statement: "The gateway permits the required inserts.",
          status: "verified"
        })] };
      }
      if (input.unit.role === "solver-builder") {
        return { entries: [entry({
          kind: "artifact",
          statement: "Initial writebacks were constructed.",
          status: "verified",
          artifactPath: "/app/output/erp_writeback.sql",
          receiptDigest: ARTIFACT_RECEIPT,
          criterionIds: ["criterion-001"]
        })] };
      }
      if (input.unit.role === "verifier" && input.cycle === 0) {
        return {
          entries: [entry({
            kind: "gap",
            statement: "One line has a changeover overlap.",
            status: "unresolved",
            criterionIds: ["criterion-001"]
          })],
          verdict: {
            status: "repair",
            criteria: [{
              criterionId: "criterion-001",
              status: "fail",
              evidenceIds: ["state-0003"]
            }],
            gaps: ["Move the overlapping dispatch after the required changeover gap."]
          }
        };
      }
      if (input.unit.role === "repairer") {
        return { entries: [entry({
          kind: "artifact",
          statement: "The dispatch was moved after the changeover gap.",
          status: "verified",
          artifactPath: "/app/output/mes_writeback.sql",
          receiptDigest: REPAIRED_ARTIFACT_RECEIPT,
          criterionIds: ["criterion-001"]
        })] };
      }
      if (input.unit.role === "verifier" && input.cycle === 1) {
        return {
          entries: [entry({
            kind: "test",
            statement: "The repaired schedule passes all constraints.",
            status: "verified",
            receiptDigest: TEST_RECEIPT,
            criterionIds: ["criterion-001"]
          })],
          verdict: {
            status: "pass",
            criteria: [{
              criterionId: "criterion-001",
              status: "pass",
              evidenceIds: ["state-0004"]
            }],
            gaps: []
          }
        };
      }
      if (input.unit.role === "integrator") {
        return { entries: [], finalAnswer: "The repaired schedule is verified." };
      }
      throw new Error(`Unexpected role ${input.unit.role}`);
    }
  };
  const coordinator = new SwarmTaskCoordinator({ worker });

  const run = await coordinator.run({
    missionId: "repair-production-plan",
    objective: "Repair and verify the production plan.",
    successCriteria: ["The final schedule satisfies every constraint."]
  });

  assert.deepEqual(roles, [
    "state-compiler:0",
    "solver-builder:0",
    "verifier:0",
    "repairer:1",
    "verifier:1",
    "integrator:0"
  ]);
  assert.equal(run.verdict.status, "pass");
  assert.equal(run.stages.filter(({ role }) => role === "state-compiler").length, 1);
});

test("the coordinator rejects a model pass without an independent test receipt", async () => {
  const worker = passWorker({ includeTest: false });
  const coordinator = new SwarmTaskCoordinator({ worker });

  await assert.rejects(
    coordinator.run({
      missionId: "unverified-pass",
      objective: "Build an artifact.",
      successCriteria: ["The artifact works."]
    }),
    /verified test receipt/
  );
});

test("specialist role boundaries prevent the integrator from rewriting artifacts", async () => {
  const worker = passWorker({ includeTest: true, integratorArtifact: true });
  const coordinator = new SwarmTaskCoordinator({ worker });

  await assert.rejects(
    coordinator.run({
      missionId: "integrator-boundary",
      objective: "Build an artifact.",
      successCriteria: ["The artifact works."]
    }),
    /integrator cannot append artifact entries/
  );
});

test("the append-only board deduplicates semantic repeats and validates receipt claims", () => {
  const board = new SwarmTaskBoard({ missionId: "durable-board" });
  const contribution = {
    workerRole: "state-compiler",
    kind: "fact",
    statement: "Three lines are enabled.",
    status: "verified",
    sourceRefs: ["MES schema"]
  };

  assert.equal(board.append(contribution).added, true);
  assert.equal(board.append(contribution).added, false);
  assert.equal(board.snapshot().items.length, 1);
  assert.throws(
    () => board.append({
      workerRole: "solver-builder",
      kind: "artifact",
      statement: "An unreceipted artifact.",
      status: "verified",
      artifactPath: "/app/output/result.sql"
    }),
    /receiptDigest/
  );
});

test("task policy reserves enough units for every configured repair cycle", () => {
  assert.throws(
    () => validateSwarmTaskPolicy({ maxRepairCycles: 3, maxUnits: 9 }),
    /must allow 10 units/
  );
  assert.equal(
    validateSwarmTaskPolicy({ maxRepairCycles: 3, maxUnits: 10 }).maxUnits,
    10
  );
});

function passWorker({ includeTest, integratorArtifact = false }) {
  return {
    async runUnit(input) {
      if (input.unit.role === "state-compiler") {
        return { entries: [entry({ kind: "requirement", statement: "Build it.", status: "verified" })] };
      }
      if (input.unit.role === "solver-builder") {
        return { entries: [entry({
          kind: "artifact",
          statement: "Built artifact.",
          status: "verified",
          artifactPath: "/app/output/result.sql",
          receiptDigest: ARTIFACT_RECEIPT,
          criterionIds: ["criterion-001"]
        })] };
      }
      if (input.unit.role === "verifier") {
        return {
          entries: [entry(includeTest ? {
            kind: "test",
            statement: "Verified artifact.",
            status: "verified",
            receiptDigest: TEST_RECEIPT,
            criterionIds: ["criterion-001"]
          } : {
            kind: "decision",
            statement: "The model says it passed.",
            status: "verified",
            criterionIds: ["criterion-001"]
          })],
          verdict: {
            status: "pass",
            criteria: [{
              criterionId: "criterion-001",
              status: "pass",
              evidenceIds: ["state-0002"]
            }],
            gaps: []
          }
        };
      }
      return {
        entries: integratorArtifact ? [entry({
          kind: "artifact",
          statement: "Integrator attempted to rewrite the result.",
          status: "verified",
          artifactPath: "/app/output/result.sql",
          receiptDigest: REPAIRED_ARTIFACT_RECEIPT
        })] : [],
        finalAnswer: "Complete."
      };
    }
  };
}

function entry(overrides) {
  return {
    sourceRefs: [],
    criterionIds: [],
    artifactPath: null,
    receiptDigest: null,
    ...overrides
  };
}

function tickingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 23, 13, 0, tick++));
}

function tickingMonotonicClock() {
  let tick = 0;
  return () => tick++ * 10;
}
