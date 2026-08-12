import { runInNewContext } from "node:vm";
import { datasetIdentity, validateDistillationDataset } from "./distillationTrajectory.js";

const DEFAULT_SEED = "amos-operator-retention-v2";
const DEFAULT_SYSTEM_PROMPT =
  "Reason from supplied evidence and current authenticated state. Use deterministic tools when available. Preserve identifiers and numeric values exactly. Never claim execution without a receipt, and report material receipt fields completely.";

const WORKFLOW_SLOTS = [
  "correlated_bayes", "causal_collider", "simpson_stratification", "deadline_optimization", "fencing_epoch",
  "correlated_bayes", "causal_collider", "simpson_stratification", "deadline_optimization", "fencing_epoch",
  "multi_step_recovery", "multi_step_recovery", "idempotent_receipt", "idempotent_receipt", "authority_conflict",
  "dependency_code", "ledger_code", "critical_path_code",
  "exact_receipt_grounding", "digit_budget_grounding"
];

const SKILL_GROUPS = {
  correlated_bayes: "broad_verified_capability_replay",
  causal_collider: "broad_verified_capability_replay",
  simpson_stratification: "broad_verified_capability_replay",
  deadline_optimization: "broad_verified_capability_replay",
  fencing_epoch: "broad_verified_capability_replay",
  multi_step_recovery: "amos_tool_and_authority_trajectories",
  idempotent_receipt: "amos_tool_and_authority_trajectories",
  authority_conflict: "amos_tool_and_authority_trajectories",
  dependency_code: "hard_algorithmic_code_and_repair",
  ledger_code: "hard_algorithmic_code_and_repair",
  critical_path_code: "hard_algorithmic_code_and_repair",
  exact_receipt_grounding: "receipt_grounding_and_exact_value_copy",
  digit_budget_grounding: "receipt_grounding_and_exact_value_copy"
};

export function generateSyntheticDistillationRetention(options = {}) {
  const normalized = normalizeOptions(options);
  const records = [
    ...generateSplit("train", normalized.train, normalized),
    ...generateSplit("validation", normalized.validation, normalized)
  ];
  validateDistillationDataset(records);
  return records;
}

export function syntheticRetentionManifest(records = generateSyntheticDistillationRetention()) {
  const families = new Set(records.map((record) => record.family_id));
  return {
    schema: "amos.synthetic-distillation-retention-manifest",
    version: 1,
    generator: "src/research/syntheticDistillationRetention.js",
    seed: records[0]?.provenance.synthetic_world_id?.split(":").at(-1) || DEFAULT_SEED,
    ...datasetIdentity(records),
    family_count: families.size,
    variants_per_family: familyVariantCounts(records),
    tool_trajectories: records.filter((record) => record.input.tools?.length > 0).length,
    executable_trajectories: records.filter((record) =>
      record.verification.methods.some((method) => method.type === "executable")
    ).length,
    workflows: countBy(records, (record) => record.task.workflow),
    skill_groups: countBy(records, (record) => record.task.skill_group),
    splits: Object.fromEntries(["train", "validation"].map((split) => {
      const selected = records.filter((record) => record.split === split);
      return [split, {
        trajectories: selected.length,
        families: new Set(selected.map((record) => record.family_id)).size,
        skill_groups: countBy(selected, (record) => record.task.skill_group)
      }];
    }))
  };
}

function normalizeOptions(options) {
  const normalized = {
    train: options.train ?? 2000,
    validation: options.validation ?? 400,
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
      variantIndex,
      scenario,
      seed: options.seed,
      workflow,
      familyId: `retention-${split}-${workflow}-${pad(familyIndex + 1, 5)}`,
      id: `retention-${split}-${workflow}-${pad(familyIndex + 1, 5)}-v${variantIndex + 1}`
    };
    return workflowGenerator(workflow)(context);
  });
}

function workflowGenerator(workflow) {
  return {
    correlated_bayes: correlatedBayesRecord,
    causal_collider: causalColliderRecord,
    simpson_stratification: simpsonRecord,
    deadline_optimization: deadlineRecord,
    fencing_epoch: fencingRecord,
    multi_step_recovery: recoveryRecord,
    idempotent_receipt: idempotentReceiptRecord,
    authority_conflict: authorityConflictRecord,
    dependency_code: dependencyCodeRecord,
    ledger_code: ledgerCodeRecord,
    critical_path_code: criticalPathCodeRecord,
    exact_receipt_grounding: exactReceiptRecord,
    digit_budget_grounding: digitBudgetRecord
  }[workflow];
}

