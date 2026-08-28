import { digestResearchValue } from "./experimentProtocol.js";
import { createSwarmLearningEpisode } from "./swarmLearningArena.js";

const AUTHORITY = Object.freeze({
  worker_self_check: 0,
  independent_model: 1,
  deterministic: 2,
  real_world: 3
});
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/** Mirror the Platform's pinned-checker assessment for exported Mission evidence. */
export function assessPlatformMissionVerification(missionInput) {
  const mission = object(missionInput, "mission");
  const policy = mission.contract?.verification_policy;
  const requirements = Array.isArray(policy?.requirements) ? policy.requirements : [];
  if (policy?.schema_version !== "1" || requirements.length === 0) {
    return { status: "invalid_policy", coverage: 0, pending: [], failed: [], passed: [] };
  }
  const latest = new Map();
  const sorted = [...(Array.isArray(mission.verification) ? mission.verification : [])]
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at));
  for (const result of sorted) {
    if (typeof result?.requirement_id === "string" && !latest.has(result.requirement_id)) {
      latest.set(result.requirement_id, result);
    }
  }
  const pending = [];
  const failed = [];
  const passed = [];
  for (const requirement of requirements) {
    const id = String(requirement?.id || "");
    const result = latest.get(id);
    const authority = AUTHORITY[result?.authority];
    const minimum = AUTHORITY[requirement?.minimum_authority];
    const pinned = result?.checker_id === requirement?.checker_id &&
      result?.checker_version === requirement?.checker_version &&
      result?.definition_sha256 === requirement?.definition_sha256;
    const covered = result?.coverage === 1 &&
      Array.isArray(result?.unknown_requirements) && result.unknown_requirements.length === 0;
    if (!id || !result || minimum === undefined || minimum === AUTHORITY.worker_self_check ||
        authority === undefined || authority === AUTHORITY.worker_self_check ||
        authority < minimum || !pinned || !covered) {
      pending.push(id || "invalid-requirement");
    } else if (result.verdict === "fail") {
      failed.push(id);
    } else if (result.verdict === "pass") {
      passed.push(id);
    } else {
      pending.push(id);
    }
  }
  const status = failed.length > 0 ? "failed" : pending.length > 0 ? "pending" : "complete";
  return {
    status,
    coverage: requirements.length === 0 ? 0 : passed.length / requirements.length,
    pending,
    failed,
    passed
  };
}

/**
 * Convert one terminal Platform Mission plus correlated Swarm gateway traces
 * into the organism's immutable learning episode. Checker results, not model
 * prose, determine positive/negative outcome. Tenant training permission must
 * be supplied explicitly; this function never opts customer data in.
 */
