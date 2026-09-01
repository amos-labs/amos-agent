import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ORGANISM_POLICY } from "../src/research/swarmOrganismSimulator.js";
import { runOrganismQwenPhaseProbe } from "../src/research/swarmOrganismQwenPhaseProbe.js";

test("real-Qwen phase probes compare matched policies and gate partial reward on verifier receipts", async () => {
  const worker = {
    async runCase({ caseId }) {
      const repaired = caseId.includes("attempt-2");
      return {
        message: {
          content: repaired
            ? "Use 18% as current. The approved CFO memo controls; 12% is a superseded draft."
            : "Use 18% as current according to the CFO memo."
        },
        metrics: { outputTokens: 20, generationTokensPerSecond: 50 }
      };
    }
  };
  const mission = {
    id: "authority-case",
    objective: "Resolve the current target.",
    context: "The CFO memo says 18%; an older draft says 12%.",
    successCriteria: ["Use 18%.", "Cite the CFO memo.", "Mark 12% superseded."]
  };
  const verifier = {
    id: "authority-case-verifier",
    missionId: mission.id,
    family: "authority",
    criteria: [
      { id: "target", requiredConcepts: [["18%"]] },
      { id: "source", requiredConcepts: [["CFO"], ["memo"]] },
      { id: "superseded", requiredConcepts: [["12%"], ["superseded"]] }
    ],
    prohibitedConcepts: []
  };
  const report = await runOrganismQwenPhaseProbe({
    worker,
    missions: [mission],
    verifiers: [verifier],
    candidatePolicy: {
      ...DEFAULT_ORGANISM_POLICY,
      "bid.repetitionPenalty": 2,
      "energy.partialProgressReward": 0.8
    },
    candidateId: "learned-policy",
    now: () => new Date("2026-08-24T12:00:00.000Z")
  });

  assert.equal(report.baseline.passRate, 1);
  assert.equal(report.candidate.passRate, 1);
  assert.equal(report.candidate.recoveryRate, 1);
  assert.equal(report.candidate.receiptGatedCredit, true);
  assert.equal(report.candidate.exactPolicyConsumed, true);
  assert.equal(report.gate.passed, true);
  assert.equal(report.gate.automaticallyPromotes, false);
  assert.equal(report.protocol.maximumModelRequestsPerMission, 4);
  assert.equal(report.runs.every(({ calls }) => calls === 2), true);
  assert.equal(report.runs.every(({ worldSnapshot }) =>
    worldSnapshot.readOnly && worldSnapshot.boardDigest.length === 64
  ), true);
  assert.equal(report.digest.length, 64);
});

test("real-Qwen phase probes recover a visible answer after reasoning exhausts its budget", async () => {
  const calls = [];
  const worker = {
    async runCase({ caseId, reasoningEffortOverride, maxOutputTokens }) {
      calls.push({ caseId, reasoningEffortOverride, maxOutputTokens });
      if (caseId.endsWith(":reasoning")) {
        return {
          message: { role: "assistant", content: "", reasoning_content: "Private analysis." },
          providerResponse: { choices: [{ finish_reason: "length" }] },
          metrics: { outputTokens: maxOutputTokens }
        };
      }
      return {
        message: { role: "assistant", content: "Use the approved 18% target from the CFO memo." },
        metrics: { outputTokens: 8 }
      };
    }
  };
  const mission = {
    id: "answer-recovery",
    objective: "State the approved target.",
    context: "The approved target is 18% in the CFO memo.",
    successCriteria: ["Use 18%.", "Cite the CFO memo."]
  };
  const verifier = {
    id: "answer-recovery-verifier",
    missionId: mission.id,
    family: "authority",
    criteria: [
      { id: "target", requiredConcepts: [["18%"]] },
      { id: "source", requiredConcepts: [["CFO"], ["memo"]] }
    ],
    prohibitedConcepts: []
  };

  const report = await runOrganismQwenPhaseProbe({
    worker,
    missions: [mission],
    verifiers: [verifier],
    candidatePolicy: DEFAULT_ORGANISM_POLICY,
    candidateId: "answer-recovery-policy",
    maxOutputTokens: 900,
    now: () => new Date("2026-08-24T12:00:00.000Z")
  });

  assert.equal(report.baseline.passRate, 1);
  assert.equal(report.candidate.passRate, 1);
  assert.equal(calls.length, 4);
  assert.equal(calls.every(({ caseId }) => caseId.endsWith(":reasoning") || caseId.endsWith(":answer")), true);
  assert.equal(calls.filter(({ caseId }) => caseId.endsWith(":answer"))
    .every(({ reasoningEffortOverride, maxOutputTokens }) =>
      reasoningEffortOverride === "none" && maxOutputTokens === 300
    ), true);
});