function correlatedBayesRecord(context) {
  const prevalence = 1 + bounded(context.scenario, 5);
  const sensitivity = 72 + bounded(context.scenario >>> 3, 22);
  const sharedFault = 2 + bounded(context.scenario >>> 8, 7);
  const falsePositive = 1 + bounded(context.scenario >>> 13, 4);
  const p = prevalence / 100;
  const s = sensitivity / 100;
  const shared = sharedFault / 100;
  const fp = falsePositive / 100;
  const positiveGivenAbsent = shared + (1 - shared) * fp * fp;
  const posterior = (p * s * s) / (p * s * s + (1 - p) * positiveGivenAbsent);
  const posteriorPercent = Number((posterior * 100).toFixed(1));
  const prompts = [
    `A fault has ${prevalence}% prevalence. With the fault, two detectors are independent and each fires ${sensitivity}% of the time. Without it, a shared disturbance occurs ${sharedFault}% of the time and fires both; otherwise each independently false-alarms ${falsePositive}%. Both fire. Compute the posterior.`,
    `Use Bayes' rule with correlated false alarms: prevalence=${prevalence}%, sensitivity=${sensitivity}% per detector, shared both-positive event=${sharedFault}% when absent, otherwise independent false positives=${falsePositive}% each. Both are positive.`
  ];
  return directRecord(context, {
    route: "balanced_non_deep",
    risk: "low",
    state: { prevalence, sensitivity, shared_fault: sharedFault, false_positive: falsePositive },
    user: variant(prompts, context.variantIndex),
    answer: `The posterior is ${posteriorPercent}%. The absent-case likelihood includes the shared disturbance (${sharedFault}%), so treating the false alarms as fully independent would overstate the evidence.`,
    verifier: "generated-correlated-bayes-v2",
    contracts: ["bayes-with-correlated-evidence", "deterministic-arithmetic"]
  });
}

function causalColliderRecord(context) {
  const pairs = [
    ["technical depth", "market access", "funding"],
    ["writing skill", "domain reputation", "publication"],
    ["product quality", "distribution", "adoption"],
    ["experience", "referrals", "hiring"]
  ];
  const [left, right, selection] = pairs[bounded(context.scenario, pairs.length)];
  const conditionOnDescendant = bounded(context.scenario >>> 5, 2) === 1;
  const observed = conditionOnDescendant ? `a downstream status produced by ${selection}` : selection;
  const prompts = [
    `${left} and ${right} are independent, and either increases ${selection}. An analysis conditions on ${observed}. What happens to their association?`,
    `Graph: ${left} → ${selection} ← ${right}. The dataset filters on ${observed}. Explain the induced relationship between the two causes.`
  ];
  return directRecord(context, {
    route: "balanced_non_deep",
    risk: "low",
    state: { independent_causes: [left, right], collider: selection, conditioned_on: observed },
    user: variant(prompts, context.variantIndex),
    answer: `Conditioning on ${observed} opens the collider path through ${selection} and can induce a negative association between otherwise independent ${left} and ${right}.`,
    verifier: "generated-collider-reasoning-v2",
    contracts: ["causal-graph-reasoning"]
  });
}

function simpsonRecord(context) {
  const easyA = [85, 90, 95][bounded(context.scenario, 3)];
  const easyB = easyA - 10;
  const hardA = [30, 35, 40][bounded(context.scenario >>> 5, 3)];
  const hardB = hardA - 10;
  const easyASuccess = easyA / 5;
  const hardBSuccess = hardB / 5;
  const aggregateA = (easyASuccess + hardA * 2) / 220;
  const aggregateB = (easyB * 2 + hardBSuccess) / 220;
  if (!(aggregateA < aggregateB)) throw new Error("Generated Simpson case lacks aggregate reversal");
  const prompts = [
    `Segment easy: A=${easyASuccess}/20, B=${easyB * 2}/200. Segment hard: A=${hardA * 2}/200, B=${hardBSuccess}/20. Segment is measured before assignment. Which treatment is better within segments, and why can the aggregate reverse?`,
    `Compare A and B after stratifying: easy rates are ${easyA}% vs ${easyB}%; hard rates are ${hardA}% vs ${hardB}%. A receives mostly hard cases and B mostly easy cases. Interpret the aggregate safely.`
  ];
  return directRecord(context, {
    route: "balanced_non_deep",
    risk: "medium",
    state: { easy: { a: easyA, b: easyB }, hard: { a: hardA, b: hardB }, aggregate_reversal: true },
    user: variant(prompts, context.variantIndex),
    answer: `A is higher in both strata (${easyA}% vs ${easyB}% easy; ${hardA}% vs ${hardB}% hard). Its lower aggregate is a Simpson reversal caused by the difficulty mix, so the aggregate alone does not show B is better.`,
    verifier: "generated-simpson-stratification-v2",
    contracts: ["stratified-comparison", "no-aggregate-causal-error"]
  });
}

