import { performance } from "node:perf_hooks";
import { digestResearchValue } from "./experimentProtocol.js";

export const SWARM_TASK_RUN_SCHEMA = "amos.swarm-task-run";
export const SWARM_TASK_BOARD_SCHEMA = "amos.swarm-task-board";
export const SWARM_TASK_VERSION = 1;

export const SWARM_TASK_ROLES = Object.freeze([
  "state-compiler",
  "solver-builder",
  "verifier",
  "repairer",
  "integrator"
]);

export const DEFAULT_SWARM_TASK_POLICY = Object.freeze({
  maxRepairCycles: 2,
  maxUnits: 8,
  maxBoardEntries: 200,
  maxWallMilliseconds: 3_600_000,
  requireVerifiedArtifact: true,
  requireVerifiedTest: true
});

const ENTRY_KINDS = new Set([
  "requirement",
  "fact",
  "artifact",
  "test",
  "gap",
  "decision"
]);
const ENTRY_STATUSES = new Set([
  "observed",
  "proposed",
  "verified",
  "failed",
  "unresolved",
  "superseded"
]);
const VERDICT_STATUSES = new Set(["pass", "repair", "blocked"]);
const CRITERION_STATUSES = new Set(["pass", "fail"]);
const ROLE_ENTRY_KINDS = Object.freeze({
  "state-compiler": new Set(["requirement", "fact", "gap"]),
  "solver-builder": new Set(["artifact", "decision", "gap"]),
  verifier: new Set(["fact", "test", "gap", "decision"]),
  repairer: new Set(["fact", "artifact", "test", "gap", "decision"]),
  integrator: new Set(["decision"])
});

export function compileSwarmTaskMission({
  missionId,
  objective,
  context = "",
  successCriteria = []
}) {
  const criteria = successCriteria.length > 0
    ? uniqueStrings(successCriteria, "mission.successCriteria", 50)
    : ["Produce the requested result and verify it against the supplied requirements."];
  return {
    id: requiredId(missionId, "mission.id"),
    objective: requiredText(objective, "mission.objective", 100_000),
    context: optionalText(context, "mission.context", 500_000),
    successCriteria: criteria.map((statement, index) => ({
      id: `criterion-${String(index + 1).padStart(3, "0")}`,
      statement
    })),
    workUnits: [
      {
        role: "state-compiler",
        objective:
          "Convert authoritative inputs into compact requirements and facts. Persist only state " +
          "that later workers need; do not solve the mission or dump raw inputs."
      },
      {
        role: "solver-builder",
        objective:
          "Construct the executable solution or artifact from the typed board. Record artifact " +
          "paths and content receipts instead of narrating intended work."
      },
      {
        role: "verifier",
        objective:
          "Independently execute checks against every success criterion. Pass only with cited " +
          "board evidence and deterministic test receipts."
      },
      {
        role: "repairer",
        objective:
          "Repair only the verifier's recorded gaps. Reuse verified state and never restart broad " +
          "discovery unless the verifier identifies missing authoritative evidence."
      },
      {
        role: "integrator",
        objective:
          "Synthesize the verified result for the user without modifying verified artifacts or " +
          "claiming completion beyond the board receipts."
      }
    ]
  };
}

export class SwarmTaskBoard {
  constructor({ missionId, maximumEntries = 200, now = () => new Date() }) {
    this.missionId = requiredId(missionId, "missionId");
    this.maximumEntries = boundedInteger(maximumEntries, 1, 10_000, "maximumEntries");
    this.now = now;
    this.items = [];
    this.entryDigests = new Map();
  }

