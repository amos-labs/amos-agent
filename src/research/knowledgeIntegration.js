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
  const notes = formatAtomicNotes(testCase, atomicResults);

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

export function buildWorkspacePrompt(testCase, atomicResults) {
  return [
    "Construct an explicit working belief graph for the final problem.",
    "The elicited notes may be incomplete, mutually inconsistent, or wrong.",
    "Separate general knowledge from facts stated in this exact problem.",
    "For every claim, decide whether its preconditions apply to the exact problem; do not activate a general claim merely because it is true in some other setting.",
    "Represent every Probe ID in at least one claim, even if that probe's response is wrong or does not apply.",
    "evidence_probe_ids may contain only exact Probe ID values; derived_from_claim_ids may contain only claim IDs from this graph.",
    "Do not choose the final multiple-choice label yet.",
    "Do not mention answer-option letters in the graph.",
    "Return only JSON with this shape:",
    '{"claims":[{"id":"c1","statement":"...","origin":"elicited_probe|problem_statement|derived","evidence_probe_ids":["..."],"derived_from_claim_ids":["..."],"applicability":"applies|does_not_apply|uncertain","confidence":"low|medium|high"}],"relationships":[{"from":"c1","to":"c2","type":"supports|contradicts|causes|enables|prevents|precedes|depends_on|refines"}],"conflicts":["..."],"unknowns":["..."],"predictions":["..."]}',
    "Use empty arrays when a field has no entries.",
    "",
    "Independent elicitation notes:",
    formatAtomicNotes(testCase, atomicResults),
    "",
    "Final problem to model:",
    testCase.integration.prompt
  ].join("\n");
}

export function buildWorkspaceIntegrationPrompt(testCase, workspaceResponse) {
  return [
    "Solve the final problem using the proposed working belief graph below.",
    "The graph is a fallible hypothesis: repair contradictions and ignore unsupported claims.",
    "Return exactly the JSON shape requested by the final problem and no markdown.",
    "",
    "Working belief graph:",
    workspaceResponse || "(workspace construction returned no content)",
    "",
    "Final integration problem:",
    testCase.integration.prompt
  ].join("\n");
}

export function buildWorkspaceRepairPrompt(testCase, atomicResults, workspaceResponse, errors) {
  return [
    "Repair the working belief graph so it satisfies every structural requirement.",
    "The validation errors contain no answer-key information; use them only to repair graph structure and evidence coverage.",
    "Return one complete replacement graph as JSON, not a patch and not markdown.",
    "Keep valid claims, add omitted evidence, and correct invalid references.",
    "Do not choose or mention a multiple-choice answer letter.",
    "evidence_probe_ids may contain only exact Probe ID values; derived_from_claim_ids may contain only claim IDs from the replacement graph.",
    "",
    "Validation errors:",
    (errors || []).map((error) => `- ${error}`).join("\n") || "- unknown structural error",
    "",
    "Independent elicitation notes that must all be represented:",
    formatAtomicNotes(testCase, atomicResults),
    "",
    "Invalid graph:",
    workspaceResponse || "(empty)",
    "",
    "Final problem whose conditions determine claim applicability:",
    testCase.integration.prompt
  ].join("\n");
}