function deadlineRecord(context) {
  const jobs = Array.from({ length: 4 }, (_, index) => ({
    id: String.fromCharCode(65 + index),
    release: bounded(context.scenario >>> (index * 3), 3),
    duration: 1 + bounded(context.scenario >>> (index * 4 + 2), 3),
    deadline: 3 + index + bounded(context.scenario >>> (index * 5 + 1), 3),
    value: 4 + bounded(context.scenario >>> (index * 6 + 3), 12)
  }));
  const best = bestDeadlineSchedule(jobs);
  const promptJobs = jobs.map((job) =>
    `${job.id}(release ${job.release}, duration ${job.duration}, deadline ${job.deadline}, value ${job.value})`
  ).join(", ");
  const prompts = [
    `One worker starts at time 0 and runs selected jobs non-preemptively: ${promptJobs}. Maximize total value; break ties by earlier finish then lexicographic job sequence.`,
    `Find the optimal feasible single-worker schedule under releases and deadlines for ${promptJobs}. Use value, then completion time, then lexicographic order as tie breaks.`
  ];
  return directRecord(context, {
    route: "balanced_non_deep",
    risk: "low",
    state: { jobs, tie_break: ["value", "completion", "lexicographic"] },
    user: variant(prompts, context.variantIndex),
    answer: best.ids.length > 0
      ? `Schedule ${best.ids.join(" → ")}. It is deadline-feasible, finishes at ${best.finish}, and has maximum value ${best.value}.`
      : "Select no jobs; every nonempty schedule violates a release or deadline constraint.",
    verifier: "generated-deadline-enumeration-v2",
    contracts: ["deadline-feasibility", "bounded-optimization"]
  });
}

function fencingRecord(context) {
  const staleEpoch = 100 + bounded(context.scenario, 8000);
  const currentEpoch = staleEpoch + 1 + bounded(context.scenario >>> 7, 4);
  const resources = ["object store", "ledger", "queue checkpoint", "job registry"];
  const resource = resources[bounded(context.scenario >>> 12, resources.length)];
  const prompts = [
    `Worker old holds epoch ${staleEpoch}. After its lease expires, worker current commits with epoch ${currentEpoch} and advances the ${resource} floor. The old worker writes later. Which write controls?`,
    `A ${resource} rejects epochs below ${currentEpoch}. It accepted the current worker at ${currentEpoch}; a delayed request arrives at ${staleEpoch}. Explain the final state.`
  ];
  return directRecord(context, {
    route: "balanced_non_deep",
    risk: "medium",
    state: { resource, stale_epoch: staleEpoch, fencing_floor: currentEpoch },
    user: variant(prompts, context.variantIndex),
    answer: `The current worker's write remains. Epoch ${staleEpoch} is below the ${currentEpoch} fencing floor and is rejected even if it arrives later.`,
    verifier: "generated-fencing-transfer-v2",
    contracts: ["fencing-token-order"]
  });
}

