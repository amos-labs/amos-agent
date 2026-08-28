import test from "node:test";
import assert from "node:assert/strict";
import {
  BLIND_COMPARISON_DIMENSIONS,
  finalizeBlindComparisonJudgment,
  prepareBlindComparison,
  unmaskBlindComparison,
  validateBlindComparisonBundle,
  validateBlindComparisonJudgment
} from "../src/research/blindComparison.js";
import { digestResearchValue } from "../src/research/experimentProtocol.js";

const CREATED_AT = "2026-08-22T12:00:00.000Z";

test("blind preparation strips identity while preserving a private digest-bound map", () => {
  const reports = [report("qwen-direct", "direct"), report("qwen-swarm", "swarm")];
  const result = prepareBlindComparison({ reports, salt: Buffer.alloc(32, 7), createdAt: CREATED_AT });
  const publicJson = JSON.stringify(result.bundle);
  const privateJson = JSON.stringify(result.mapping);

  assert.equal(result.bundle.caseCount, 2);
  assert.equal(result.bundle.candidateCount, 2);
  assert.doesNotMatch(publicJson, /qwen-direct|qwen-swarm|test-model|reportDigest|runDigest/);
  assert.match(privateJson, /qwen-direct/);
  assert.match(privateJson, /qwen-swarm/);
  assert.match(result.bundle.bundleDigest, /^[a-f0-9]{64}$/);
  assert.match(result.mapping.mappingDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.mapping.bundleDigest, result.bundle.bundleDigest);

  const leaked = structuredClone(result.bundle);
  leaked.cases[0].candidates[0].controlId = "qwen-swarm";
  leaked.bundleDigest = digestResearchValue({ ...leaked, bundleDigest: null });
  assert.throws(() => validateBlindComparisonBundle(leaked), /must contain exactly/);
});

test("blind preparation is stable for the same salt and changes the private mapping with salt", () => {
  const reports = [report("qwen-direct", "direct"), report("qwen-swarm", "swarm")];
  const first = prepareBlindComparison({ reports, salt: Buffer.alloc(32, 1), createdAt: CREATED_AT });
  const repeated = prepareBlindComparison({ reports, salt: Buffer.alloc(32, 1), createdAt: CREATED_AT });
  assert.deepEqual(first, repeated);

  let changed;
  for (let byte = 2; byte < 256; byte += 1) {
    const candidate = prepareBlindComparison({
      reports,
      salt: Buffer.alloc(32, byte),
      createdAt: CREATED_AT
    });
    if (JSON.stringify(candidate.mapping.cases) !== JSON.stringify(first.mapping.cases)) {
      changed = candidate;
      break;
    }
  }
  assert.ok(changed, "expected at least one salt to change case-to-candidate mapping");
  assert.notEqual(changed.mapping.saltDigest, first.mapping.saltDigest);
});

test("blind preparation rejects tampered reports and mismatched case sets", () => {
  const direct = report("qwen-direct", "direct");
  const swarm = report("qwen-swarm", "swarm");
  const tampered = structuredClone(direct);
  tampered.runs[0].run.result.answer = "Changed after the report was sealed";
  assert.throws(
    () => prepareBlindComparison({ reports: [tampered, swarm], salt: Buffer.alloc(32, 3) }),
    /reportDigest mismatch/
  );

  const missing = report("qwen-swarm", "swarm");
  missing.runs.pop();
  reseal(missing);
  assert.throws(
    () => prepareBlindComparison({ reports: [direct, missing], salt: Buffer.alloc(32, 3) }),
    /same cases/
  );

  const failed = report("qwen-swarm", "swarm");
  failed.status = "failed";
  failed.failure = { message: "integrator exhausted its output budget" };
  reseal(failed);
  assert.throws(
    () => prepareBlindComparison({ reports: [direct, failed], salt: Buffer.alloc(32, 3) }),
    /did not complete/
  );
});