export function parseWorkspace(value, testCase) {
  const text = String(value || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(text);
    const requiredArrays = ["claims", "relationships", "conflicts", "unknowns", "predictions"];
    const missingFields = requiredArrays.filter((field) => !Array.isArray(parsed?.[field]));
    const errors = [...missingFields.map((field) => `${field} must be an array`)];
    const claimIds = new Set();
    const allowedOrigins = new Set(["elicited_probe", "problem_statement", "derived"]);
    const allowedApplicability = new Set(["applies", "does_not_apply", "uncertain"]);
    const allowedConfidence = new Set(["low", "medium", "high"]);
    const allowedRelationships = new Set([
      "supports", "contradicts", "causes", "enables", "prevents", "precedes",
      "depends_on", "refines"
    ]);
    const probeIds = new Set((testCase?.atomic || []).map((probe) => probe.id));
    const referencedProbeIds = new Set();
    for (const [index, claim] of (Array.isArray(parsed?.claims) ? parsed.claims : []).entries()) {
      if (!claim?.id || claimIds.has(claim.id)) {
        errors.push(`claims[${index}].id must be present and unique`);
      } else {
        claimIds.add(claim.id);
      }
      if (!String(claim?.statement || "").trim()) errors.push(`claims[${index}].statement is required`);
      if (!allowedOrigins.has(claim?.origin)) errors.push(`claims[${index}].origin is invalid`);
      if (!allowedApplicability.has(claim?.applicability)) {
        errors.push(`claims[${index}].applicability is invalid`);
      }
      if (!allowedConfidence.has(claim?.confidence)) errors.push(`claims[${index}].confidence is invalid`);
      if (!Array.isArray(claim?.evidence_probe_ids)) {
        errors.push(`claims[${index}].evidence_probe_ids must be an array`);
      } else if (testCase) {
        for (const sourceId of claim.evidence_probe_ids) {
          if (!probeIds.has(sourceId)) {
            errors.push(`claims[${index}] references unknown probe ${sourceId}`);
          } else {
            referencedProbeIds.add(sourceId);
          }
        }
      }
      if (!Array.isArray(claim?.derived_from_claim_ids)) {
        errors.push(`claims[${index}].derived_from_claim_ids must be an array`);
      }
    }
    if (testCase) {
      for (const probeId of probeIds) {
        if (!referencedProbeIds.has(probeId)) errors.push(`workspace omits probe ${probeId}`);
      }
    }
    for (const [index, claim] of (Array.isArray(parsed?.claims) ? parsed.claims : []).entries()) {
      for (const sourceId of (Array.isArray(claim?.derived_from_claim_ids)
        ? claim.derived_from_claim_ids
        : [])) {
        if (!claimIds.has(sourceId)) {
          errors.push(`claims[${index}] derives from unknown claim ${sourceId}`);
        }
      }
    }
    for (const [index, relationship] of
      (Array.isArray(parsed?.relationships) ? parsed.relationships : []).entries()) {
      if (!claimIds.has(relationship?.from)) {
        errors.push(`relationships[${index}].from references an unknown claim`);
      }
      if (!claimIds.has(relationship?.to)) {
        errors.push(`relationships[${index}].to references an unknown claim`);
      }
      if (!allowedRelationships.has(relationship?.type)) {
        errors.push(`relationships[${index}].type is invalid`);
      }
    }
    return {
      valid: errors.length === 0,
      missing_fields: missingFields,
      errors,
      value: parsed
    };
  } catch {
    return { valid: false, missing_fields: [], errors: ["workspace is not valid JSON"], value: null };
  }
}

export function workspaceJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["claims", "relationships", "conflicts", "unknowns", "predictions"],
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id", "statement", "origin", "evidence_probe_ids", "derived_from_claim_ids",
            "applicability", "confidence"
          ],
          properties: {
            id: { type: "string" },
            statement: { type: "string" },
            origin: {
              type: "string",
              enum: ["elicited_probe", "problem_statement", "derived"]
            },
            evidence_probe_ids: { type: "array", items: { type: "string" } },
            derived_from_claim_ids: { type: "array", items: { type: "string" } },
            applicability: {
              type: "string",
              enum: ["applies", "does_not_apply", "uncertain"]
            },
            confidence: { type: "string", enum: ["low", "medium", "high"] }
          }
        }
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to", "type"],
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            type: {
              type: "string",
              enum: [
                "supports", "contradicts", "causes", "enables", "prevents", "precedes",
                "depends_on", "refines"
              ]
            }
          }
        }
      },
      conflicts: { type: "array", items: { type: "string" } },
      unknowns: { type: "array", items: { type: "string" } },
      predictions: { type: "array", items: { type: "string" } }
    }
  };
}