function recoveryRecord(context) {
  const campaign = `campaign-${1000 + bounded(context.scenario, 8000)}`;
  const campaignId = `cmp_${10000 + bounded(context.scenario >>> 3, 80000)}`;
  const oldPage = `page_${10000 + bounded(context.scenario >>> 7, 80000)}`;
  const nextPageNumber = 10000 + bounded(context.scenario >>> 11, 80000);
  const currentPage = `page_${nextPageNumber === Number(oldPage.slice(5)) ? nextPageNumber + 1 : nextPageNumber}`;
  const impressions = 2000 + bounded(context.scenario >>> 4, 70000);
  const visits = Math.max(10, Math.floor(impressions * (20 + bounded(context.scenario >>> 9, 31)) / 100));
  const signups = Math.max(1, Math.floor(visits * (5 + bounded(context.scenario >>> 14, 26)) / 100));
  const firstLoss = impressions - visits;
  const secondLoss = visits - signups;
  const largest = firstLoss >= secondLoss ? "impressions-to-visits" : "visits-to-signups";
  const largestLoss = Math.max(firstLoss, secondLoss);
  const prompts = [
    `Inspect ${campaign}. Recover from any stale page reference, then report campaign ID, current page ID, every funnel count, and the largest absolute stage loss.`,
    `Use authoritative recovery for ${campaign}; do not reuse a stale dependent ID. Finish with a complete funnel receipt and largest count drop.`
  ];
  return toolRecord(context, {
    route: "routine",
    risk: "medium",
    state: { campaign, campaign_id: campaignId, stale_page_id: oldPage, current_page_id: currentPage },
    user: variant(prompts, context.variantIndex),
    tools: [
      toolDefinition("read_campaign", "Read a campaign by name.", { name: stringSchema() }, ["name"]),
      toolDefinition("read_funnel", "Read funnel counts for a page reference.", { page_id: stringSchema() }, ["page_id"]),
      toolDefinition("refresh_campaign", "Refresh a campaign after a stale reference.", { campaign_id: stringSchema() }, ["campaign_id"])
    ],
    target: [
      assistantToolCall("campaign-read", "read_campaign", { name: campaign }),
      toolResult("campaign-read", { campaign_id: campaignId, page_id: oldPage, revision: 6 }),
      assistantToolCall("funnel-old", "read_funnel", { page_id: oldPage }),
      toolResult("funnel-old", { ok: false, error: "stale_reference", current_revision: 7 }),
      assistantToolCall("campaign-refresh", "refresh_campaign", { campaign_id: campaignId }),
      toolResult("campaign-refresh", { campaign_id: campaignId, page_id: currentPage, revision: 7 }),
      assistantToolCall("funnel-current", "read_funnel", { page_id: currentPage }),
      toolResult("funnel-current", { impressions, visits, signups }),
      { role: "assistant", content: `${campaignId} now uses ${currentPage}. Funnel: ${impressions} impressions, ${visits} visits, ${signups} signups. The largest absolute loss is ${largest}, a drop of ${largestLoss}.` }
    ],
    verifier: "generated-multi-step-recovery-v2",
    contracts: ["fresh-reference", "exact-tool-order", "complete-final-receipt"]
  });
}

function idempotentReceiptRecord(context) {
  const requestName = `request-${1000 + bounded(context.scenario, 8000)}`;
  const amount = 1000 + bounded(context.scenario >>> 4, 90000);
  const key = `${requestName}-${amount}-v1`;
  const proposalId = `P-${10000 + bounded(context.scenario >>> 9, 80000)}`;
  const revision = `policy-${20 + bounded(context.scenario >>> 14, 70)}`;
  const prompts = [
    `Read current policy, then propose ${requestName} for ${amount} exactly once using ${key}. Do not execute or retry. Report the complete receipt.`,
    `Create one governed proposal for ${requestName}, amount ${amount}, idempotency key ${key}, after checking current policy. Preserve every receipt field and do not claim execution.`
  ];
  return toolRecord(context, {
    route: "routine",
    risk: "high",
    state: { request_name: requestName, amount, idempotency_key: key },
    user: variant(prompts, context.variantIndex),
    tools: [
      toolDefinition("read_action_policy", "Read the authenticated action policy.", {}, []),
      toolDefinition("propose_action", "Create one idempotent proposal without execution.", {
        name: stringSchema(), amount: integerSchema(), idempotency_key: stringSchema()
      }, ["name", "amount", "idempotency_key"])
    ],
    target: [
      assistantToolCall("policy-read", "read_action_policy", {}),
      toolResult("policy-read", { revision, approval_required: true }),
      assistantToolCall("action-propose", "propose_action", { name: requestName, amount, idempotency_key: key }),
      toolResult("action-propose", { proposal_id: proposalId, name: requestName, amount, status: "pending_approval", executed: false, policy_revision: revision, idempotency_key: key }),
      { role: "assistant", content: `${proposalId} for ${requestName}, amount ${amount}, is pending approval under ${revision}. It has not executed. Idempotency key: ${key}.` }
    ],
    verifier: "generated-idempotent-complete-receipt-v2",
    contracts: ["exactly-once-submit", "no-false-execution", "complete-final-receipt"]
  });
}

function authorityConflictRecord(context) {
  const objectId = `authority-${1000 + bounded(context.scenario, 8000)}`;
  const conflicts = [
    "two equally current signed receipts disagree on executed state",
    "the newest policy signature fails verification",
    "the action receipt names a policy revision that cannot be retrieved",
    "two authenticated current records name different required approvers"
  ];
  const conflict = conflicts[bounded(context.scenario >>> 4, conflicts.length)];
  const prompts = [
    `Resolve ${objectId}: ${conflict}. State the safe operational outcome.`,
    `${objectId} has unresolved authoritative evidence because ${conflict}. Decide whether to act or report completion.`
  ];
  return baseRecord(context, {
    route: "deep",
    risk: "high",
    state: { object_id: objectId, conflict },
    user: variant(prompts, context.variantIndex),
    target: [{ role: "assistant", content: `I cannot safely determine ${objectId}'s authoritative state. I am escalating the conflict; no action was taken and no execution is claimed.` }],
    outcome: "escalate",
    escalation: { target: "frontier", reason_code: "unresolved_authority_conflict" },
    verifier: "generated-authority-conflict-v2",
    contracts: ["required-escalation", "no-false-execution"]
  });
}

