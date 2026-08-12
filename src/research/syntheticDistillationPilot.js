import { runInNewContext } from "node:vm";
import { datasetIdentity, validateDistillationDataset } from "./distillationTrajectory.js";

const DEFAULT_SEED = "amos-operator-pilot-v1";
const DEFAULT_SYSTEM_PROMPT =
  "Use current authenticated state. Use deterministic tools for state reads, calculations, and actions when they are available. Never claim execution without a receipt. Report tool outcomes completely and escalate unresolved authority conflicts.";

const WORKFLOW_SLOTS = [
  "authority_receipt",
  "authority_receipt",
  "authority_receipt",
  "idempotent_submission",
  "idempotent_submission",
  "budget_constraint",
  "budget_constraint",
  "budget_constraint",
  "schedule_constraint",
  "schedule_constraint",
  "stale_reference_recovery",
  "stale_reference_recovery",
  "evidence_reconciliation",
  "evidence_reconciliation",
  "executable_code",
  "executable_code",
  "executable_code",
  "causal_abstention",
  "authority_escalation",
  "authority_escalation"
];

const SKILL_GROUPS = {
  authority_receipt: "authority_receipts_and_idempotency",
  idempotent_submission: "authority_receipts_and_idempotency",
  budget_constraint: "deterministic_math_and_constraint_checking",
  schedule_constraint: "deterministic_math_and_constraint_checking",
  stale_reference_recovery: "tool_recovery_and_evidence_reconciliation",
  evidence_reconciliation: "tool_recovery_and_evidence_reconciliation",
  executable_code: "executable_code_and_repair",
  causal_abstention: "causal_abstention_and_escalation",
  authority_escalation: "causal_abstention_and_escalation"
};

export function generateSyntheticDistillationPilot(options = {}) {
  const normalized = normalizeOptions(options);
  const records = [
    ...generateSplit("train", normalized.train, normalized),
    ...generateSplit("validation", normalized.validation, normalized)
  ];
  validateDistillationDataset(records);
  return records;
}

export function syntheticPilotManifest(records = generateSyntheticDistillationPilot()) {
  const identity = datasetIdentity(records);
  const families = new Set(records.map((record) => record.family_id));
  return {
    schema: "amos.synthetic-distillation-pilot-manifest",
    version: 1,
    generator: "src/research/syntheticDistillationPilot.js",
    seed: records[0]?.provenance.synthetic_world_id?.split(":").at(-1) || DEFAULT_SEED,
    ...identity,
    family_count: families.size,
    variants_per_family: familyVariantCounts(records),
    tool_trajectories: records.filter((record) => record.input.tools?.length > 0).length,
    executable_trajectories: records.filter((record) =>
      record.verification.methods.some((method) => method.type === "executable")
    ).length,
    code_repair_trajectories: records.filter((record) =>
      record.task.workflow === "executable_code" && record.input.messages.at(-1).content.startsWith("Repair")
    ).length,
    workflows: countBy(records, (record) => record.task.workflow),
    skill_groups: countBy(records, (record) => record.task.skill_group),
    splits: Object.fromEntries(
      ["train", "validation"].map((split) => {
        const selected = records.filter((record) => record.split === split);
        return [split, {
          trajectories: selected.length,
          families: new Set(selected.map((record) => record.family_id)).size,
          skill_groups: countBy(selected, (record) => record.task.skill_group)
        }];
      })
    )
  };
}

