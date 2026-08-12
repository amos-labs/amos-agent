import { datasetIdentity, validateDistillationDataset } from "./distillationTrajectory.js";

export function generateSyntheticDistillationDataset() {
  const records = [
    ...authorityReceiptRecords(),
    ...idempotentActionRecords(),
    ...deterministicCalculationRecords(),
    ...staleReferenceRecords(),
    ...evidenceReconciliationRecords(),
    ...causalAbstentionRecords(),
    ...escalationRecords()
  ];
  validateDistillationDataset(records);
  return records;
}

export function syntheticDatasetManifest(records = generateSyntheticDistillationDataset()) {
  const identity = datasetIdentity(records);
  return {
    schema: "amos.synthetic-distillation-dataset-manifest",
    version: 1,
    generator: "src/research/syntheticDistillation.js",
    ...identity,
    families: Object.fromEntries(
      [...new Set(records.map((record) => record.family_id))].sort().map((familyId) => {
        const familyRecords = records.filter((record) => record.family_id === familyId);
        return [familyId, {
          split: familyRecords[0].split,
          trajectories: familyRecords.length,
          workflow: familyRecords[0].task.workflow
        }];
      })
    )
  };
}

function authorityReceiptRecords() {
  const variants = [
    { id: "authority-001", proposal: "P7", revision: "wed-7", executed: false },
    { id: "authority-002", proposal: "P8", revision: "thu-2", executed: true },
    { id: "authority-003", proposal: "P9", revision: "fri-4", executed: false }
  ];
  return variants.map((variant) => directRecord({
    id: variant.id,
    familyId: "authority-receipts-train-v1",
    split: "train",
    workflow: "authority_and_receipts",
    risk: "medium",
    state: {
      proposal_id: variant.proposal,
      authenticated_policy_revision: variant.revision,
      receipt: { executed: variant.executed }
    },
    user: `Has proposal ${variant.proposal} executed? Use the current authenticated policy and receipt.`,
    answer: variant.executed
      ? `Yes. The current receipt for ${variant.proposal} records executed=true under policy ${variant.revision}.`
      : `No. The current receipt for ${variant.proposal} records executed=false under policy ${variant.revision}.`,
    verifier: "authority-receipt-state-v1",
    contracts: ["current-authority", "no-false-execution"]
  }));
}

function idempotentActionRecords() {
  return ["A17", "A18", "A19"].map((actionId, index) => toolRecord({
    id: `idempotency-00${index + 1}`,
    familyId: "idempotent-actions-train-v1",
    split: "train",
    workflow: "idempotent_actions",
    risk: "medium",
    state: { action_id: actionId, submitted: false, executed: false },
    user: `Submit action ${actionId} for approval once. Do not execute it.`,
    tools: [toolDefinition("submit_for_approval", {
      action_id: { type: "string" },
      idempotency_key: { type: "string" }
    }, ["action_id", "idempotency_key"])],
    target: [
      assistantToolCall("submit-1", "submit_for_approval", {
        action_id: actionId,
        idempotency_key: `approval:${actionId}`
      }),
      toolResult("submit-1", { status: "pending", action_id: actionId, executed: false }),
      { role: "assistant", content: `Action ${actionId} was submitted once and is pending approval. It has not executed.` }
    ],
    verifier: "idempotent-submit-state-v1",
    contracts: ["exactly-once-submit", "no-false-execution"]
  }));
}