function dependencyCodeRecord(context) {
  const functionNames = ["chooseWork", "selectLaunches", "planInitiatives", "pickTasks"];
  const functionName = functionNames[bounded(context.scenario, functionNames.length)];
  const code = `function ${functionName}(tasks, capacity) {\n  let best = { score: -1, cost: Infinity, ids: [] };\n  for (let mask = 0; mask < 2 ** tasks.length; mask += 1) {\n    const chosen = tasks.filter((_, i) => mask & (1 << i));\n    const ids = chosen.map(x => x.id).sort();\n    const set = new Set(ids);\n    const cost = chosen.reduce((n, x) => n + x.cost, 0);\n    const lanes = chosen.map(x => x.lane).filter(x => x != null);\n    if (cost > capacity || new Set(lanes).size !== lanes.length) continue;\n    if (!chosen.every(x => (x.dependsOn || []).every(id => set.has(id)))) continue;\n    const score = chosen.reduce((n, x) => n + x.score, 0);\n    const key = JSON.stringify(ids);\n    const bestKey = JSON.stringify(best.ids);\n    if (score > best.score || (score === best.score && cost < best.cost) ||\n        (score === best.score && cost === best.cost && key < bestKey)) best = { score, cost, ids };\n  }\n  return best.ids;\n}`;
  const specification = { code, functionName, cases: [
    {
      args: [[
        { id: "base", cost: 1, score: 1, lane: null, dependsOn: [] },
        { id: "a", cost: 2, score: 7, lane: "x", dependsOn: ["base"] },
        { id: "b", cost: 3, score: 6, lane: "x", dependsOn: [] },
        { id: "c", cost: 1, score: 4, lane: null, dependsOn: ["a"] }
      ], 4],
      expected: ["a", "base", "c"]
    },
    {
      args: [[
        { id: "a", cost: 2, score: 5, lane: null, dependsOn: [] },
        { id: "b", cost: 2, score: 5, lane: null, dependsOn: [] },
        { id: "c", cost: 4, score: 10, lane: null, dependsOn: [] }
      ], 4],
      expected: ["a", "b"]
    },
    {
      args: [[
        { id: "bad", cost: 1, score: 20, lane: "x", dependsOn: ["missing"] },
        { id: "safe", cost: 1, score: 4, lane: "x", dependsOn: [] },
        { id: "other", cost: 1, score: 4, lane: "y", dependsOn: [] }
      ], 2],
      expected: ["other", "safe"]
    }
  ] };
  verifyGeneratedCode(specification);
  const prompts = [
    `Write JavaScript ${functionName}(tasks, capacity). Tasks have id, cost, score, lane, dependsOn. Enforce capacity, all dependencies, and at most one non-null lane. Maximize score, then minimize cost, then lexicographically smallest sorted IDs. At most 18 tasks; do not mutate inputs. Return only the function.`,
    `Repair a dependency-aware batch selector by implementing ${functionName}(tasks, capacity): exhaustive optimum for <=18 tasks, required IDs selected, unique non-null lanes, score/cost/lexicographic tie breaks, sorted IDs, immutable inputs. Return only JavaScript.`
  ];
  return codeRecord(context, specification, variant(prompts, context.variantIndex), "generated-dependency-selector-v2");
}

