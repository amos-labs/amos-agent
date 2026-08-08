import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateIntegrationResults,
  buildIntegrationPrompt,
  buildWorkspaceIntegrationPrompt,
  buildWorkspacePrompt,
  buildWorkspaceRepairPrompt,
  evaluateAnswer,
  expandIntegrationCases,
  parseStructuredAnswer,
  parseWorkspace,
  summarizeCaseResult,
  validateIntegrationSuite,
  workspaceJsonSchema
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
    attempts: [{ response: '{"label":"YES"}' }],
    evaluation: { passed: true }
  }]);
  assert.match(prompt, /may be incomplete or wrong/);
  assert.doesNotMatch(prompt, /Evaluator status|passed|unverified/);
  assert.match(prompt, /Independent response 1/);
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
    elicited: { evaluation: { passed: true } }
  });
  assert.equal(summary.all_atomic_passed, true);
  assert.equal(summary.integration_failure, true);
  assert.equal(summary.elicited_recovered, true);

  const aggregate = aggregateIntegrationResults([{ summary }]);
  assert.equal(aggregate.atomic_eligible_cases, 1);
  assert.equal(aggregate.baseline_conditional_accuracy, 0);
  assert.equal(aggregate.elicited_conditional_accuracy, 1);
  assert.equal(aggregate.elicited_recovery_rate, 1);
  assert.deepEqual(aggregate.paired_comparisons.elicited_vs_baseline, {
    evaluated_cases: 1,
    improved: 1,
    regressed: 0,
    both_passed: 0,
    both_failed: 0,
    accuracy_lift: 1,
    accuracy_lift_bootstrap_95: { low: 1, high: 1 }
  });
});

test("paired comparison exposes intervention regressions as negative lift", () => {
  const aggregate = aggregateIntegrationResults([
    { summary: { all_atomic_passed: true, baseline_passed: true, elicited_passed: false,
      workspace_passed: null, integration_failure: false } },
    { summary: { all_atomic_passed: true, baseline_passed: false, elicited_passed: false,
      workspace_passed: null, integration_failure: true } }
  ]);
  assert.deepEqual(aggregate.paired_comparisons.elicited_vs_baseline, {
    evaluated_cases: 2,
    improved: 0,
    regressed: 1,
    both_passed: 0,
    both_failed: 1,
    accuracy_lift: -0.5,
    accuracy_lift_bootstrap_95: { low: -1, high: 0 }
  });
  assert.equal(aggregate.paired_comparisons.workspace_vs_baseline, null);
});

test("workspace prompts build and consume a fallible structured belief graph", () => {
  const testCase = {
    atomic: [{ id: "a", prompt: "Atomic question" }],
    integration: { prompt: "Combined question" }
  };
  const atomicResults = [{
    id: "a",
    attempts: [{ response: '{"label":"YES"}' }],
    evaluation: { passed: true }
  }];
  const construction = buildWorkspacePrompt(testCase, atomicResults);
  assert.match(construction, /claims/);
  assert.match(construction, /relationships/);
  assert.doesNotMatch(construction, /Evaluator status|expected_label/);

  const graph = JSON.stringify({
    claims: [{
      id: "c1",
      statement: "A scoped claim",
      origin: "elicited_probe",
      evidence_probe_ids: ["a"],
      derived_from_claim_ids: [],
      applicability: "applies",
      confidence: "high"
    }],
    relationships: [], conflicts: [], unknowns: [], predictions: []
  });
  assert.equal(parseWorkspace(graph, testCase).valid, true);
  assert.equal(parseWorkspace('{"claims":[]}').valid, false);
  assert.match(buildWorkspaceIntegrationPrompt(testCase, graph), /fallible hypothesis/);
  assert.match(buildWorkspaceRepairPrompt(
    testCase,
    atomicResults,
    "{}",
    ["workspace omits probe a"]
  ), /no answer-key information|workspace omits probe a/);
  assert.ok(workspaceJsonSchema().properties.claims.items.required.includes("applicability"));
});

test("workspace validation rejects dangling relationships and unknown probe sources", () => {
  const workspace = {
    claims: [{
      id: "c1",
      statement: "Claim",
      origin: "elicited_probe",
      evidence_probe_ids: ["not-a-probe"],
      derived_from_claim_ids: [],
      applicability: "applies",
      confidence: "high"
    }],
    relationships: [{ from: "c1", to: "missing", type: "supports" }],
    conflicts: [], unknowns: [], predictions: []
  };
  const parsed = parseWorkspace(JSON.stringify(workspace), {
    atomic: [{ id: "known-probe" }]
  });
  assert.equal(parsed.valid, false);
  assert.match(parsed.errors.join(" "), /unknown probe|unknown claim/);
});

test("workspace arm cannot receive credit when construction is invalid", () => {
  const summary = summarizeCaseResult({
    atomicResults: [{ evaluation: { passed: true } }],
    baseline: { evaluation: { passed: false } },
    workspace: {
      construction: { workspace: { valid: false } },
      integration: { evaluation: { passed: true } }
    }
  });
  assert.equal(summary.workspace_valid, false);
  assert.equal(summary.workspace_passed, false);
  assert.equal(summary.workspace_recovered, false);
});

test("suite validation rejects duplicate identifiers and incomplete targets", () => {
  assert.throws(() => validateIntegrationSuite({
    schema: "amos.knowledge-integration-suite",
    version: 1,
    status: "development",
    cases: [{
      id: "duplicate",
      category: "causal",
      atomic: [
        { id: "same", prompt: "one", expected_label: "YES" },
        { id: "same", prompt: "two", expected_label: "NO" }
      ],
      integration: { prompt: "combined" }
    }]
  }), /unique within the case|expected_label/);
});

test("frozen suites require repeated, semantically varied atomic probes", () => {
  assert.throws(() => validateIntegrationSuite({
    schema: "amos.knowledge-integration-suite",
    version: 1,
    status: "frozen",
    atomic_repetitions: 1,
    cases: [{
      id: "frozen-case",
      category: "causal",
      atomic: [{ id: "single", prompt: "one wording", expected_label: "YES" }],
      integration: { prompt: "combined", expected_label: "A" }
    }]
  }), /atomic_repetitions|semantic prompt variants/);
});

test("counterfactual variants inherit atomic probes and replace the integration target", () => {
  const expanded = expandIntegrationCases([{
    id: "lease",
    category: "temporal",
    atomic: [{ id: "fencing", prompt: "probe", expected_label: "YES" }],
    integration: { prompt: "base", expected_label: "B" },
    variants: [{
      id: "no-fencing",
      integration: { prompt: "variant", expected_label: "A" }
    }]
  }]);
  assert.equal(expanded.length, 2);
  assert.equal(expanded[0].family_id, "lease");
  assert.equal(expanded[0].variant_id, "base");
  assert.equal(expanded[1].id, "lease--no-fencing");
  assert.equal(expanded[1].atomic[0].id, "fencing");
  assert.equal(expanded[1].integration.prompt, "variant");
  assert.equal(expanded[1].integration.expected_label, "A");
});
