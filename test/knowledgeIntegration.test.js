import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateIntegrationResults,
  buildIntegrationPrompt,
  evaluateAnswer,
  parseStructuredAnswer,
  summarizeCaseResult
} from "../src/research/knowledgeIntegration.js";

test("structured integration answers accept fenced JSON but preserve strict labels", () => {
  assert.deepEqual(parseStructuredAnswer('```json\n{"label":"b","reason":"Retry with jitter"}\n```'), {
    label: "B",
    reason: "Retry with jitter",
    validJson: true
  });
  assert.equal(evaluateAnswer('{"label":"B","reason":"Retry with jitter"}', {
    expected_label: "B",
    required_reason_terms: ["retry", "jitter"]
  }).passed, true);
  const weakRationale = evaluateAnswer('{"label":"B","reason":"Back off"}', {
    expected_label: "B",
    required_reason_terms: ["jitter"]
  });
  assert.equal(weakRationale.passed, true);
  assert.equal(weakRationale.rationale_passed, false);
});

test("integration prompt marks elicited notes as fallible", () => {
  const testCase = {
    atomic: [{ id: "a", prompt: "Atomic question" }],
    integration: { prompt: "Combined question" }
  };
  const prompt = buildIntegrationPrompt(testCase, [{
    id: "a",
    response: '{"label":"YES"}',
    evaluation: { passed: true }
  }]);
  assert.match(prompt, /may be incomplete or wrong/);
  assert.match(prompt, /Evaluator status: passed/);
  assert.match(prompt, /Combined question/);
});

test("summary distinguishes missing knowledge, integration failure, and recovery", () => {
  const atomicResults = [
    { evaluation: { passed: true } },
    { evaluation: { passed: true } }
  ];
  const summary = summarizeCaseResult({
    atomicResults,
    baseline: { evaluation: { passed: false } },
    assisted: { evaluation: { passed: true } }
  });
  assert.equal(summary.all_atomic_passed, true);
  assert.equal(summary.integration_failure, true);
  assert.equal(summary.integration_recovered, true);

  const aggregate = aggregateIntegrationResults([{ summary }]);
  assert.equal(aggregate.atomic_eligible_cases, 1);
  assert.equal(aggregate.baseline_conditional_accuracy, 0);
  assert.equal(aggregate.assisted_conditional_accuracy, 1);
  assert.equal(aggregate.recovery_rate, 1);
});