function ledgerCodeRecord(context) {
  const functionNames = ["mergeLedger", "applyVersionedEntries", "reconcileLedger", "foldEntryStream"];
  const functionName = functionNames[bounded(context.scenario, functionNames.length)];
  const code = `function ${functionName}(entries, initial) {\n  const out = JSON.parse(JSON.stringify(initial));\n  const unique = new Map();\n  for (const entry of entries) if (!unique.has(entry.entryId)) unique.set(entry.entryId, entry);\n  const ledgers = new Set([...Object.keys(out), ...[...unique.values()].map(x => x.ledgerId)]);\n  for (const id of ledgers) {\n    if (!out[id]) out[id] = { total: 0, version: 0 };\n    const versions = new Map();\n    for (const entry of unique.values()) {\n      if (entry.ledgerId !== id || entry.version <= out[id].version) continue;\n      const group = versions.get(entry.version) || [];\n      group.push(entry);\n      versions.set(entry.version, group);\n    }\n    while (true) {\n      const group = versions.get(out[id].version + 1);\n      if (!group || group.length !== 1) break;\n      out[id].total += group[0].amount;\n      out[id].version += 1;\n    }\n  }\n  return out;\n}`;
  const specification = { code, functionName, cases: [
    {
      args: [[
        { entryId: "e2", ledgerId: "a", version: 2, amount: 5 },
        { entryId: "e1", ledgerId: "a", version: 1, amount: 3 },
        { entryId: "e1", ledgerId: "a", version: 1, amount: 3 }
      ], {}],
      expected: { a: { total: 8, version: 2 } }
    },
    {
      args: [[
        { entryId: "a2", ledgerId: "a", version: 2, amount: 9 },
        { entryId: "b1", ledgerId: "b", version: 1, amount: 4 }
      ], {}],
      expected: { a: { total: 0, version: 0 }, b: { total: 4, version: 1 } }
    },
    {
      args: [[
        { entryId: "left", ledgerId: "a", version: 1, amount: 3 },
        { entryId: "right", ledgerId: "a", version: 1, amount: 8 },
        { entryId: "later", ledgerId: "a", version: 2, amount: 5 }
      ], { a: { total: 2, version: 0 } }],
      expected: { a: { total: 2, version: 0 } }
    }
  ] };
  verifyGeneratedCode(specification);
  const prompts = [
    `Write JavaScript ${functionName}(entries, initial). Deduplicate entryId, group by ledgerId, and apply exactly contiguous unique versions from current+1. A gap or conflicting distinct IDs at the next version stops that ledger. New ledgers start {total:0,version:0}. Do not mutate. Return only the function.`,
    `Implement ${functionName} for unordered versioned ledger entries. Preserve input, deduplicate repeated IDs, reject ambiguity at the next version, stop on gaps, and support unseen ledgers from version 0. Return only JavaScript.`
  ];
  return codeRecord(context, specification, variant(prompts, context.variantIndex), "generated-ledger-reconciliation-v2");
}

function criticalPathCodeRecord(context) {
  const functionNames = ["findCriticalPath", "longestDependencyPath", "buildCriticalChain", "criticalWorkPath"];
  const functionName = functionNames[bounded(context.scenario, functionNames.length)];
  const code = `function ${functionName}(tasks) {\n  if (tasks.length === 0) return { duration: 0, path: [] };\n  const byId = new Map(tasks.map(x => [x.id, x]));\n  const memo = new Map();\n  const active = new Set();\n  function visit(id) {\n    if (!byId.has(id)) throw new Error("missing dependency");\n    if (active.has(id)) throw new Error("cycle");\n    if (memo.has(id)) return memo.get(id);\n    active.add(id);\n    let prefix = { duration: 0, path: [] };\n    for (const dep of byId.get(id).dependsOn || []) {\n      const candidate = visit(dep);\n      if (candidate.duration > prefix.duration ||\n+          (candidate.duration === prefix.duration && JSON.stringify(candidate.path) < JSON.stringify(prefix.path))) prefix = candidate;\n    }\n    active.delete(id);\n    const result = { duration: prefix.duration + byId.get(id).duration, path: [...prefix.path, id] };\n    memo.set(id, result);\n    return result;\n  }\n  let best = null;\n  for (const task of tasks) {\n    const candidate = visit(task.id);\n    if (!best || candidate.duration > best.duration ||\n        (candidate.duration === best.duration && JSON.stringify(candidate.path) < JSON.stringify(best.path))) best = candidate;\n  }\n  return best;\n}`;
  const specification = { code, functionName, cases: [
    {
      args: [[
        { id: "a", duration: 2, dependsOn: [] },
        { id: "b", duration: 4, dependsOn: ["a"] },
        { id: "c", duration: 3, dependsOn: [] },
        { id: "d", duration: 1, dependsOn: ["b", "c"] }
      ]],
      expected: { duration: 7, path: ["a", "b", "d"] }
    },
    {
      args: [[
        { id: "a", duration: 2, dependsOn: [] },
        { id: "b", duration: 3, dependsOn: ["a"] },
        { id: "c", duration: 2, dependsOn: [] },
        { id: "d", duration: 3, dependsOn: ["c"] }
      ]],
      expected: { duration: 5, path: ["a", "b"] }
    },
    { args: [[]], expected: { duration: 0, path: [] } },
    { args: [[{ id: "a", duration: 1, dependsOn: ["missing"] }]], throws: true },
    { args: [[
      { id: "a", duration: 1, dependsOn: ["b"] },
      { id: "b", duration: 1, dependsOn: ["a"] }
    ]], throws: true }
  ] };
  verifyGeneratedCode(specification);
  const prompts = [
    `Write ${functionName}(tasks) in JavaScript for a dependency DAG. Return the maximum-duration direct dependency path as {duration,path}; lexicographically smallest path wins ties. Empty returns zero/empty. Throw on cycles or missing dependencies and do not mutate. Return only the function.`,
    `Implement immutable DAG critical-path function ${functionName}. Tasks have id, duration, dependsOn. Memoize longest paths, detect invalid graphs, and use lexical path tie-breaking. Return only JavaScript.`
  ];
  return codeRecord(context, specification, variant(prompts, context.variantIndex), "generated-critical-path-v2");
}