  append({
    workerRole,
    kind,
    statement,
    status,
    sourceRefs = [],
    criterionIds = [],
    artifactPath = null,
    receiptDigest = null
  }) {
    const semantic = {
      workerRole: taskRole(workerRole),
      kind: entryKind(kind),
      statement: requiredText(statement, "entry.statement", 20_000),
      status: entryStatus(status),
      sourceRefs: uniqueStrings(sourceRefs, "entry.sourceRefs", 20),
      criterionIds: uniqueStrings(criterionIds, "entry.criterionIds", 50),
      artifactPath: optionalText(artifactPath, "entry.artifactPath", 4_000) || null,
      receiptDigest: optionalDigest(receiptDigest, "entry.receiptDigest")
    };
    assertReceiptContract(semantic);
    const entryDigest = digestResearchValue(semantic);
    const existing = this.entryDigests.get(entryDigest);
    if (existing) return { added: false, item: structuredClone(existing) };
    if (this.items.length >= this.maximumEntries) {
      throw new Error("Swarm task board exceeded its entry limit");
    }
    const item = {
      id: `state-${String(this.items.length + 1).padStart(4, "0")}`,
      ...semantic,
      entryDigest,
      recordedAt: validDate(this.now(), "entry.recordedAt").toISOString()
    };
    this.items.push(item);
    this.entryDigests.set(entryDigest, item);
    return { added: true, item: structuredClone(item) };
  }

  snapshot() {
    const board = {
      schema: SWARM_TASK_BOARD_SCHEMA,
      version: SWARM_TASK_VERSION,
      missionId: this.missionId,
      items: structuredClone(this.items)
    };
    return { ...board, digest: digestResearchValue(board) };
  }
}

export class SwarmTaskCoordinator {
  constructor({
    worker,
    policy = DEFAULT_SWARM_TASK_POLICY,
    onCheckpoint = null,
    now = () => new Date(),
    monotonicNow = () => performance.now()
  }) {
    if (!worker || typeof worker.runUnit !== "function") {
      throw new Error("SwarmTaskCoordinator requires a worker with runUnit");
    }
    if (onCheckpoint !== null && typeof onCheckpoint !== "function") {
      throw new Error("onCheckpoint must be a function");
    }
    this.worker = worker;
    this.policy = validateSwarmTaskPolicy(policy);
    this.onCheckpoint = onCheckpoint;
    this.now = now;
    this.monotonicNow = monotonicNow;
  }

  async run({ missionId, objective, context = "", successCriteria = [], signal = null }) {
    const mission = compileSwarmTaskMission({ missionId, objective, context, successCriteria });
    const board = new SwarmTaskBoard({
      missionId: mission.id,
      maximumEntries: this.policy.maxBoardEntries,
      now: this.now
    });
    const startedAt = validDate(this.now(), "run.startedAt").toISOString();
    const started = this.monotonicNow();
    const timeoutSignal = AbortSignal.timeout(this.policy.maxWallMilliseconds);
    const runSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const stages = [];

    await this.#runUnit({ mission, board, stages, role: "state-compiler", cycle: 0, signal: runSignal });
    await this.#runUnit({ mission, board, stages, role: "solver-builder", cycle: 0, signal: runSignal });

    let finalVerdict = null;
    for (let cycle = 0; cycle <= this.policy.maxRepairCycles; cycle += 1) {
      const verification = await this.#runUnit({
        mission,
        board,
        stages,
        role: "verifier",
        cycle,
        signal: runSignal
      });
      finalVerdict = verification.verdict;
      if (finalVerdict.status === "pass") break;
      if (finalVerdict.status === "blocked") {
        throw new Error(`Swarm task blocked: ${finalVerdict.gaps.join("; ")}`);
      }
      if (cycle === this.policy.maxRepairCycles) {
        throw new Error("Swarm task exhausted its repair cycles without a verifier pass");
      }
      await this.#runUnit({
        mission,
        board,
        stages,
        role: "repairer",
        cycle: cycle + 1,
        signal: runSignal
      });
    }

    assertVerifiedCompletion({ mission, board: board.snapshot(), verdict: finalVerdict, policy: this.policy });
    const integration = await this.#runUnit({
      mission,
      board,
      stages,
      role: "integrator",
      cycle: 0,
      signal: runSignal
    });
    const finalAnswer = requiredText(
      integration.finalAnswer,
      "integrator.finalAnswer",
      500_000
    );
    const completedAt = validDate(this.now(), "run.completedAt").toISOString();
    const runBase = {
      schema: SWARM_TASK_RUN_SCHEMA,
      version: SWARM_TASK_VERSION,
      status: "completed",
      startedAt,
      completedAt,
      wallMilliseconds: Math.max(0, Math.round(this.monotonicNow() - started)),
      mission,
      policy: this.policy,
      board: board.snapshot(),
      verdict: finalVerdict,
      finalAnswer,
      stages
    };
    return { ...runBase, digest: digestResearchValue(runBase) };
  }

  async #runUnit({ mission, board, stages, role, cycle, signal }) {
    if (stages.length >= this.policy.maxUnits) {
      throw new Error("Swarm task exceeded policy.maxUnits");
    }
    const unit = mission.workUnits.find((candidate) => candidate.role === role);
    const before = board.snapshot();
    const result = normalizeUnitResult(await this.worker.runUnit({
      mission: structuredClone(mission),
      unit: structuredClone(unit),
      board: before,
      cycle,
      signal
    }), { role, mission });
    const addedIds = [];
    for (const entry of result.entries) {
      const appended = board.append({ workerRole: role, ...entry });
      if (appended.added) addedIds.push(appended.item.id);
    }
    if (role !== "verifier" && role !== "integrator" && addedIds.length === 0) {
      throw new Error(`${role} made no durable progress`);
    }
    const after = board.snapshot();
    const stage = {
      role,
      cycle,
      boardDigestBefore: before.digest,
      boardDigestAfter: after.digest,
      addedEntryIds: addedIds,
      verdict: result.verdict,
      finalAnswerDigest: result.finalAnswer
        ? digestResearchValue(result.finalAnswer)
        : null
    };
    stages.push(stage);
    await this.onCheckpoint?.({
      mission: structuredClone(mission),
      board: after,
      stage: structuredClone(stage)
    });
    return result;
  }
}