function normalizeOptions(options) {
  const normalized = {
    train: options.train ?? 1000,
    validation: options.validation ?? 200,
    variantsPerFamily: options.variantsPerFamily ?? 2,
    seed: options.seed ?? DEFAULT_SEED
  };
  for (const key of ["train", "validation", "variantsPerFamily"]) {
    if (!Number.isInteger(normalized[key]) || normalized[key] < 1) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  if (typeof normalized.seed !== "string" || normalized.seed.length < 3) {
    throw new Error("seed must be a stable string");
  }
  return normalized;
}

function generateSplit(split, count, options) {
  return Array.from({ length: count }, (_, recordIndex) => {
    const familyIndex = Math.floor(recordIndex / options.variantsPerFamily);
    const variantIndex = recordIndex % options.variantsPerFamily;
    const workflow = WORKFLOW_SLOTS[familyIndex % WORKFLOW_SLOTS.length];
    const scenario = stableNumber(`${options.seed}:${split}:${familyIndex}`);
    const context = {
      split,
      familyIndex,
      variantIndex,
      scenario,
      seed: options.seed,
      workflow,
      familyId: `pilot-${split}-${workflow}-${pad(familyIndex + 1, 4)}`,
      id: `pilot-${split}-${workflow}-${pad(familyIndex + 1, 4)}-v${variantIndex + 1}`
    };
    return workflowGenerator(workflow)(context);
  });
}

function workflowGenerator(workflow) {
  return {
    authority_receipt: authorityReceiptRecord,
    idempotent_submission: idempotentSubmissionRecord,
    budget_constraint: budgetConstraintRecord,
    schedule_constraint: scheduleConstraintRecord,
    stale_reference_recovery: staleReferenceRecord,
    evidence_reconciliation: evidenceReconciliationRecord,
    executable_code: executableCodeRecord,
    causal_abstention: causalAbstentionRecord,
    authority_escalation: authorityEscalationRecord
  }[workflow];
}

function authorityReceiptRecord(context) {
  const proposal = `P${1000 + bounded(context.scenario, 8000)}`;
  const revision = 10 + bounded(context.scenario >>> 2, 80);
  const executed = bounded(context.scenario >>> 5, 2) === 1;
  const prompts = [
    `The cached entry for ${proposal} says executed=${!executed}, but authenticated receipt r${revision} says executed=${executed}. Has it executed?`,
    `Use the newest authenticated evidence for ${proposal}. Cache: executed=${!executed}. Receipt r${revision}: executed=${executed}. Report its execution state.`
  ];
  return directRecord(context, {
    risk: "medium",
    state: {
      proposal_id: proposal,
      cached: { revision: revision - 1, executed: !executed },
      authenticated_receipt: { revision, executed }
    },
    user: variant(prompts, context.variantIndex),
    answer: executed
      ? `Yes. Authenticated receipt r${revision} records ${proposal} as executed=true.`
      : `No. Authenticated receipt r${revision} records ${proposal} as executed=false.`,
    verifier: "authority-receipt-state-v2",
    contracts: ["current-authority", "no-false-execution"]
  });
}

function idempotentSubmissionRecord(context) {
  const actionId = `A${2000 + bounded(context.scenario, 7000)}`;
  const key = `approval:${actionId.toLowerCase()}`;
  const prompts = [
    `Submit action ${actionId} for approval exactly once. Do not execute it.`,
    `Create one approval submission for ${actionId}, using an idempotency key. Execution is not authorized.`
  ];
  return toolRecord(context, {
    risk: "medium",
    state: { action_id: actionId, submitted: false, executed: false },
    user: variant(prompts, context.variantIndex),
    tools: [toolDefinition(
      "submit_for_approval",
      "Create an idempotent approval request without executing the action.",
      {
        action_id: { type: "string" },
        idempotency_key: { type: "string" }
      },
      ["action_id", "idempotency_key"]
    )],
    target: [
      assistantToolCall("submit-1", "submit_for_approval", {
        action_id: actionId,
        idempotency_key: key
      }),
      toolResult("submit-1", {
        status: "pending",
        action_id: actionId,
        idempotency_key: key,
        executed: false
      }),
      {
        role: "assistant",
        content: `${actionId} was submitted once with idempotency key ${key}. It is pending approval and has not executed.`
      }
    ],
    verifier: "idempotent-submit-state-v2",
    contracts: ["exactly-once-submit", "receipt-complete-report", "no-false-execution"]
  });
}

function budgetConstraintRecord(context) {
  const budget = 1000 + bounded(context.scenario, 8000);
  const committed = 100 + bounded(context.scenario >>> 3, Math.max(1, budget - 300));
  const remaining = budget - committed;
  const margin = 25 + bounded(context.scenario >>> 7, 300);
  const proposed = bounded(context.scenario >>> 11, 2) === 0
    ? Math.max(1, remaining - margin)
    : remaining + margin;
  const fits = proposed <= remaining;
  const prompts = [
    `Budget is ${budget}; ${committed} is committed; a new request is ${proposed}. Use the calculator and say whether it fits.`,
    `Check a proposed spend of ${proposed} against total budget ${budget} and existing commitments of ${committed}.`
  ];
  return toolRecord(context, {
    risk: "low",
    state: { budget, committed, proposed },
    user: variant(prompts, context.variantIndex),
    tools: [toolDefinition(
      "calculate_budget",
      "Calculate remaining budget and whether a proposed spend fits.",
      {
        budget: { type: "number" },
        committed: { type: "number" },
        proposed: { type: "number" }
      },
      ["budget", "committed", "proposed"]
    )],
    target: [
      assistantToolCall("budget-1", "calculate_budget", { budget, committed, proposed }),
      toolResult("budget-1", { remaining, fits }),
      {
        role: "assistant",
        content: fits
          ? `Yes. ${remaining} remains, so the proposed ${proposed} fits.`
          : `No. ${remaining} remains, so the proposed ${proposed} exceeds the budget by ${proposed - remaining}.`
      }
    ],
    verifier: "budget-arithmetic-v2",
    contracts: ["deterministic-arithmetic", "receipt-complete-report"]
  });
}

function scheduleConstraintRecord(context) {
  const windowStart = 8 + bounded(context.scenario, 3);
  const deadline = 16 + bounded(context.scenario >>> 3, 3);
  const duration = 1 + bounded(context.scenario >>> 6, 3);
  const blackoutStart = 11 + bounded(context.scenario >>> 9, 4);
  const blackoutEnd = blackoutStart + 1;
  const feasibleStarts = [];
  for (let start = windowStart; start + duration <= deadline; start += 1) {
    if (!overlaps(start, start + duration, blackoutStart, blackoutEnd)) feasibleStarts.push(start);
  }
  const shouldFit = bounded(context.scenario >>> 13, 2) === 0 && feasibleStarts.length > 0;
  const requestedStart = shouldFit
    ? feasibleStarts[bounded(context.scenario >>> 16, feasibleStarts.length)]
    : blackoutStart;
  const requestedEnd = requestedStart + duration;
  const fits = requestedStart >= windowStart && requestedEnd <= deadline &&
    !overlaps(requestedStart, requestedEnd, blackoutStart, blackoutEnd);
  const reason = fits
    ? "inside_window_and_clear"
    : overlaps(requestedStart, requestedEnd, blackoutStart, blackoutEnd)
      ? "overlaps_blackout"
      : "outside_window";
  const prompts = [
    `Can a ${duration}-hour task start at ${requestedStart}:00 if work begins at ${windowStart}:00, the deadline is ${deadline}:00, and ${blackoutStart}:00-${blackoutEnd}:00 is blocked?`,
    `Check this schedule with the constraint tool: start ${requestedStart}:00, duration ${duration}h, allowed window ${windowStart}:00-${deadline}:00, blackout ${blackoutStart}:00-${blackoutEnd}:00.`
  ];
  return toolRecord(context, {
    risk: "low",
    state: { window_start: windowStart, deadline, duration, requested_start: requestedStart, blackout: [blackoutStart, blackoutEnd] },
    user: variant(prompts, context.variantIndex),
    tools: [toolDefinition(
      "check_schedule_window",
      "Check a proposed contiguous work interval against a deadline and blackout.",
      {
        requested_start: { type: "integer" },
        duration_hours: { type: "integer" },
        window_start: { type: "integer" },
        deadline: { type: "integer" },
        blackout_start: { type: "integer" },
        blackout_end: { type: "integer" }
      },
      ["requested_start", "duration_hours", "window_start", "deadline", "blackout_start", "blackout_end"]
    )],
    target: [
      assistantToolCall("schedule-1", "check_schedule_window", {
        requested_start: requestedStart,
        duration_hours: duration,
        window_start: windowStart,
        deadline,
        blackout_start: blackoutStart,
        blackout_end: blackoutEnd
      }),
      toolResult("schedule-1", { requested_end: requestedEnd, fits, reason }),
      {
        role: "assistant",
        content: fits
          ? `Yes. ${requestedStart}:00-${requestedEnd}:00 is inside the allowed window and does not overlap the blackout.`
          : `No. ${requestedStart}:00-${requestedEnd}:00 ${reason === "overlaps_blackout" ? "overlaps the blackout" : "falls outside the allowed window"}.`
      }
    ],
    verifier: "schedule-constraint-v2",
    contracts: ["deterministic-constraints", "receipt-complete-report"]
  });
}

function staleReferenceRecord(context) {
  const campaign = `C${100 + bounded(context.scenario, 800)}`;
  const stalePageNumber = 1000 + bounded(context.scenario >>> 3, 8000);
  const candidatePageNumber = 1000 + bounded(context.scenario >>> 7, 8000);
  const currentPageNumber = candidatePageNumber === stalePageNumber
    ? 1000 + ((candidatePageNumber - 999) % 8000)
    : candidatePageNumber;
  const stalePage = `page-${stalePageNumber}`;
  const currentPage = `page-${currentPageNumber}`;
  const clicks = 50 + bounded(context.scenario >>> 11, 9500);
  const prompts = [
    `Report current clicks for campaign ${campaign}. The saved page ${stalePage} may be stale.`,
    `Resolve the current page for ${campaign}, then report its click count; do not trust saved page ${stalePage}.`
  ];
  return toolRecord(context, {
    risk: "low",
    state: { campaign_id: campaign, saved_page_id: stalePage, current_page_id: currentPage, clicks },
    user: variant(prompts, context.variantIndex),
    tools: [
      toolDefinition(
        "get_campaign",
        "Read the current authenticated campaign record.",
        { campaign_id: { type: "string" } },
        ["campaign_id"]
      ),
      toolDefinition(
        "get_page_metrics",
        "Read current metrics for a page identifier.",
        { page_id: { type: "string" } },
        ["page_id"]
      )
    ],
    target: [
      assistantToolCall("campaign-1", "get_campaign", { campaign_id: campaign }),
      toolResult("campaign-1", { campaign_id: campaign, page_id: currentPage }),
      assistantToolCall("metrics-1", "get_page_metrics", { page_id: currentPage }),
      toolResult("metrics-1", { page_id: currentPage, clicks, current: true }),
      { role: "assistant", content: `${campaign}'s current page is ${currentPage}, with ${clicks} clicks.` }
    ],
    verifier: "fresh-reference-use-v2",
    contracts: ["fresh-reference", "exact-tool-order", "receipt-complete-report"]
  });
}

function evidenceReconciliationRecord(context) {
  const objectId = `Q${100 + bounded(context.scenario, 800)}`;
  const revision = 2 + bounded(context.scenario >>> 4, 40);
  const statuses = ["approved", "pending", "rejected", "paused"];
  const status = statuses[bounded(context.scenario >>> 9, statuses.length)];
  const cachedStatus = statuses[(statuses.indexOf(status) + 1) % statuses.length];
  const prompts = [
    `Cached ${objectId} revision ${revision - 1} says ${cachedStatus}. Read the authenticated record and report the current status.`,
    `Reconcile ${objectId}: cache=${cachedStatus} at r${revision - 1}. Use the current-record tool before answering.`
  ];
  return toolRecord(context, {
    risk: "medium",
    state: { object_id: objectId, cached: { revision: revision - 1, status: cachedStatus }, authenticated: { revision, status } },
    user: variant(prompts, context.variantIndex),
    tools: [toolDefinition(
      "get_authenticated_record",
      "Read the current authenticated record for an object.",
      { object_id: { type: "string" } },
      ["object_id"]
    )],
    target: [
      assistantToolCall("record-1", "get_authenticated_record", { object_id: objectId }),
      toolResult("record-1", { object_id: objectId, revision, status, authenticated: true }),
      { role: "assistant", content: `${objectId} is ${status} at authenticated revision ${revision}; the older cached ${cachedStatus} state does not control.` }
    ],
    verifier: "evidence-precedence-v2",
    contracts: ["current-authority", "receipt-complete-report"]
  });
}

function executableCodeRecord(context) {
  const specification = codeSpecification(context);
  verifyGeneratedCode(specification);
  const prompts = [specification.prompt, specification.alternatePrompt];
  return baseRecord(context, {
    risk: "low",
    state: specification.state,
    user: variant(prompts, context.variantIndex),
    target: [{ role: "assistant", content: `\`\`\`javascript\n${specification.code}\n\`\`\`` }],
    outcome: "local_answer",
    verificationType: "executable",
    verifier: specification.suiteId,
    contracts: ["executable-code", "deterministic-output"]
  });
}

function causalAbstentionRecord(context) {
  const before = 2 + bounded(context.scenario, 12);
  const after = before + 1 + bounded(context.scenario >>> 5, 6);
  const changePairs = [
    ["pricing", "onboarding"],
    ["creative", "audience"],
    ["sales script", "lead source"],
    ["landing page", "offer"]
  ];
  const changes = changePairs[bounded(context.scenario >>> 9, changePairs.length)];
  const prompts = [
    `Conversion rose from ${before}% to ${after}% after both ${changes[0]} and ${changes[1]} changed. There was no holdout. Which change caused the lift?`,
    `We changed ${changes[0]} and ${changes[1]} together; conversion moved ${before}%→${after}% with no control group. Attribute the increase.`
  ];
  return directRecord(context, {
    risk: "medium",
    route: "balanced_non_deep",
    state: { before_percent: before, after_percent: after, simultaneous_changes: changes, holdout: false },
    user: variant(prompts, context.variantIndex),
    answer: `The cause is not identified. ${changes[0]} and ${changes[1]} changed together without a holdout, so the lift cannot be attributed to either one.`,
    verifier: "causal-identifiability-v2",
    contracts: ["no-false-causal-claim"]
  });
}

function authorityEscalationRecord(context) {
  const objectId = `R${100 + bounded(context.scenario, 800)}`;
  const conflicts = [
    "two authenticated receipts report different executed states",
    "the newest receipt signature cannot be verified",
    "two equally current policy records name different approvers",
    "the action receipt exists but its policy revision is missing"
  ];
  const conflict = conflicts[bounded(context.scenario >>> 6, conflicts.length)];
  const prompts = [
    `Decide whether ${objectId} executed; ${conflict}.`,
    `${objectId} has unresolved authority evidence: ${conflict}. Give the safe operational result.`
  ];
  return baseRecord(context, {
    risk: "high",
    route: "deep",
    state: { object_id: objectId, conflict },
    user: variant(prompts, context.variantIndex),
    target: [{
      role: "assistant",
      content: `I cannot safely determine whether ${objectId} executed. I am escalating the conflicting evidence; no action was taken.`
    }],
    outcome: "escalate",
    escalation: { target: "frontier", reason_code: "unresolved_authority_conflict" },
    verifier: "authority-conflict-escalation-v2",
    contracts: ["no-false-execution", "required-escalation"]
  });
}

function codeSpecification(context) {
  const type = bounded(context.scenario, 3);
  if (type === 0) return filteredTotalSpecification(context);
  if (type === 1) return latestRevisionSpecification(context);
  return pendingActionSpecification(context);
}

function filteredTotalSpecification(context) {
  const valueFields = ["amount", "cost", "units", "effort", "value"];
  const statusFields = ["status", "stage", "state"];
  const acceptedValues = ["approved", "ready", "billable", "active"];
  const valueField = valueFields[bounded(context.scenario >>> 3, valueFields.length)];
  const statusField = statusFields[bounded(context.scenario >>> 7, statusFields.length)];
  const accepted = acceptedValues[bounded(context.scenario >>> 10, acceptedValues.length)];
  const functionName = `total${pascal(valueField)}For${pascal(accepted)}`;
  const code = `function ${functionName}(records) {\n  return records\n    .filter((record) => record.${statusField} === ${JSON.stringify(accepted)})\n    .reduce((total, record) => total + record.${valueField}, 0);\n}`;
  return {
    prompt: `Write a JavaScript function ${functionName}(records) that sums numeric ${valueField} only where ${statusField} equals ${accepted}. Return only the function.`,
    alternatePrompt: `Repair this JavaScript function so it sums ${valueField} only for ${statusField}=${accepted}: \`function ${functionName}(records) { return records.reduce((sum, row) => sum + row.${valueField}, 0); }\` Return only the corrected function.`,
    state: { language: "javascript", function_name: functionName, operation: "filtered_total", value_field: valueField, status_field: statusField, accepted_value: accepted },
    code,
    functionName,
    cases: [
      { args: [[{ [statusField]: accepted, [valueField]: 7 }, { [statusField]: "other", [valueField]: 99 }, { [statusField]: accepted, [valueField]: 5 }]], expected: 12 },
      { args: [[]], expected: 0 }
    ],
    suiteId: "generated-filtered-total-v1"
  };
}

function latestRevisionSpecification(context) {
  const idFields = ["account_id", "proposal_id", "task_id", "campaign_id", "record_id"];
  const idField = idFields[bounded(context.scenario >>> 3, idFields.length)];
  const functionName = `latestBy${pascal(idField)}`;
  const code = `function ${functionName}(records) {\n  const latest = new Map();\n  for (const record of records) {\n    const prior = latest.get(record.${idField});\n    if (!prior || record.revision > prior.revision) latest.set(record.${idField}, record);\n  }\n  return [...latest.values()].sort((a, b) => String(a.${idField}).localeCompare(String(b.${idField})));\n}`;
  const records = [
    { [idField]: "b", revision: 1, value: "old-b" },
    { [idField]: "a", revision: 3, value: "new-a" },
    { [idField]: "a", revision: 2, value: "old-a" },
    { [idField]: "b", revision: 4, value: "new-b" }
  ];
  return {
    prompt: `Write ${functionName}(records) in JavaScript. Keep the highest revision per ${idField} and return the retained records sorted by ${idField}. Return only the function.`,
    alternatePrompt: `Repair \`function ${functionName}(records) { return [...new Map(records.map(row => [row.${idField}, row])).values()]; }\` so it retains the greatest revision per ${idField} even when input order differs, then sorts by ${idField}. Return only the corrected function.`,
    state: { language: "javascript", function_name: functionName, operation: "latest_revision", id_field: idField, revision_field: "revision" },
    code,
    functionName,
    cases: [
      { args: [records], expected: [records[1], records[3]] },
      { args: [[]], expected: [] }
    ],
    suiteId: "generated-latest-revision-v1"
  };
}

function pendingActionSpecification(context) {
  const idFields = ["action_id", "job_id", "request_id", "proposal_id"];
  const approvalFields = ["approved", "authorized", "cleared"];
  const executionFields = ["executed", "completed", "applied"];
  const idField = idFields[bounded(context.scenario >>> 4, idFields.length)];
  const approvalField = approvalFields[bounded(context.scenario >>> 8, approvalFields.length)];
  const executionField = executionFields[bounded(context.scenario >>> 11, executionFields.length)];
  const functionName = `pending${pascal(idField)}s`;
  const code = `function ${functionName}(records) {\n  return records\n    .filter((record) => record.${approvalField} === true && record.${executionField} === false)\n    .map((record) => record.${idField})\n    .sort((a, b) => String(a).localeCompare(String(b)));\n}`;
  return {
    prompt: `Write JavaScript ${functionName}(records). Return sorted ${idField} values for rows with ${approvalField}=true and ${executionField}=false. Return only the function.`,
    alternatePrompt: `Repair this filter: \`records.filter(row => row.${approvalField} || !row.${executionField})\`. Implement ${functionName}(records) to return sorted ${idField} values only when ${approvalField}=true and ${executionField}=false. Return only the corrected function.`,
    state: { language: "javascript", function_name: functionName, operation: "pending_actions", id_field: idField, approval_field: approvalField, execution_field: executionField },
    code,
    functionName,
    cases: [
      { args: [[
        { [idField]: "z2", [approvalField]: true, [executionField]: false },
        { [idField]: "a1", [approvalField]: true, [executionField]: false },
        { [idField]: "m4", [approvalField]: false, [executionField]: false },
        { [idField]: "b3", [approvalField]: true, [executionField]: true }
      ]], expected: ["a1", "z2"] },
      { args: [[]], expected: [] }
    ],
    suiteId: "generated-pending-actions-v1"
  };
}

function verifyGeneratedCode(specification) {
  const callable = runInNewContext(
    `${specification.code}\n${specification.functionName}`,
    Object.create(null),
    { timeout: 50 }
  );
  for (const [index, testCase] of specification.cases.entries()) {
    const actual = callable(...structuredClone(testCase.args));
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
      throw new Error(`${specification.suiteId} failed generated case ${index + 1}`);
    }
  }
}

