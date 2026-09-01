import { digestResearchValue } from "./experimentProtocol.js";

export const SWARM_FAILURE_CAPSULE_SCHEMA = "amos.swarm-failure-capsule";
export const SWARM_FAILURE_CAPSULE_VERSION = 1;

/**
 * Compile bounded, evidence-backed negative experience for the organism.
 *
 * Raw prompts, reasoning, tool arguments, and tool results are deliberately
 * excluded. The capsule contains only host-observed state, deterministic
 * checks, and receipts that another specialist can safely act on.
 */
export function createSwarmFailureCapsule({
  task,
  result,
  ecology = null,
  selfCheck = null,
  verifierFeedback = null,
  candidateStatus = null,
  artifactReferences = [],
  candidateEvolution = null,
  repairableCandidate = null,
  sourceRunId = null
}) {
  const assignments = Array.isArray(ecology?.assignments) ? ecology.assignments : [];
  const verifierEvidence = normalizeVerifierEvidence(verifierFeedback, result);
  const failedChecks = mergeFailedChecks(
    extractFailedChecks(selfCheck),
    verifierEvidence.failedCheckDetails
  );
  const terminalAssignments = assignments.filter(({ status }) => status !== "completed");
  const repairSignals = deriveRepairSignals({
    result,
    failedChecks,
    terminalAssignments,
    candidateStatus
  });
  const holographicWorld = summarizeHolographicWorld(
    ecology?.dualChannelWorld ?? ecology?.dualChannelShadow
  );
  const normalizedTask = normalizeTask(task);
  const capsule = {
    schema: SWARM_FAILURE_CAPSULE_SCHEMA,
    version: SWARM_FAILURE_CAPSULE_VERSION,
    task: normalizedTask,
    execution: normalizeExecution(result, sourceRunId),
    provenance: normalizeProvenance(result, ecology),
    failure: normalizeFailure(result),
    finalState: {
      ecologyStatus: boundedId(ecology?.status || "unknown"),
      cycle: boundedInteger(ecology?.cycle, 0, 1_000_000, 0),
      assignmentCount: assignments.length,
      incompleteAssignments: terminalAssignments.slice(-32).map((assignment) => ({
        cycle: boundedInteger(assignment?.cycle, 0, 1_000_000, 0),
        role: boundedId(assignment?.role || "unknown"),
        agentId: boundedId(assignment?.agentId || "unknown"),
        status: boundedId(assignment?.status || "unknown"),
        progressArtifactCount: Array.isArray(assignment?.progressArtifacts)
          ? assignment.progressArtifacts.length
          : 0,
        verifiedReceiptCount: Array.isArray(assignment?.verifiedProgressReceipts)
          ? assignment.verifiedProgressReceipts.length
          : 0
      }))
    },
    candidate: normalizeCandidateStatus(candidateStatus),
    candidateLineage: normalizeCandidateLineage(candidateEvolution, repairableCandidate),
    verifierEvidence,
    failedChecks,
    repairSignals,
    artifactEvidence: artifactReferences.slice(0, 256).map((reference) => ({
      ref: boundedText(reference?.ref || "unknown", 4_000),
      kind: boundedId(reference?.kind || "artifact"),
      status: boundedId(reference?.status || "unknown"),
      digest: /^[a-f0-9]{64}$/.test(String(reference?.digest || ""))
        ? String(reference.digest)
        : null
    })),
    holographicWorld,
    safeguards: {
      rawMessagesStored: false,
      rawReasoningStored: false,
      rawToolArgumentsStored: false,
      rawToolResultsStored: false,
      authorityGrantedByHrr: false,
      repairReuseOnly: true,
      exactTaskMatchRequired: true,
      freshVerificationRequired: true,
      grantsCompletionCredit: false
    }
  };
  return { ...capsule, digest: digestResearchValue(capsule) };
}