export function validateSwarmTaskPolicy(input = DEFAULT_SWARM_TASK_POLICY) {
  const policy = { ...DEFAULT_SWARM_TASK_POLICY, ...structuredClone(input) };
  for (const field of ["maxRepairCycles", "maxUnits", "maxBoardEntries", "maxWallMilliseconds"]) {
    boundedInteger(policy[field], field === "maxRepairCycles" ? 0 : 1, 10_000_000, `policy.${field}`);
  }
  for (const field of ["requireVerifiedArtifact", "requireVerifiedTest"]) {
    if (typeof policy[field] !== "boolean") throw new Error(`policy.${field} must be boolean`);
  }
  const requiredUnits = 4 + (policy.maxRepairCycles * 2);
  if (policy.maxUnits < requiredUnits) {
    throw new Error(`policy.maxUnits must allow ${requiredUnits} units for the configured repairs`);
  }
  return policy;
}

function normalizeUnitResult(input, { role, mission }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${role} result must be an object`);
  }
  const entries = Array.isArray(input.entries)
    ? input.entries.map((entry) => normalizedEntry(entry, mission, role))
    : [];
  if (role !== "integrator" && entries.length === 0) {
    throw new Error(`${role} result must include typed board entries`);
  }
  const verdict = role === "verifier"
    ? normalizedVerdict(input.verdict, mission)
    : null;
  if (role !== "verifier" && input.verdict !== undefined && input.verdict !== null) {
    throw new Error(`${role} cannot issue a verifier verdict`);
  }
  const finalAnswer = role === "integrator"
    ? requiredText(input.finalAnswer, "integrator.finalAnswer", 500_000)
    : null;
  return { entries, verdict, finalAnswer };
}

function normalizedEntry(input, mission, role) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("board entry must be an object");
  }
  const criterionIds = uniqueStrings(input.criterionIds || [], "entry.criterionIds", 50);
  const known = new Set(mission.successCriteria.map(({ id }) => id));
  for (const criterionId of criterionIds) {
    if (!known.has(criterionId)) throw new Error(`Unknown success criterion: ${criterionId}`);
  }
  const kind = entryKind(input.kind);
  if (!ROLE_ENTRY_KINDS[role].has(kind)) {
    throw new Error(`${role} cannot append ${kind} entries`);
  }
  return {
    kind,
    statement: requiredText(input.statement, "entry.statement", 20_000),
    status: entryStatus(input.status),
    sourceRefs: uniqueStrings(input.sourceRefs || [], "entry.sourceRefs", 20),
    criterionIds,
    artifactPath: optionalText(input.artifactPath, "entry.artifactPath", 4_000) || null,
    receiptDigest: optionalDigest(input.receiptDigest, "entry.receiptDigest")
  };
}

function normalizedVerdict(input, mission) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("verifier result must include a verdict object");
  }
  const status = String(input.status || "").trim();
  if (!VERDICT_STATUSES.has(status)) throw new Error(`Unsupported verifier verdict: ${status}`);
  const criteria = Array.isArray(input.criteria)
    ? input.criteria.map((criterion) => {
        const criterionId = requiredId(criterion?.criterionId, "verdict.criterionId");
        if (!mission.successCriteria.some(({ id }) => id === criterionId)) {
          throw new Error(`Unknown verdict criterion: ${criterionId}`);
        }
        const criterionStatus = String(criterion?.status || "").trim();
        if (!CRITERION_STATUSES.has(criterionStatus)) {
          throw new Error(`Unsupported criterion verdict: ${criterionStatus}`);
        }
        return {
          criterionId,
          status: criterionStatus,
          evidenceIds: uniqueStrings(criterion?.evidenceIds || [], "verdict.evidenceIds", 100)
        };
      })
    : [];
  const ids = criteria.map(({ criterionId }) => criterionId);
  if (new Set(ids).size !== ids.length) throw new Error("verdict criteria must be unique");
  return {
    status,
    criteria,
    gaps: uniqueStrings(input.gaps || [], "verdict.gaps", 100)
  };
}

function assertVerifiedCompletion({ mission, board, verdict, policy }) {
  if (verdict?.status !== "pass") throw new Error("Completion requires a verifier pass");
  const evidenceById = new Map(board.items.map((item) => [item.id, item]));
  for (const criterion of mission.successCriteria) {
    const result = verdict.criteria.find(({ criterionId }) => criterionId === criterion.id);
    if (!result || result.status !== "pass" || result.evidenceIds.length === 0) {
      throw new Error(`Verifier did not prove ${criterion.id}`);
    }
    for (const evidenceId of result.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) throw new Error(`Verifier cited unknown evidence: ${evidenceId}`);
      if (["failed", "unresolved"].includes(evidence.status)) {
        throw new Error(`Verifier cited non-passing evidence: ${evidenceId}`);
      }
    }
  }
  if (verdict.gaps.length > 0) throw new Error("Passing verdict cannot contain unresolved gaps");
  if (policy.requireVerifiedArtifact && !board.items.some((item) =>
    item.kind === "artifact" && item.status === "verified" && item.receiptDigest)) {
    throw new Error("Completion requires a verified artifact receipt");
  }
  if (policy.requireVerifiedTest && !board.items.some((item) =>
    item.kind === "test" && item.status === "verified" && item.receiptDigest)) {
    throw new Error("Completion requires a verified test receipt");
  }
}

function assertReceiptContract(entry) {
  if (["artifact", "test"].includes(entry.kind) && entry.status === "verified" && !entry.receiptDigest) {
    throw new Error(`Verified ${entry.kind} entries require a receiptDigest`);
  }
  if (entry.artifactPath && entry.kind !== "artifact") {
    throw new Error("artifactPath is only valid for artifact entries");
  }
}

function taskRole(value) {
  if (!SWARM_TASK_ROLES.includes(value)) throw new Error(`Unsupported swarm task role: ${value}`);
  return value;
}

function entryKind(value) {
  const text = String(value || "").trim();
  if (!ENTRY_KINDS.has(text)) throw new Error(`Unsupported board entry kind: ${text}`);
  return text;
}

function entryStatus(value) {
  const text = String(value || "").trim();
  if (!ENTRY_STATUSES.has(text)) throw new Error(`Unsupported board entry status: ${text}`);
  return text;
}

function optionalDigest(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const text = requiredText(value, label, 200);
  if (!/^[a-f0-9]{64}$/i.test(text)) throw new Error(`${label} must be a SHA-256 digest`);
  return text.toLowerCase();
}

function requiredId(value, label) {
  return requiredText(value, label, 200);
}

function optionalText(value, label, maximum) {
  if (value === null || value === undefined || value === "") return "";
  return requiredText(value, label, maximum);
}

function requiredText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} must be a non-empty string`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function uniqueStrings(value, label, maximumItems) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${label} must be an array with at most ${maximumItems} items`);
  }
  const result = value.map((item, index) => requiredText(item, `${label}[${index}]`, 20_000));
  if (new Set(result).size !== result.length) throw new Error(`${label} must be unique`);
  return result;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function validDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}