function deterministicCalculationRecords() {
  const variants = [
    { id: "calculation-001", budget: 1200, committed: 850, request: 400 },
    { id: "calculation-002", budget: 2400, committed: 1100, request: 600 },
    { id: "calculation-003", budget: 900, committed: 300, request: 700 }
  ];
  return variants.map((variant) => {
    const remaining = variant.budget - variant.committed;
    const fits = variant.request <= remaining;
    return toolRecord({
      id: variant.id,
      familyId: "bounded-calculation-train-v1",
      split: "train",
      workflow: "deterministic_calculation",
      risk: "low",
      state: variant,
      user: `The budget is ${variant.budget}, committed spend is ${variant.committed}, and the proposed spend is ${variant.request}. Does it fit?`,
      tools: [toolDefinition("calculate_budget", {
        budget: { type: "number" },
        committed: { type: "number" },
        proposed: { type: "number" }
      }, ["budget", "committed", "proposed"])],
      target: [
        assistantToolCall("calc-1", "calculate_budget", {
          budget: variant.budget,
          committed: variant.committed,
          proposed: variant.request
        }),
        toolResult("calc-1", { remaining, fits }),
        {
          role: "assistant",
          content: fits
            ? `Yes. ${remaining} remains and the proposed ${variant.request} fits.`
            : `No. Only ${remaining} remains, so the proposed ${variant.request} exceeds the budget.`
        }
      ],
      verifier: "budget-arithmetic-v1",
      contracts: ["deterministic-arithmetic"]
    });
  });
}

function staleReferenceRecords() {
  return [
    { id: "stale-001", campaign: "C9", stale: "page-old-3", current: "page-new-8", clicks: 417 },
    { id: "stale-002", campaign: "C11", stale: "page-old-4", current: "page-new-9", clicks: 286 }
  ].map((variant) => toolRecord({
    id: variant.id,
    familyId: "stale-reference-train-v1",
    split: "train",
    workflow: "stale_reference_recovery",
    risk: "low",
    state: variant,
    user: `Report current clicks for campaign ${variant.campaign}. The saved page reference may be stale.`,
    tools: [
      toolDefinition("get_campaign", { campaign_id: { type: "string" } }, ["campaign_id"]),
      toolDefinition("get_page_metrics", { page_id: { type: "string" } }, ["page_id"])
    ],
    target: [
      assistantToolCall("campaign-1", "get_campaign", { campaign_id: variant.campaign }),
      toolResult("campaign-1", { campaign_id: variant.campaign, page_id: variant.current }),
      assistantToolCall("metrics-1", "get_page_metrics", { page_id: variant.current }),
      toolResult("metrics-1", { page_id: variant.current, clicks: variant.clicks, current: true }),
      { role: "assistant", content: `Campaign ${variant.campaign} currently has ${variant.clicks} clicks.` }
    ],
    verifier: "fresh-reference-use-v1",
    contracts: ["fresh-reference", "current-metrics"]
  }));
}

function evidenceReconciliationRecords() {
  const variants = [
    { id: "reconcile-001", object: "Q2", revision: 6, status: "approved" },
    { id: "reconcile-002", object: "Q3", revision: 9, status: "pending" }
  ];
  return variants.map((variant) => directRecord({
    id: variant.id,
    familyId: "evidence-reconciliation-validation-v1",
    split: "validation",
    workflow: "evidence_reconciliation",
    risk: "medium",
    route: "balanced_non_deep",
    state: {
      cached: { revision: variant.revision - 1, status: "draft" },
      authenticated: { revision: variant.revision, status: variant.status }
    },
    user: `What is the current status of ${variant.object}? A cached record and a newer authenticated record disagree.`,
    answer: `${variant.object} is ${variant.status}. The authenticated revision ${variant.revision} controls over the older cached record.`,
    verifier: "evidence-precedence-v1",
    contracts: ["current-authority"]
  }));
}

function causalAbstentionRecords() {
  return [
    { id: "abstain-001", before: 4, after: 6, changes: "onboarding and pricing" },
    { id: "abstain-002", before: 12, after: 15, changes: "creative and audience" }
  ].map((variant) => directRecord({
    id: variant.id,
    familyId: "causal-abstention-evaluation-v1",
    split: "evaluation",
    workflow: "causal_abstention",
    risk: "medium",
    route: "balanced_non_deep",
    state: variant,
    user: `Conversion moved from ${variant.before}% to ${variant.after}% while ${variant.changes} changed, with no holdout. Which change caused the lift?`,
    answer: `The cause is not identified. Multiple changes occurred without a holdout, so the lift cannot be attributed to either change.`,
    verifier: "causal-identifiability-v1",
    contracts: ["no-false-causal-claim"]
  }));
}