export function validateSwarmFailureCapsule(input) {
  if (input?.schema !== SWARM_FAILURE_CAPSULE_SCHEMA) {
    throw new Error(`failure capsule schema must be ${SWARM_FAILURE_CAPSULE_SCHEMA}`);
  }
  if (input?.version !== SWARM_FAILURE_CAPSULE_VERSION) {
    throw new Error(`failure capsule version must be ${SWARM_FAILURE_CAPSULE_VERSION}`);
  }
  const { digest, ...unsigned } = structuredClone(input);
  if (digest !== digestResearchValue(unsigned)) {
    throw new Error("Failure capsule digest does not match its contents");
  }
  if (input.safeguards?.authorityGrantedByHrr !== false) {
    throw new Error("Failure capsules may not grant authority through HRR state");
  }
  if (
    input.safeguards?.repairReuseOnly !== true
    || input.safeguards?.exactTaskMatchRequired !== true
    || input.safeguards?.freshVerificationRequired !== true
    || input.safeguards?.grantsCompletionCredit !== false
  ) {
    throw new Error("Failure capsules must remain non-authoritative repair memory");
  }
  if (
    input.verifierEvidence
    && (
      input.verifierEvidence.authority?.hostObservedOnly !== true
      || input.verifierEvidence.authority?.grantsCompletionCredit !== false
      || input.verifierEvidence.authority?.bypassesVerifier !== false
    )
  ) {
    throw new Error("Failure capsule verifier feedback must remain host-observed and non-authoritative");
  }
  if (!/^[a-f0-9]{64}$/.test(String(input.task?.signature || ""))) {
    throw new Error("Failure capsule task signature is invalid");
  }
  const expectedTask = normalizeTask(input.task);
  if (expectedTask.signature !== input.task.signature) {
    throw new Error("Failure capsule task signature does not match its identity");
  }
  return structuredClone(input);
}

function normalizeTask(input) {
  const identity = {
    source: boundedText(input?.source || "unknown", 500),
    name: boundedText(input?.name || "unknown", 500),
    ref: input?.ref ? boundedText(input.ref, 1_000) : null,
    checksum: /^[a-f0-9]{64}$/.test(String(input?.checksum || ""))
      ? String(input.checksum)
      : null,
    instructionDigest: /^[a-f0-9]{64}$/.test(String(input?.instructionDigest || ""))
      ? String(input.instructionDigest)
      : null
  };
  return { ...identity, signature: digestResearchValue(identity) };
}

function normalizeExecution(result, sourceRunId) {
  const startedAt = boundedDate(result?.started_at);
  const finishedAt = boundedDate(result?.finished_at || result?.updated_at);
  const elapsedMilliseconds = startedAt && finishedAt
    ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
    : null;
  return {
    sourceRunId: sourceRunId ? boundedId(sourceRunId) : null,
    trialId: result?.id ? boundedId(result.id) : null,
    startedAt,
    finishedAt,
    elapsedMilliseconds
  };
}

function normalizeProvenance(result, ecology) {
  const model = result?.agent_info?.model_info || {};
  const ecologyProvenance = Array.isArray(ecology?.assignments)
    ? ecology.assignments.find(({ modelProvenance }) => modelProvenance)?.modelProvenance
    : null;
  return {
    agent: boundedText(result?.agent_info?.name || result?.config?.agent?.name || "unknown", 500),
    agentVersion: boundedText(result?.agent_info?.version || "unknown", 100),
    provider: boundedId(ecologyProvenance?.provider || model.provider || "unknown"),
    model: boundedText(ecologyProvenance?.model || model.name || "unknown", 500),
    route: boundedId(ecologyProvenance?.route || "unknown"),
    researchSeed: Number.isInteger(ecologyProvenance?.researchSeed)
      ? ecologyProvenance.researchSeed
      : null,
    frontierEscalationAllowed: ecologyProvenance?.frontierEscalationAllowed === true
  };
}