function exactReceiptRecord(context) {
  const actionId = `ACT-${100000 + bounded(context.scenario, 800000)}`;
  const amount = 10000 + bounded(context.scenario >>> 4, 900000);
  const revision = 100 + bounded(context.scenario >>> 9, 800);
  const receiptId = `RCT-${100000 + bounded(context.scenario >>> 14, 800000)}`;
  const prompts = [
    `Read and report the authoritative receipt for ${actionId}. Preserve its identifiers, amount, revision, status, and execution state exactly.`,
    `Use the receipt tool for ${actionId}. Return a complete grounded summary; do not round or shorten numeric fields.`
  ];
  return toolRecord(context, {
    route: "routine",
    risk: "medium",
    state: { action_id: actionId },
    user: variant(prompts, context.variantIndex),
    tools: [toolDefinition("read_action_receipt", "Read an authenticated action receipt.", { action_id: stringSchema() }, ["action_id"])],
    target: [
      assistantToolCall("receipt-read", "read_action_receipt", { action_id: actionId }),
      toolResult("receipt-read", { receipt_id: receiptId, action_id: actionId, amount, revision, status: "completed", executed: true }),
      { role: "assistant", content: `Receipt ${receiptId}: action ${actionId}, amount ${amount}, revision ${revision}, status completed, executed=true.` }
    ],
    verifier: "generated-exact-receipt-copy-v2",
    contracts: ["exact-value-copy", "complete-final-receipt"]
  });
}

function digitBudgetRecord(context) {
  const workspace = `workspace-${100 + bounded(context.scenario, 800)}`;
  const budget = 50000 + bounded(context.scenario >>> 3, 900000);
  const committed = 10000 + bounded(context.scenario >>> 8, Math.max(1, budget - 20000));
  const remainingBefore = budget - committed;
  const proposed = 1000 + bounded(context.scenario >>> 13, Math.max(1, remainingBefore + 20000));
  const remainingAfter = remainingBefore - proposed;
  const fits = remainingAfter >= 0;
  const prompts = [
    `Read ${workspace}'s budget and evaluate proposed spend ${proposed}. Use the calculator and report budget, committed, proposed, remaining before, remaining after, and fit without changing digits.`,
    `For ${workspace}, preserve exact multi-digit values while checking proposal ${proposed} against the authenticated budget.`
  ];
  return toolRecord(context, {
    route: "routine",
    risk: "low",
    state: { workspace, proposed },
    user: variant(prompts, context.variantIndex),
    tools: [
      toolDefinition("read_workspace_budget", "Read the authenticated workspace budget.", { workspace: stringSchema() }, ["workspace"]),
      toolDefinition("calculate_budget_effect", "Calculate a proposed spend's budget effect.", {
        budget: integerSchema(), committed: integerSchema(), proposed: integerSchema()
      }, ["budget", "committed", "proposed"])
    ],
    target: [
      assistantToolCall("budget-read", "read_workspace_budget", { workspace }),
      toolResult("budget-read", { workspace, budget, committed, revision: 5 }),
      assistantToolCall("budget-calculate", "calculate_budget_effect", { budget, committed, proposed }),
      toolResult("budget-calculate", { remaining_before: remainingBefore, remaining_after: remainingAfter, fits }),
      { role: "assistant", content: `Budget ${budget}; committed ${committed}; proposed ${proposed}; remaining before ${remainingBefore}; remaining after ${remainingAfter}; fits=${fits}.` }
    ],
    verifier: "generated-digit-grounded-budget-v2",
    contracts: ["exact-value-copy", "result-grounded-arithmetic", "complete-final-receipt"]
  });
}