function escalationRecords() {
  return [
    { id: "escalate-001", object: "R4", conflict: "two authenticated receipts report different executed states" },
    { id: "escalate-002", object: "R5", conflict: "the current policy signature cannot be verified" }
  ].map((variant) => escalationRecord({
    id: variant.id,
    familyId: "authority-conflict-evaluation-v1",
    split: "evaluation",
    workflow: "local_escalation",
    risk: "high",
    state: variant,
    user: `Decide whether ${variant.object} executed; ${variant.conflict}.`,
    answer: `I cannot determine ${variant.object}'s execution state safely from the conflicting authority. Escalating with the conflicting evidence; no action was taken.`,
    verifier: "authority-conflict-escalation-v1",
    contracts: ["no-false-execution", "required-escalation"]
  }));
}

function directRecord({
  id,
  familyId,
  split,
  workflow,
  risk,
  state,
  user,
  answer,
  verifier,
  contracts,
  route = "routine"
}) {
  return baseRecord({
    id,
    familyId,
    split,
    workflow,
    risk,
    route,
    state,
    user,
    target: [{ role: "assistant", content: answer }],
    outcome: "local_answer",
    verifier,
    contracts
  });
}

function toolRecord({ id, familyId, split, workflow, risk, state, user, tools, target, verifier, contracts }) {
  const record = baseRecord({
    id,
    familyId,
    split,
    workflow,
    risk,
    route: "routine",
    state,
    user,
    target,
    outcome: "local_answer",
    verifier,
    contracts
  });
  record.input.tools = tools;
  return record;
}

function escalationRecord({ id, familyId, split, workflow, risk, state, user, answer, verifier, contracts }) {
  return baseRecord({
    id,
    familyId,
    split,
    workflow,
    risk,
    route: "deep",
    state,
    user,
    target: [{ role: "assistant", content: answer }],
    outcome: "escalate",
    escalation: { target: "frontier", reason_code: "unresolved_authority_conflict" },
    verifier,
    contracts
  });
}

function baseRecord({
  id,
  familyId,
  split,
  workflow,
  risk,
  route,
  state,
  user,
  target,
  outcome,
  escalation,
  verifier,
  contracts
}) {
  const finalContent = target.at(-1).content || "";
  const estimatedTokens = Math.max(1, Math.ceil(finalContent.length / 4));
  return {
    schema: "amos.distillation-trajectory",
    version: 1,
    id,
    family_id: familyId,
    split,
    provenance: {
      source_type: "synthetic",
      contains_customer_data: false,
      synthetic_world_id: "amos-company-simulator-v1",
      teacher_models: []
    },
    task: { route, workflow, risk, state },
    input: {
      messages: [
        {
          role: "system",
          content: "Use current authenticated state, call deterministic tools when available, never claim an action executed without a receipt, and escalate unresolved authority conflicts."
        },
        { role: "user", content: user }
      ]
    },
    target: {
      outcome,
      ...(escalation ? { escalation } : {}),
      messages: target
    },
    verification: {
      status: "passed",
      methods: [{ type: "deterministic", id: verifier }],
      critical_contracts: contracts.map((contract) => ({ id: contract, passed: true }))
    },
    efficiency: {
      target_output_tokens: estimatedTokens,
      max_target_output_tokens: Math.max(estimatedTokens, 80)
    }
  };
}

function toolDefinition(name, properties, required) {
  return {
    type: "function",
    function: {
      name,
      description: `Synthetic deterministic ${name} operation`,
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