function normalizeCandidateLineage(input, repairableCandidate) {
  const events = Array.isArray(input?.events) ? input.events : [];
  const normalizedRepairable = normalizeRepairableCandidate(repairableCandidate);
  const pendingCheckpoint = normalizeCandidateCheckpoint(input?.pendingCheckpoint);
  const lastCheckpoint = normalizeCandidateCheckpoint(input?.lastCheckpoint);
  return {
    selection: boundedId(input?.selection || "unknown"),
    eventCount: events.length,
    promotionCount: events.filter(({ promoted }) => promoted === true).length,
    challengerAdvanceCount: events.filter(({ challengerAdvanced }) => challengerAdvanced === true).length,
    boundedTransportCount: events.filter(({ mutationReceiptValid }) => mutationReceiptValid === true).length,
    implementationChangeCount: events.filter(({ implementationChanged }) => implementationChanged === true).length,
    substantiveMutationCount: events.filter(({ substantiveMutation }) => substantiveMutation === true).length,
    noOpMutationCount: events.filter(({ implementationChanged }) => implementationChanged !== true).length,
    incumbentEvidence: normalizeConstructionEvidence(input?.incumbentEvidence),
    challengerEvidence: normalizeConstructionEvidence(input?.challengerEvidence),
    pendingCheckpoint,
    lastCheckpoint,
    repairableState: normalizedRepairable,
    authority: {
      hostObservedOnly: true,
      grantsCompletionCredit: false,
      bypassesVerifier: false
    }
  };
}

function normalizeCandidateCheckpoint(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const cycle = boundedInteger(input.cycle, 0, 1_000_000, 0);
  const candidateEvidence = normalizeConstructionEvidence(input.candidateEvidence);
  return {
    cycle,
    status: boundedId(input.status || "unknown"),
    sourceDigest: /^[a-f0-9]{64}$/.test(String(input.sourceDigest || ""))
      ? String(input.sourceDigest)
      : null,
    candidateDigest: /^[a-f0-9]{64}$/.test(String(input.candidateDigest || ""))
      ? String(input.candidateDigest)
      : null,
    implementationChanged: input.implementationChanged === true,
    substantiveMutation: input.substantiveMutation === true,
    mutationReceiptValid: input.mutationReceiptValid === true,
    candidateEvidence,
    repairReuseOnly: input.authority?.repairReuseOnly === true,
    grantsCompletionCredit: false
  };
}

function normalizeRepairableCandidate(input) {
  const evidence = normalizeConstructionEvidence(input?.evidence);
  const digest = /^[a-f0-9]{64}$/.test(String(input?.source?.digest || ""))
    ? String(input.source.digest)
    : null;
  const evidenceDigest = evidence?.implementationSha256 || null;
  const available = Boolean(
    input?.available === true
    && digest
    && evidenceDigest === digest
    && evidence?.implementationPresent === true
    && evidence?.implementationSyntaxValid === true
    && evidence?.implementationSubstantive === true
  );
  return {
    available,
    selection: boundedId(input?.selection || "none"),
    source: available ? {
      ref: boundedText(input.source.ref || "unknown", 4_000),
      digest,
      bytes: boundedInteger(input.source.bytes, 1, 2_000_000, 0)
    } : null,
    evidence: available ? evidence : null,
    freshVerificationRequired: true,
    grantsCompletionCredit: false
  };
}

function normalizeConstructionEvidence(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const booleans = [
    "implementationPresent",
    "implementationSyntaxValid",
    "implementationContractPresent",
    "implementationSubstantive",
    "solverExecutionPresent",
    "solverSucceeded",
    "selfCheckPresent",
    "selfCheckAllPass",
    "candidateStatusPresent",
    "candidateAllPass"
  ];
  return {
    ...Object.fromEntries(booleans.map((key) => [key, input[key] === true])),
    implementationBytes: boundedInteger(input.implementationBytes, 0, 2_000_000, 0),
    implementationSha256: /^[a-f0-9]{64}$/.test(String(input.implementationSha256 || ""))
      ? String(input.implementationSha256)
      : null,
    failedCheckCount: boundedInteger(input.failedCheckCount, 0, 100_000, 0),
    failedCheckIds: [...new Set((Array.isArray(input.failedCheckIds) ? input.failedCheckIds : [])
      .map((value) => boundedId(value)))]
      .sort()
      .slice(0, 128)
  };
}

function boundedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function summarizeHolographicWorld(input) {
  const snapshots = Array.isArray(input?.snapshots) ? input.snapshots : [];
  const active = input?.mode === "bounded-active-retrieval" && input?.behaviorInfluence === true;
  return {
    mode: active
      ? "bounded-active-retrieval"
      : input?.mode === "read-only-shadow" ? "read-only-shadow" : "unavailable",
    authorityEnabled: false,
    behaviorInfluence: active,
    snapshotCount: snapshots.length,
    representedEntries: sum(snapshots.map(({ representedEntries }) => representedEntries)),
    exactPositiveRate: mean(snapshots.map(({ exactPositiveRate }) => exactPositiveRate)),
    exactFalsePositiveRate: mean(snapshots.map(({ exactFalsePositiveRate }) => exactFalsePositiveRate)),
    authorityLeakRate: mean(snapshots.map(({ authorityLeakRate }) => authorityLeakRate)),
    representationDigests: [...new Set(snapshots
      .map(({ representationDigest }) => String(representationDigest || ""))
      .filter((digest) => /^[a-f0-9]{64}$/.test(digest)))].sort()
  };
}

// Compatibility alias for research artifacts and callers created while HRR
// was observation-only.
export const summarizeHolographicShadow = summarizeHolographicWorld;

function normalizeFailure(result) {
  const exception = result?.exception_info || null;
  if (exception) {
    return {
      kind: "execution-error",
      type: boundedText(exception.exception_type || "HarborError", 500),
      message: boundedText(exception.exception_message || "Harbor trial failed", 2_000)
    };
  }
  const reward = result?.verifier_result?.rewards?.reward;
  if (Number.isFinite(reward) && reward <= 0) {
    return { kind: "verifier-failure", type: "VerifierFailure", message: "Official verifier returned zero." };
  }
  return { kind: "unverified", type: "UnverifiedExecution", message: "No conclusive verifier result was recorded." };
}

function normalizeCandidateStatus(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { present: false, status: "missing", phase: "unknown", allPass: false };
  }
  return {
    present: true,
    status: boundedId(input.status || "unknown"),
    phase: boundedId(input.phase || "unknown"),
    allPass: input.verification?.all_pass === true,
    artifactReceiptCount: Array.isArray(input.artifactReceipts) ? input.artifactReceipts.length : 0,
    testReceiptCount: Array.isArray(input.testReceipts) ? input.testReceipts.length : 0
  };
}

function extractFailedChecks(input) {
  const checks = [];
  const add = (id, detail) => {
    if (checks.length >= 128) return;
    const normalized = {
      id: boundedId(id || `check-${checks.length + 1}`),
      detail: boundedText(detail || "Deterministic check failed.", 1_000)
    };
    if (!checks.some((check) => check.id === normalized.id && check.detail === normalized.detail)) {
      checks.push(normalized);
    }
  };
  if (!input || typeof input !== "object") return checks;
  const source = Array.isArray(input.checks)
    ? input.checks
    : input.checks && typeof input.checks === "object"
      ? Object.entries(input.checks).map(([id, value]) => ({ id, ...(typeof value === "object" ? value : { status: value }) }))
      : [];
  for (const [index, check] of source.entries()) {
    const passed = check?.pass === true || check?.passed === true || check?.status === "pass" || check?.status === "passed";
    if (!passed) add(check?.id || check?.name || `check-${index + 1}`, check?.detail || check?.message || check?.error);
  }
  for (const [index, failure] of (Array.isArray(input.failures) ? input.failures : []).entries()) {
    if (typeof failure === "string") add(`failure-${index + 1}`, failure);
    else add(failure?.id || failure?.name || `failure-${index + 1}`, failure?.detail || failure?.message);
  }
  return checks.sort((left, right) => left.id.localeCompare(right.id));
}