export function createPlatformMissionLearningEpisode(input) {
  const source = object(input, "platform mission episode input");
  const mission = object(source.mission, "platform mission episode input.mission");
  if (!TERMINAL_STATUSES.has(mission.status)) {
    throw new Error("Platform Mission learning requires a terminal mission");
  }
  const missionId = requiredId(mission.mission_id, "mission.mission_id");
  const contract = object(mission.contract, "mission.contract");
  const contractDigest = requiredDigest(contract.contract_sha256, "mission.contract.contract_sha256");
  const traces = correlatedTraces(source.gatewayTraces || [], missionId);
  const assessment = assessPlatformMissionVerification(mission);
  const verification = Array.isArray(mission.verification) ? mission.verification : [];
  const conclusiveResults = verification.filter((result) =>
    result?.verdict === "pass" || result?.verdict === "fail");
  const execution = missionExecution(mission, assessment);
  const modelName = requiredText(
    source.model?.name || traces.at(-1)?.backendModel,
    "model.name",
    500
  );
  const traceReferences = traces.map((trace) => ({
    ref: `swarm-gateway:${trace.digest}`,
    kind: "swarm-gateway-trace",
    status: "collected",
    digest: trace.digest
  }));
  const verificationArtifacts = conclusiveResults.map((result) => ({
    ref: `mission-check:${requiredText(result.checker_run_id, "checker_run_id", 500)}`,
    kind: "mission-verification-result",
    status: "collected",
    digest: requiredDigest(result.result_sha256, "verification.result_sha256")
  }));
  const verifierEvidence = conclusiveResults.map((result) =>
    `mission-check:${result.checker_run_id}:${result.result_sha256}`);
  const ecologyDigest = traces.length > 0
    ? digestResearchValue({ missionId, traces: traces.map((trace) => trace.digest) })
    : null;
  const verifier = assessment.status === "complete"
    ? { kind: "amos-platform-checker-waist", status: "passed", score: 1, evidenceRefs: verifierEvidence }
    : assessment.status === "failed"
      ? { kind: "amos-platform-checker-waist", status: "failed", score: 0, evidenceRefs: verifierEvidence }
      : { kind: "amos-platform-checker-waist", status: "not-run", score: null, evidenceRefs: [] };
  return createSwarmLearningEpisode({
    id: `platform-mission-${missionId}`,
    treatmentId: requiredId(
      source.treatmentId || "amos-platform-swarm-mission-v1",
      "treatmentId"
    ),
    partition: source.partition || "operations",
    task: {
      source: "amos-platform-mission",
      name: requiredText(mission.name, "mission.name", 500),
      ref: `mission:${missionId}`,
      checksum: contractDigest
    },
    model: {
      provider: requiredId(source.model?.provider || "amos", "model.provider"),
      name: modelName,
      agent: requiredText(source.model?.agent || "swarm-mission-worker", "model.agent", 500),
      agentVersion: requiredText(source.model?.agentVersion || "1", "model.agentVersion", 100),
      sharedBackbone: source.model?.sharedBackbone !== false
    },
    execution,
    verifier,
    artifacts: verificationArtifacts,
    traces: traceReferences,
    ecology: ecologyDigest === null ? null : {
      ref: `mission-swarm-ecology:${missionId}`,
      digest: ecologyDigest,
      status: "observed",
      agentCount: maximumAgentCount(traces),
      assignmentCount: traces.reduce((total, trace) => total + trace.stages.length, 0)
    },
    curriculumSignals: [
      `mission-${mission.status}`,
      `checker-${assessment.status}`,
      ...assessment.failed.map((id) => `failed-${safeSignal(id)}`),
      ...assessment.pending.map((id) => `pending-${safeSignal(id)}`),
      ...(Array.isArray(source.curriculumSignals) ? source.curriculumSignals : [])
    ],
    dataPolicy: object(source.dataPolicy, "dataPolicy")
  });
}

function missionExecution(mission, assessment) {
  const startedAt = mission.started_at || mission.created_at;
  const finishedAt = mission.finished_at || mission.created_at;
  if (mission.status === "cancelled") {
    return { status: "cancelled", startedAt, finishedAt, exception: null };
  }
  if (mission.status === "completed" && assessment.status === "complete") {
    return { status: "completed", startedAt, finishedAt, exception: null };
  }
  if (mission.status === "failed" && assessment.status === "failed") {
    return { status: "completed", startedAt, finishedAt, exception: null };
  }
  return {
    status: "errored",
    startedAt,
    finishedAt,
    exception: {
      type: "MissionVerificationIncomplete",
      message: requiredText(
        mission.status_reason || `Mission ended ${mission.status} with checker ${assessment.status}`,
        "mission.status_reason",
        20_000
      )
    }
  };
}

function correlatedTraces(values, missionId) {
  if (!Array.isArray(values)) throw new Error("gatewayTraces must be an array");
  return values.filter((trace) => {
    if (trace?.schema !== "amos.swarm-turn-gateway-trace" || trace?.version !== 1) return false;
    if (trace?.mission?.missionId !== missionId) return false;
    requiredDigest(trace.digest, "gateway trace digest");
    if (!Array.isArray(trace.stages)) throw new Error("gateway trace stages must be an array");
    return true;
  });
}

function maximumAgentCount(traces) {
  let maximum = 0;
  for (const trace of traces) {
    const agents = new Set(trace.stages.map((stage) => String(stage.stage).split(":")[0]));
    maximum = Math.max(maximum, agents.size);
  }
  return maximum;
}

function safeSignal(value) {
  return String(value).replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 400) || "unknown";
}

function timestamp(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value);
}

function requiredText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function requiredId(value, label) {
  const id = requiredText(value, label, 500);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
}

function requiredDigest(value, label) {
  const digest = String(value ?? "");
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} must be a SHA-256 digest`);
  return digest;
}