export function validateIntegrationSuite(suite) {
  const errors = [];
  if (suite?.schema !== "amos.knowledge-integration-suite") {
    errors.push("schema must be amos.knowledge-integration-suite");
  }
  if (!Number.isInteger(suite?.version) || suite.version < 0) {
    errors.push("version must be a non-negative integer");
  }
  if (!["diagnostic", "development", "frozen"].includes(suite?.status)) {
    errors.push("status must be diagnostic, development, or frozen");
  }
  if (!Array.isArray(suite?.cases) || suite.cases.length === 0) {
    errors.push("cases must be a non-empty array");
  }
  if (suite?.status === "frozen" &&
      (!Number.isInteger(suite?.atomic_repetitions) || suite.atomic_repetitions < 2)) {
    errors.push("frozen suites require atomic_repetitions of at least 2");
  }
  const caseIds = new Set();
  for (const [caseIndex, testCase] of (suite?.cases || []).entries()) {
    const path = `cases[${caseIndex}]`;
    if (!testCase?.id || caseIds.has(testCase.id)) {
      errors.push(`${path}.id must be present and unique`);
    }
    caseIds.add(testCase?.id);
    if (!testCase?.category) errors.push(`${path}.category is required`);
    if (!Array.isArray(testCase?.atomic) || testCase.atomic.length === 0) {
      errors.push(`${path}.atomic must be a non-empty array`);
    }
    const probeIds = new Set();
    for (const [probeIndex, probe] of (testCase?.atomic || []).entries()) {
      const probePath = `${path}.atomic[${probeIndex}]`;
      if (!probe?.id || probeIds.has(probe.id)) {
        errors.push(`${probePath}.id must be present and unique within the case`);
      }
      probeIds.add(probe?.id);
      if (atomicPrompts(probe).length === 0) {
        errors.push(`${probePath} requires prompt or prompts`);
      }
      if (suite?.status === "frozen" && atomicPrompts(probe).length < 2) {
        errors.push(`${probePath} requires at least two semantic prompt variants when frozen`);
      }
      if (!probe?.expected_label) errors.push(`${probePath}.expected_label is required`);
    }
    validateIntegrationTarget(testCase?.integration, `${path}.integration`, errors);
    const variantIds = new Set();
    for (const [variantIndex, variant] of (testCase?.variants || []).entries()) {
      const variantPath = `${path}.variants[${variantIndex}]`;
      if (!variant?.id || variantIds.has(variant.id)) {
        errors.push(`${variantPath}.id must be present and unique within the case`);
      }
      variantIds.add(variant?.id);
      validateIntegrationTarget(variant?.integration, `${variantPath}.integration`, errors);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid knowledge-integration suite:\n- ${errors.join("\n- ")}`);
  }
  return suite;
}

export function atomicPrompts(probe) {
  const values = Array.isArray(probe?.prompts) ? probe.prompts : [probe?.prompt];
  return values.map((value) => String(value || "").trim()).filter(Boolean);
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

export function summarizeCaseResult({ atomicResults, baseline, elicited, workspace }) {
  const atomicPassed = atomicResults.filter((result) => result.evaluation.passed).length;
  const atomicMaximum = atomicResults.length;
  const allAtomicPassed = atomicPassed === atomicMaximum;
  const workspaceValid = workspace?.construction?.workspace?.valid === true;
  const workspacePassed = workspaceValid && workspace?.integration?.evaluation?.passed === true;
  return {
    atomic_passed: atomicPassed,
    atomic_maximum: atomicMaximum,
    all_atomic_passed: allAtomicPassed,
    baseline_passed: baseline.evaluation.passed,
    elicited_passed: elicited?.evaluation?.passed ?? null,
    workspace_valid: workspace ? workspaceValid : null,
    workspace_passed: workspace ? workspacePassed : null,
    integration_failure: allAtomicPassed && !baseline.evaluation.passed,
    elicited_recovered: allAtomicPassed && !baseline.evaluation.passed &&
      elicited?.evaluation?.passed === true,
    workspace_recovered: allAtomicPassed && !baseline.evaluation.passed &&
      workspacePassed
  };
}

export function aggregateIntegrationResults(cases) {
  const eligible = cases.filter((item) => item.summary.all_atomic_passed);
  const baselinePassed = eligible.filter((item) => item.summary.baseline_passed).length;
  const elicitedEvaluated = eligible.filter(
    (item) => item.summary.elicited_passed !== null
  );
  const elicitedPassed = elicitedEvaluated.filter(
    (item) => item.summary.elicited_passed
  ).length;
  const failures = eligible.filter((item) => item.summary.integration_failure);
  const elicitedRecovered = failures.filter((item) => item.summary.elicited_recovered).length;
  const workspaceRecovered = failures.filter((item) => item.summary.workspace_recovered).length;
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
  const elicitedVariantFamilies = variantFamilies.filter((family) =>
    family.every((item) => item.summary.elicited_passed !== null)
  );
  const elicitedConsistentFamilies = elicitedVariantFamilies.filter((family) =>
    family.every((item) => item.summary.elicited_passed === true)
  ).length;
  const workspaceVariantFamilies = variantFamilies.filter((family) =>
    family.every((item) => item.summary.workspace_passed !== null)
  );
  const workspaceConsistentFamilies = workspaceVariantFamilies.filter((family) =>
    family.every((item) => item.summary.workspace_passed === true)
  ).length;
  const baselineEmptyResponses = cases.filter((item) => !item.baseline?.response?.trim()).length;
  const elicitedEmptyResponses = cases.filter(
    (item) => item.elicited && !item.elicited.response?.trim()
  ).length;
  const baselinePassedAll = cases.filter((item) => item.summary.baseline_passed).length;
  const elicitedEvaluatedAll = cases.filter((item) => item.summary.elicited_passed !== null);
  const elicitedPassedAll = elicitedEvaluatedAll.filter(
    (item) => item.summary.elicited_passed
  ).length;
  const workspaceEvaluated = eligible.filter(
    (item) => item.summary.workspace_passed !== null
  );
  const workspacePassed = workspaceEvaluated.filter(
    (item) => item.summary.workspace_passed
  ).length;
  const workspaceEvaluatedAll = cases.filter((item) => item.summary.workspace_passed !== null);
  const workspacePassedAll = workspaceEvaluatedAll.filter(
    (item) => item.summary.workspace_passed
  ).length;
  const baselineMetrics = summarizeResponseMetrics(cases.map((item) => item.baseline));
  const elicitedIntegrationMetrics = summarizeResponseMetrics(
    cases.map((item) => item.elicited).filter(Boolean)
  );
  const atomicMetrics = summarizeAtomicMetrics(cases);
  const workspaceConstructionResponses = cases.flatMap((item) => {
    const construction = item.workspace?.construction;
    if (!construction) return [];
    return construction.attempts?.length > 0 ? construction.attempts : [construction];
  });
  const workspaceConstructionMetrics = summarizeResponseMetrics(workspaceConstructionResponses);
  const workspaceIntegrationMetrics = summarizeResponseMetrics(
    cases.map((item) => item.workspace?.integration).filter(Boolean)
  );
  const workspaceValid = cases.filter(
    (item) => item.workspace?.construction?.workspace?.valid === true
  ).length;
  const elicitedVsBaseline = pairedComparison(
    cases,
    (item) => item.summary.baseline_passed,
    (item) => item.summary.elicited_passed
  );
  const workspaceVsBaseline = pairedComparison(
    cases,
    (item) => item.summary.baseline_passed,
    (item) => item.summary.workspace_passed
  );
  return {
    total_cases: cases.length,
    atomic_eligible_cases: eligible.length,
    atomic_coverage: ratio(eligible.length, cases.length),
    baseline_overall_accuracy: ratio(baselinePassedAll, cases.length),
    elicited_overall_accuracy: ratio(elicitedPassedAll, elicitedEvaluatedAll.length),
    workspace_overall_accuracy: ratio(workspacePassedAll, workspaceEvaluatedAll.length),
    baseline_conditional_accuracy: ratio(baselinePassed, eligible.length),
    elicited_conditional_accuracy: ratio(elicitedPassed, elicitedEvaluated.length),
    workspace_conditional_accuracy: ratio(workspacePassed, workspaceEvaluated.length),
    observed_integration_failures: failures.length,
    elicited_recovered_integration_failures: elicitedRecovered,
    elicited_recovery_rate: ratio(elicitedRecovered, failures.length),
    workspace_recovered_integration_failures: workspaceRecovered,
    workspace_recovery_rate: ratio(workspaceRecovered, failures.length),
    valid_workspaces: workspaceValid,
    workspace_evaluated_cases: workspaceEvaluatedAll.length,
    workspace_construction_attempts: workspaceConstructionResponses.length,
    workspace_repair_attempts: workspaceConstructionResponses.filter(
      (item) => item.repair === true
    ).length,
    variant_families: variantFamilies.length,
    baseline_variant_consistency: ratio(baselineConsistentFamilies, variantFamilies.length),
    elicited_variant_consistency: ratio(
      elicitedConsistentFamilies,
      elicitedVariantFamilies.length
    ),
    workspace_variant_consistency: ratio(
      workspaceConsistentFamilies,
      workspaceVariantFamilies.length
    ),
    baseline_empty_responses: baselineEmptyResponses,
    elicited_empty_responses: elicitedEmptyResponses,
    paired_comparisons: {
      elicited_vs_baseline: elicitedVsBaseline,
      workspace_vs_baseline: workspaceVsBaseline
    },
    accuracy_intervals: {
      baseline_overall: wilsonInterval(baselinePassedAll, cases.length),
      elicited_overall: wilsonInterval(elicitedPassedAll, elicitedEvaluatedAll.length),
      workspace_overall: wilsonInterval(workspacePassedAll, workspaceEvaluatedAll.length),
      baseline_conditional: wilsonInterval(baselinePassed, eligible.length),
      elicited_conditional: wilsonInterval(elicitedPassed, elicitedEvaluated.length),
      workspace_conditional: wilsonInterval(workspacePassed, workspaceEvaluated.length)
    },
    inference: {
      atomic_elicitation: atomicMetrics,
      baseline: baselineMetrics,
      elicited_integration: elicitedIntegrationMetrics,
      elicited_total: elicitedEvaluatedAll.length > 0
        ? addMetrics(atomicMetrics, elicitedIntegrationMetrics)
        : null,
      workspace_construction: workspaceConstructionMetrics,
      workspace_integration: workspaceIntegrationMetrics,
      workspace_total: workspaceEvaluatedAll.length > 0
        ? addMetrics(
          addMetrics(atomicMetrics, workspaceConstructionMetrics),
          workspaceIntegrationMetrics
        )
        : null
    }
  };
}

function formatAtomicNotes(testCase, atomicResults) {
  return testCase.atomic.map((probe) => {
    const result = atomicResults.find((item) => item.id === probe.id);
    const responses = result?.attempts?.length > 0
      ? result.attempts.map((attempt, index) =>
        `Independent response ${index + 1}: ${attempt.response || "(empty)"}`
      ).join("\n")
      : `Independent response: ${result?.response || "(missing)"}`;
    return [
      `Probe ID: ${probe.id}`,
      `Probe: ${atomicPrompts(probe).join(" / ")}`,
      responses
    ].join("\n");
  }).join("\n\n");
}

function validateIntegrationTarget(target, path, errors) {
  if (!target?.prompt) errors.push(`${path}.prompt is required`);
  if (!target?.expected_label) errors.push(`${path}.expected_label is required`);
}

function summarizeAtomicMetrics(cases) {
  const timings = [];
  const seenFamilies = new Set();
  for (const item of cases) {
    const familyId = item.family_id || item.id;
    if (seenFamilies.has(familyId)) continue;
    seenFamilies.add(familyId);
    for (const probe of item.atomic || []) {
      if (probe.attempts?.length > 0) {
        timings.push(...probe.attempts.map((attempt) => ({
          response: attempt.response,
          timing: attempt.timing
        })));
      } else {
        timings.push({ response: probe.response, timing: probe.timing });
      }
    }
  }
  return summarizeResponseMetrics(timings);
}

function summarizeResponseMetrics(responses) {
  const normalized = responses.filter(Boolean);
  return {
    calls: normalized.length,
    wall_seconds: sum(normalized.map((item) => item.timing?.wall_seconds)),
    prompt_tokens: sum(normalized.map((item) => item.timing?.prompt_tokens)),
    completion_tokens: sum(normalized.map((item) => item.timing?.completion_tokens)),
    reasoning_characters: sum(normalized.map((item) => item.timing?.reasoning_characters)),
    empty_responses: normalized.filter((item) => !item.response?.trim()).length,
    length_terminated: normalized.filter((item) => item.timing?.finish_reason === "length").length
  };
}

function addMetrics(left, right) {
  return Object.fromEntries(Object.keys(left).map((key) => [key, left[key] + right[key]]));
}

function wilsonInterval(passed, total) {
  if (total === 0) return null;
  const z = 1.959963984540054;
  const observed = passed / total;
  const denominator = 1 + z ** 2 / total;
  const center = (observed + z ** 2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt(
    observed * (1 - observed) / total + z ** 2 / (4 * total ** 2)
  ) / denominator;
  return {
    passed,
    total,
    rate: observed,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin)
  };
}

function pairedComparison(cases, baselineValue, interventionValue) {
  const pairs = cases
    .map((item) => ({
      baseline: baselineValue(item),
      intervention: interventionValue(item)
    }))
    .filter((pair) => typeof pair.baseline === "boolean" &&
      typeof pair.intervention === "boolean");
  if (pairs.length === 0) return null;

  const improved = pairs.filter((pair) => !pair.baseline && pair.intervention).length;
  const regressed = pairs.filter((pair) => pair.baseline && !pair.intervention).length;
  const bothPassed = pairs.filter((pair) => pair.baseline && pair.intervention).length;
  const bothFailed = pairs.filter((pair) => !pair.baseline && !pair.intervention).length;
  const lift = (improved - regressed) / pairs.length;
  return {
    evaluated_cases: pairs.length,
    improved,
    regressed,
    both_passed: bothPassed,
    both_failed: bothFailed,
    accuracy_lift: lift,
    accuracy_lift_bootstrap_95: pairedBootstrapInterval(
      improved,
      regressed,
      bothPassed + bothFailed
    )
  };
}

function pairedBootstrapInterval(improved, regressed, unchanged) {
  const total = improved + regressed + unchanged;
  if (total === 0) return null;
  const probabilities = [
    { difference: -1, probability: regressed / total },
    { difference: 0, probability: unchanged / total },
    { difference: 1, probability: improved / total }
  ].filter((item) => item.probability > 0);
  let distribution = new Map([[0, 1]]);
  for (let draw = 0; draw < total; draw += 1) {
    const next = new Map();
    for (const [sumDifference, probability] of distribution.entries()) {
      for (const outcome of probabilities) {
        const nextDifference = sumDifference + outcome.difference;
        next.set(
          nextDifference,
          (next.get(nextDifference) || 0) + probability * outcome.probability
        );
      }
    }
    distribution = next;
  }
  const ordered = [...distribution.entries()].sort((left, right) => left[0] - right[0]);
  return {
    low: bootstrapQuantile(ordered, 0.025) / total,
    high: bootstrapQuantile(ordered, 0.975) / total
  };
}

function bootstrapQuantile(distribution, quantile) {
  let cumulative = 0;
  for (const [value, probability] of distribution) {
    cumulative += probability;
    if (cumulative >= quantile) return value;
  }
  return distribution.at(-1)?.[0] || 0;
}

function sum(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length > 0 ? numbers.reduce((total, value) => total + value, 0) : 0;
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