function mergeFailedChecks(...groups) {
  const merged = [];
  for (const check of groups.flat()) {
    if (!check || typeof check !== "object" || merged.length >= 128) continue;
    const normalized = {
      id: boundedId(check.id || `check-${merged.length + 1}`),
      detail: boundedText(check.detail || "Deterministic check failed.", 1_000)
    };
    if (!merged.some(({ id, detail }) => id === normalized.id && detail === normalized.detail)) {
      merged.push(normalized);
    }
  }
  return merged.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeVerifierEvidence(input, result) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const summary = source.summary && typeof source.summary === "object" && !Array.isArray(source.summary)
    ? source.summary
    : {};
  const failedChecks = extractFailedChecks(source);
  const reward = Number.isFinite(source.reward)
    ? Number(source.reward)
    : Number.isFinite(result?.verifier_result?.rewards?.reward)
      ? Number(result.verifier_result.rewards.reward)
      : null;
  const totalChecks = boundedInteger(summary.totalChecks ?? summary.tests, 0, 1_000_000, 0);
  const passedChecks = boundedInteger(summary.passedChecks ?? summary.passed, 0, totalChecks || 1_000_000, 0);
  const failedCheckCount = boundedInteger(
    summary.failedChecks ?? summary.failed,
    0,
    totalChecks || 1_000_000,
    failedChecks.length
  );
  const present = source.present === true || totalChecks > 0 || failedChecks.length > 0 || reward !== null;
  return {
    present,
    source: boundedId(source.source || "unavailable"),
    status: boundedId(source.status || (reward !== null ? (reward > 0 ? "passed" : "failed") : "unavailable")),
    reward,
    totalChecks,
    passedChecks,
    failedChecks: failedCheckCount,
    qualityFraction: totalChecks > 0 ? passedChecks / totalChecks : 0,
    failedCheckDetails: failedChecks,
    evidenceRefs: (Array.isArray(source.evidenceRefs) ? source.evidenceRefs : [])
      .map((value) => boundedText(value, 4_000))
      .slice(0, 64),
    authority: {
      hostObservedOnly: true,
      grantsCompletionCredit: false,
      bypassesVerifier: false
    }
  };
}

function deriveRepairSignals({ result, failedChecks, terminalAssignments, candidateStatus }) {
  const text = [
    result?.exception_info?.exception_message,
    ...failedChecks.flatMap(({ id, detail }) => [id, detail])
  ].join(" ").toLowerCase();
  const signals = [];
  if (/exhausted|no[- ]progress|checkpoint/.test(text)) signals.push("construction-no-progress");
  if (/inventory|stock|lot|material|component|substitut|bom/.test(text)) {
    signals.push("inventory-substitution-feasibility");
  }
  if (/shift|capacity|downtime|changeover|schedule|dispatch/.test(text)) {
    signals.push("finite-capacity-interval-repair");
  }
  if (/empty|zero|missing|no .*output|no .*row/.test(text)) signals.push("empty-output-repair");
  if (!candidateStatus || candidateStatus?.verification?.all_pass !== true) {
    signals.push("candidate-contract-incomplete");
  }
  if (terminalAssignments.some(({ role }) => role === "solver-builder")) {
    signals.push("solver-builder-retry");
  }
  return [...new Set(signals.length > 0 ? signals : ["evidence-directed-repair"])].sort();
}

function boundedText(value, maximum) {
  const text = String(value ?? "").trim() || "unknown";
  return text.slice(0, maximum);
}

function boundedId(value) {
  const normalized = boundedText(value, 500).replace(/[^A-Za-z0-9._:/-]+/g, "-");
  return normalized || "unknown";
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + finite(value), 0);
}

function mean(values) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export const swarmFailureCapsuleInternals = Object.freeze({
  extractFailedChecks,
  deriveRepairSignals,
  mergeFailedChecks,
  normalizeVerifierEvidence
});