function directRecord(context, options) {
  return baseRecord(context, {
    ...options,
    target: [{ role: "assistant", content: options.answer }],
    outcome: "local_answer"
  });
}

function toolRecord(context, options) {
  const record = baseRecord(context, {
    ...options,
    target: options.target,
    outcome: "local_answer"
  });
  record.input.tools = options.tools;
  return record;
}

function baseRecord(context, options) {
  const targetText = JSON.stringify(options.target);
  const estimatedTokens = Math.max(1, Math.ceil(targetText.length / 4));
  return {
    schema: "amos.distillation-trajectory",
    version: 1,
    id: context.id,
    family_id: context.familyId,
    split: context.split,
    provenance: {
      source_type: "synthetic",
      contains_customer_data: false,
      synthetic_world_id: `amos-pilot:${context.seed}`,
      teacher_models: []
    },
    task: {
      route: options.route || "routine",
      workflow: context.workflow,
      skill_group: SKILL_GROUPS[context.workflow],
      risk: options.risk,
      state: options.state
    },
    input: {
      messages: [
        { role: "system", content: DEFAULT_SYSTEM_PROMPT },
        { role: "user", content: options.user }
      ]
    },
    target: {
      outcome: options.outcome,
      ...(options.escalation ? { escalation: options.escalation } : {}),
      messages: options.target
    },
    verification: {
      status: "passed",
      methods: [{ type: options.verificationType || "deterministic", id: options.verifier }],
      critical_contracts: options.contracts.map((id) => ({ id, passed: true }))
    },
    efficiency: {
      target_output_tokens: estimatedTokens,
      max_target_output_tokens: Math.max(estimatedTokens, 256)
    }
  };
}

function toolDefinition(name, description, properties, required) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false }
    }
  };
}

function assistantToolCall(id, name, argumentsValue) {
  return {
    role: "assistant",
    content: "",
    tool_calls: [{
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(argumentsValue) }
    }]
  };
}

function toolResult(toolCallId, value) {
  return { role: "tool", tool_call_id: toolCallId, content: JSON.stringify(value) };
}

function stableNumber(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function bounded(value, size) {
  return size <= 1 ? 0 : (value >>> 0) % size;
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function variant(values, index) {
  return values[index % values.length];
}

function pascal(value) {
  return value.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = selector(record);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function familyVariantCounts(records) {
  const counts = countBy(records, (record) => record.family_id);
  return Object.fromEntries(
    Object.entries(countBy(Object.values(counts), (count) => String(count)))
      .map(([variants, families]) => [variants, families])
  );
}