function bestDeadlineSchedule(jobs) {
  let best = { value: 0, finish: 0, ids: [] };
  for (const sequence of permutations(jobs)) {
    let time = 0;
    let value = 0;
    let valid = true;
    for (const job of sequence) {
      time = Math.max(time, job.release) + job.duration;
      if (time > job.deadline) {
        valid = false;
        break;
      }
      value += job.value;
    }
    if (!valid) continue;
    const ids = sequence.map((job) => job.id);
    if (value > best.value || (value === best.value && time < best.finish) ||
        (value === best.value && time === best.finish && ids.join("") < best.ids.join(""))) {
      best = { value, finish: time, ids };
    }
  }
  return best;
}

function permutations(values) {
  const output = [[]];
  for (let size = 1; size <= values.length; size += 1) choose([], new Set(), size, values, output);
  return output;
}

function choose(prefix, used, size, values, output) {
  if (prefix.length === size) {
    output.push(prefix);
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    if (used.has(index)) continue;
    used.add(index);
    choose([...prefix, values[index]], used, size, values, output);
    used.delete(index);
  }
}

function verifyGeneratedCode(specification) {
  const callable = runInNewContext(`${specification.code}\n${specification.functionName}`, Object.create(null), { timeout: 100 });
  for (const [index, testCase] of specification.cases.entries()) {
    const args = structuredClone(testCase.args);
    const before = JSON.stringify(args);
    let actual;
    let thrown = false;
    try {
      actual = callable(...args);
    } catch {
      thrown = true;
    }
    if (testCase.throws === true) {
      if (!thrown || JSON.stringify(args) !== before) {
        throw new Error(`${specification.functionName} failed generated error case ${index + 1}`);
      }
      continue;
    }
    if (thrown) throw new Error(`${specification.functionName} threw in generated case ${index + 1}`);
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected) || JSON.stringify(args) !== before) {
      throw new Error(`${specification.functionName} failed generated case ${index + 1}`);
    }
  }
}

function codeRecord(context, specification, user, verifier) {
  return baseRecord(context, {
    route: "balanced_non_deep",
    risk: "low",
    state: { language: "javascript", function_name: specification.functionName },
    user,
    target: [{ role: "assistant", content: `\`\`\`javascript\n${specification.code}\n\`\`\`` }],
    outcome: "local_answer",
    verificationType: "executable",
    verifier,
    contracts: ["executable-code", "deterministic-output", "input-immutability"]
  });
}

function directRecord(context, options) {
  return baseRecord(context, { ...options, target: [{ role: "assistant", content: options.answer }], outcome: "local_answer" });
}

function toolRecord(context, options) {
  const record = baseRecord(context, { ...options, outcome: "local_answer" });
  record.input.tools = options.tools;
  return record;
}

function baseRecord(context, options) {
  const estimatedTokens = Math.max(1, Math.ceil(JSON.stringify(options.target).length / 4));
  return {
    schema: "amos.distillation-trajectory",
    version: 1,
    id: context.id,
    family_id: context.familyId,
    split: context.split,
    provenance: { source_type: "synthetic", contains_customer_data: false, synthetic_world_id: `amos-retention:${context.seed}`, teacher_models: [] },
    task: { route: options.route || "routine", workflow: context.workflow, skill_group: SKILL_GROUPS[context.workflow], risk: options.risk, state: options.state },
    input: { messages: [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }, { role: "user", content: options.user }] },
    target: { outcome: options.outcome, ...(options.escalation ? { escalation: options.escalation } : {}), messages: options.target },
    verification: {
      status: "passed",
      methods: [{ type: options.verificationType || "deterministic", id: options.verifier }],
      critical_contracts: options.contracts.map((id) => ({ id, passed: true }))
    },
    efficiency: { target_output_tokens: estimatedTokens, max_target_output_tokens: Math.max(estimatedTokens, 512) }
  };
}

function toolDefinition(name, description, properties, required) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}

function assistantToolCall(id, name, argumentsValue) {
  return { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(argumentsValue) } }] };
}

function toolResult(toolCallId, value) {
  return { role: "tool", tool_call_id: toolCallId, content: JSON.stringify(value) };
}

function stringSchema() { return { type: "string" }; }
function integerSchema() { return { type: "integer" }; }

function stableNumber(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function bounded(value, size) { return size <= 1 ? 0 : (value >>> 0) % size; }
function variant(values, index) { return values[index % values.length]; }
function pad(value, width) { return String(value).padStart(width, "0"); }

function familyVariantCounts(records) {
  const counts = new Map();
  for (const record of records) counts.set(record.family_id, (counts.get(record.family_id) || 0) + 1);
  return countBy([...counts.values()], (count) => String(count));
}

function countBy(values, selector) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    const key = selector(value);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));
}
