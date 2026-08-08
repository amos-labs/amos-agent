export function parseStructuredAnswer(value) {
  const text = String(value || "").trim();
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(unfenced);
    return {
      label: normalizeLabel(parsed?.label),
      reason: String(parsed?.reason || "").trim(),
      validJson: true
    };
  } catch {
    return { label: "", reason: "", validJson: false };
  }
}

export function evaluateAnswer(answer, expectation) {
  const parsed = typeof answer === "string" ? parseStructuredAnswer(answer) : answer;
  const expectedLabel = normalizeLabel(expectation?.expected_label);
  const normalizedReason = normalizeText(parsed?.reason);
  const requiredTerms = (expectation?.required_reason_terms || []).map(normalizeText);
  const missingReasonTerms = requiredTerms.filter((term) => !normalizedReason.includes(term));
  const labelPassed = Boolean(expectedLabel) && parsed?.label === expectedLabel;
  const passed = Boolean(parsed?.validJson) && labelPassed;
  return {
    passed,
    valid_json: Boolean(parsed?.validJson),
    label: parsed?.label || "",
    expected_label: expectedLabel,
    label_passed: labelPassed,
    rationale_passed: missingReasonTerms.length === 0,
    missing_reason_terms: missingReasonTerms
  };
}

export function buildIntegrationPrompt(testCase, atomicResults) {
  const notes = testCase.atomic.map((probe) => {
    const result = atomicResults.find((item) => item.id === probe.id);
    return [
      `Probe: ${probe.prompt}`,
      `Independent response: ${result?.response || "(missing)"}`,
      `Evaluator status: ${result?.evaluation?.passed ? "passed" : "unverified"}`
    ].join("\n");
  }).join("\n\n");

  return [
    "You are performing knowledge integration, not majority voting.",
    "The independent elicitation notes below may be incomplete or wrong.",
    "Reconcile their relationships, reject contradictions, and solve the final problem.",
    "Return exactly the JSON shape requested by the final problem and no markdown.",
    "",
    notes,
    "",
    "Final integration problem:",
    testCase.integration.prompt
  ].join("\n");
}

export function expandIntegrationCases(cases) {
  return cases.flatMap((testCase) => {
    const base = {
      ...testCase,
      family_id: testCase.id,
      variant_id: "base"
    };
    delete base.variants;
    const variants = (testCase.variants || []).map((variant) => ({
      ...testCase,
      id: `${testCase.id}--${variant.id}`,
      family_id: testCase.id,
      variant_id: variant.id,
      integration: {
        ...testCase.integration,
        ...variant.integration
      }
    }));
    for (const variant of variants) delete variant.variants;
    return [base, ...variants];
  });
}

export function summarizeCaseResult({ atomicResults, baseline, assisted }) {
  const atomicPassed = atomicResults.filter((result) => result.evaluation.passed).length;
  const atomicMaximum = atomicResults.length;
  const allAtomicPassed = atomicPassed === atomicMaximum;
  return {
    atomic_passed: atomicPassed,
    atomic_maximum: atomicMaximum,
    all_atomic_passed: allAtomicPassed,
    baseline_passed: baseline.evaluation.passed,
    assisted_passed: assisted?.evaluation?.passed ?? null,
    integration_failure: allAtomicPassed && !baseline.evaluation.passed,
    integration_recovered: allAtomicPassed && !baseline.evaluation.passed &&
      assisted?.evaluation?.passed === true
  };
}

export function aggregateIntegrationResults(cases) {
  const eligible = cases.filter((item) => item.summary.all_atomic_passed);
  const baselinePassed = eligible.filter((item) => item.summary.baseline_passed).length;
  const assistedEvaluated = eligible.filter(
    (item) => item.summary.assisted_passed !== null
  );
  const assistedPassed = assistedEvaluated.filter(
    (item) => item.summary.assisted_passed
  ).length;
  const failures = eligible.filter((item) => item.summary.integration_failure);
  const recovered = failures.filter((item) => item.summary.integration_recovered).length;
  const families = new Map();
  for (const item of cases) {
    const familyId = item.family_id || item.id;
    const family = families.get(familyId) || [];
    family.push(item);
    families.set(familyId, family);
  }
  const variantFamilies = [...families.values()].filter((family) => family.length > 1);
  const baselineConsistentFamilies = variantFamilies.filter((family) =>
    family.every((item) => item.summary.baseline_passed)
  ).length;
  const assistedConsistentFamilies = variantFamilies.filter((family) =>
    family.every((item) => item.summary.assisted_passed === true)
  ).length;
  const baselineEmptyResponses = cases.filter((item) => !item.baseline?.response?.trim()).length;
  const assistedEmptyResponses = cases.filter(
    (item) => item.assisted && !item.assisted.response?.trim()
  ).length;
  return {
    total_cases: cases.length,
    atomic_eligible_cases: eligible.length,
    baseline_conditional_accuracy: ratio(baselinePassed, eligible.length),
    assisted_conditional_accuracy: ratio(assistedPassed, assistedEvaluated.length),
    observed_integration_failures: failures.length,
    recovered_integration_failures: recovered,
    recovery_rate: ratio(recovered, failures.length),
    variant_families: variantFamilies.length,
    baseline_variant_consistency: ratio(baselineConsistentFamilies, variantFamilies.length),
    assisted_variant_consistency: ratio(assistedConsistentFamilies, variantFamilies.length),
    baseline_empty_responses: baselineEmptyResponses,
    assisted_empty_responses: assistedEmptyResponses
  };
}

function normalizeLabel(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}