test("judgments require exact candidates, complete rankings, and bounded scores", () => {
  const prepared = prepareBlindComparison({
    reports: [report("qwen-direct", "direct"), report("qwen-swarm", "swarm")],
    salt: Buffer.alloc(32, 4),
    createdAt: CREATED_AT
  });
  const valid = judgment(prepared.bundle);
  assert.deepEqual(validateBlindComparisonJudgment(valid, prepared.bundle), valid);

  const duplicate = structuredClone(valid);
  duplicate.cases[0].ranking = [["candidate-a"], ["candidate-a"]];
  resealJudgment(duplicate);
  assert.throws(
    () => validateBlindComparisonJudgment(duplicate, prepared.bundle),
    /duplicate candidate/
  );

  const outOfRange = structuredClone(valid);
  outOfRange.cases[0].scores[0].dimensions.correctness = 6;
  resealJudgment(outOfRange);
  assert.throws(
    () => validateBlindComparisonJudgment(outOfRange, prepared.bundle),
    /between 1 and 5/
  );
});

test("unmasking produces control-level quality totals only after a valid judgment", () => {
  const prepared = prepareBlindComparison({
    reports: [report("qwen-direct", "direct"), report("qwen-swarm", "swarm")],
    salt: Buffer.alloc(32, 5),
    createdAt: CREATED_AT
  });
  const result = unmaskBlindComparison({
    ...prepared,
    judgment: judgment(prepared.bundle)
  });
  assert.deepEqual(result.controls.map((control) => control.controlId), [
    "qwen-direct",
    "qwen-swarm"
  ]);
  assert.ok(result.controls.every((control) => control.cases === 2));
  assert.ok(result.controls.every((control) => control.dimensionMeans.correctness === 4));
  assert.match(result.resultDigest, /^[a-f0-9]{64}$/);
});

function report(controlId, mode) {
  const missions = [
    { id: "mission-a", objective: "Choose an action", context: "Fact A", successCriteria: ["Use A"] },
    { id: "mission-b", objective: "Find a risk", context: "Fact B", successCriteria: ["Use B"] }
  ];
  const value = {
    schema: "amos.swarm-experiment-report",
    version: 1,
    createdAt: CREATED_AT,
    sourceRevision: "abc123",
    configId: "swarm-v0",
    configDigest: "1".repeat(64),
    missionManifestId: "missions-v0",
    missionManifestDigest: "2".repeat(64),
    dataClassification: "development-visible",
    control: { id: controlId, mode, model: "test-model" },
    repetitions: 1,
    runs: missions.map((mission) => {
      const run = {
        schema: "amos.swarm-run",
        version: 1,
        controlId,
        status: "completed",
        mission,
        result: {
          answer: `${mode === "swarm" ? "Expanded" : "Direct"} answer for ${mission.id}`,
          confidence: mode === "swarm" ? 0.8 : null,
          unresolvedRisks: mode === "swarm" ? ["One bounded risk"] : []
        }
      };
      return {
        missionId: mission.id,
        repetition: 1,
        runDigest: digestResearchValue(run),
        run
      };
    }),
    reportDigest: null
  };
  reseal(value);
  return value;
}

function judgment(bundle) {
  return finalizeBlindComparisonJudgment({
    schema: "amos.blind-comparison-judgment",
    version: 1,
    bundleDigest: bundle.bundleDigest,
    createdAt: CREATED_AT,
    evaluator: { id: "blind-human-1", version: "1", kind: "human" },
    cases: bundle.cases.map((item) => ({
      caseId: item.caseId,
      scores: item.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        dimensions: Object.fromEntries(BLIND_COMPARISON_DIMENSIONS.map((name) => [name, 4]))
      })),
      ranking: item.candidates.map((candidate) => [candidate.candidateId]),
      notes: []
    })),
    judgmentDigest: null
  });
}

function reseal(reportValue) {
  reportValue.reportDigest = digestResearchValue({ ...reportValue, reportDigest: null });
}

function resealJudgment(judgmentValue) {
  judgmentValue.judgmentDigest = digestResearchValue({
    ...judgmentValue,
    judgmentDigest: null
  });
}
