import test from "node:test";
import assert from "node:assert/strict";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import {
  finalizeSwarmExperimentReport,
  swarmExperimentFailure
} from "../src/research/swarmExperimentReport.js";

const NOW = "2026-08-23T09:30:00.000Z";

test("failed swarm experiments retain completed runs and a content-addressed failure receipt", () => {
  const base = {
    schema: "amos.swarm-experiment-report",
    version: 1,
    control: { id: "qwen-swarm" },
    runs: [{ missionId: "mission-a", repetition: 1 }]
  };
  const failure = swarmExperimentFailure(new Error("integrator exhausted its output budget"), {
    missionId: "mission-b",
    repetition: 2,
    failedAt: NOW
  });
  const report = finalizeSwarmExperimentReport(base, {
    status: "failed",
    failure,
    completedAt: NOW
  });

  assert.equal(report.status, "failed");
  assert.equal(report.runs.length, 1);
  assert.deepEqual(report.failure, {
    failedAt: NOW,
    missionId: "mission-b",
    repetition: 2,
    name: "Error",
    message: "integrator exhausted its output budget"
  });
  assert.equal(
    report.reportDigest,
    digestResearchValue({ ...report, reportDigest: null })
  );
});

test("completed reports exclude failure data", () => {
  const report = finalizeSwarmExperimentReport({ runs: [] }, {
    status: "completed",
    completedAt: NOW
  });

  assert.equal(report.status, "completed");
  assert.equal(report.failure, null);
  assert.throws(
    () => finalizeSwarmExperimentReport({ runs: [] }, {
      status: "completed",
      failure: { message: "not allowed" },
      completedAt: NOW
    }),
    /cannot contain a failure/
  );
});

test("failure messages are bounded before they enter durable reports", () => {
  const failure = swarmExperimentFailure(new Error("x".repeat(3_000)), {
    missionId: "mission-a",
    repetition: 1,
    failedAt: NOW
  });

  assert.equal(failure.message.length, 2_000);
  assert.match(failure.message, /…$/);
});
