#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { createSwarmLearningEpisode } from "../src/research/swarmLearningArena.js";
import { createSwarmFailureCapsule } from "../src/research/swarmFailureCapsule.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const argumentsList = process.argv.slice(2);
const jobDirectoryArgument = argumentsList.find((value) => !value.startsWith("--"));
if (!jobDirectoryArgument) {
  throw new Error(
    "Usage: node scripts/collectHarborSwarmEpisodes.js <harbor-job-directory> [--store <path>]"
  );
}
const storeIndex = argumentsList.indexOf("--store");
const storeArgument = storeIndex === -1 ? null : argumentsList[storeIndex + 1];
if (storeIndex !== -1 && !storeArgument) throw new Error("--store requires a path");
const outputIndex = argumentsList.indexOf("--output");
const outputArgument = outputIndex === -1 ? null : argumentsList[outputIndex + 1];
if (outputIndex !== -1 && !outputArgument) throw new Error("--output requires a path");
const runIdIndex = argumentsList.indexOf("--run-id");
const sourceRunId = runIdIndex === -1 ? null : argumentsList[runIdIndex + 1];
if (runIdIndex !== -1 && !sourceRunId) throw new Error("--run-id requires a value");
const capsulesOnly = argumentsList.includes("--capsules-only");

const jobDirectory = resolve(jobDirectoryArgument);
const storeDirectory = resolve(
  storeArgument || process.env.AMOS_SWARM_REPLAY_DIR || ".amos-agent/research/swarm-learning"
);
const trialResults = await findTrialResults(jobDirectory);
if (trialResults.length === 0) throw new Error(`No Harbor trial results found under ${jobDirectory}`);

const store = await openSwarmLearningStore(storeDirectory);
const recorded = [];
for (const { trialDirectory, result } of trialResults) {
  const episode = await compileHarborEpisode({
    trialDirectory,
    result,
    store,
    sourceRunId
  });
  recorded.push(capsulesOnly ? episode : await store.recordEpisode(episode));
}
const arena = await store.arena();
const researchReplay = arena.replayBatch({ purpose: "research" });
const trainingReplay = arena.replayBatch({ purpose: "adapter" });
const curriculum = arena.buildCurriculum();

const summary = {
  schema: "amos.harbor-swarm-collection",
  version: 1,
  sourceRunId,
  mode: capsulesOnly ? "failure-capsule-backfill" : "episode-collection",
  storeDirectory,
  recorded: recorded.map((episode) => ({
    id: episode.id,
    digest: episode.digest,
    outcome: episode.outcome,
    trainingEligibility: episode.trainingEligibility
  })),
  researchEpisodes: researchReplay.episodeDigests.length,
  trainingEpisodes: trainingReplay.episodeDigests.length,
  curriculumChallenges: curriculum.challenges.length
};
if (outputArgument) {
  await writeFile(resolve(outputArgument), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(summary, null, 2));

async function compileHarborEpisode({ trialDirectory, result, store, sourceRunId }) {
  const ecologyPath = join(trialDirectory, "agent", "holographic_swarm.json");
  const ecology = await optionalJson(ecologyPath);
  const artifactManifest = await optionalJson(join(trialDirectory, "artifacts", "manifest.json"));
  const traces = await collectTrajectorySummaries(join(trialDirectory, "agent"), store);
  const verifierFiles = await collectFiles(
    join(trialDirectory, "verifier"),
    () => true,
    "verifier-evidence",
    store
  );
  const verifierFeedback = await collectHarborVerifierFeedback({
    trialDirectory,
    result,
    evidenceRefs: verifierFiles.map(({ ref }) => ref)
  });
  const artifacts = await normalizeArtifacts(
    Array.isArray(artifactManifest) ? artifactManifest : [],
    trialDirectory,
    store
  );
  artifacts.push(...await collectTreeFiles(
    join(trialDirectory, "artifacts", "logs", "artifacts"),
    "workspace-artifact",
    store
  ));
  artifacts.push(...await collectTreeFiles(
    join(trialDirectory, "agent", "artifacts", "swarm"),
    "swarm-safe-workspace-artifact",
    store
  ));
  const trialResultReference = await durableFileReference(
    join(trialDirectory, "result.json"),
    "harbor-trial-result",
    store
  );
  traces.push(trialResultReference);
  const exception = result.exception_info
    ? {
        type: String(result.exception_info.exception_type || "HarborError"),
        message: String(result.exception_info.exception_message || "Harbor trial failed")
      }
    : null;
  const verifierReward = result.verifier_result?.rewards?.reward;
  const hasVerifier = Number.isFinite(verifierReward);
  const verifierEvidenceRefs = hasVerifier
    ? [trialResultReference.ref, ...verifierFiles.map(({ ref }) => ref)]
    : [];
  const modelInfo = result.agent_info?.model_info || {};
  const taskId = result.task_id || {};
  const board = await firstAvailableJson([
    join(trialDirectory, "agent", "artifacts", "swarm", "board.json"),
    join(trialDirectory, "artifacts", "logs", "artifacts", "swarm", "board.json")
  ]);
  const candidateEvolution = await firstAvailableJson([
    join(trialDirectory, "agent", "artifacts", "swarm", "candidate-evolution.json"),
    join(trialDirectory, "artifacts", "logs", "artifacts", "swarm", "candidate-evolution.json")
  ]);
  const repairableCandidate = await collectRepairableCandidate({
    trialDirectory,
    candidateEvolution,
    store
  });
  const task = {
    source: String(result.source || "terminal-bench/terminal-bench"),
    name: String(result.task_name || taskId.name || "unknown-task"),
    ref: taskId.ref ? String(taskId.ref) : null,
    checksum: /^[a-f0-9]{64}$/.test(String(result.task_checksum || ""))
      ? String(result.task_checksum)
      : null,
    instructionDigest: /^[a-f0-9]{64}$/.test(String(board?.taskDigest || ""))
      ? String(board.taskDigest)
      : null
  };
  const agentName = String(result.agent_info?.name || result.config?.agent?.name || "unknown-agent");
  const ecologyDigest = ecology ? await store.putBlob(await readFile(ecologyPath)) : null;
  const ecologyReference = ecology
    ? {
        ref: blobReference(ecologyDigest, "holographic_swarm.json"),
        digest: ecologyDigest,
        status: safeId(ecology.status || "unknown"),
        agentCount: Array.isArray(ecology.agents) ? ecology.agents.length : 0,
        assignmentCount: Array.isArray(ecology.assignments) ? ecology.assignments.length : 0
      }
    : null;
  const failureCapsule = shouldCompileFailureCapsule(result)
    ? createSwarmFailureCapsule({
        task,
        result,
        ecology,
        selfCheck: await firstAvailableJson([
          join(trialDirectory, "agent", "artifacts", "swarm", "tests", "self-check.json"),
          join(trialDirectory, "agent", "artifacts", "swarm", "self-check.json"),
          join(trialDirectory, "artifacts", "logs", "artifacts", "swarm", "self-check.json"),
          join(trialDirectory, "artifacts", "logs", "artifacts", "swarm", "tests", "self-check.json")
        ]),
        verifierFeedback,
        candidateStatus: await firstAvailableJson([
          join(trialDirectory, "agent", "artifacts", "swarm", "candidate-status.json"),
          join(trialDirectory, "artifacts", "logs", "artifacts", "swarm", "candidate-status.json")
        ]),
        artifactReferences: artifacts,
        candidateEvolution,
        repairableCandidate,
        sourceRunId
      })
    : null;
  if (failureCapsule) {
    const failureCapsuleDigest = failureCapsule.task.instructionDigest
      ? (await store.recordFailureCapsule(failureCapsule)).blobDigest
      : await store.putBlob(Buffer.from(`${JSON.stringify(failureCapsule, null, 2)}\n`, "utf8"));
    traces.push({
      ref: blobReference(failureCapsuleDigest, "failure-capsule.json"),
      kind: "failure-capsule",
      status: "collected",
      digest: failureCapsuleDigest
    });
  }

  return createSwarmLearningEpisode({
    id: `harbor-${safeId(result.id || basename(trialDirectory))}`,
    treatmentId: agentName === "amos-holographic-swarm"
      ? "terminal-bench-holographic-swarm-v1"
      : `harbor-${safeId(agentName)}`,
    partition: "development",
    task,
    model: {
      provider: safeId(modelInfo.provider || "unknown"),
      name: String(modelInfo.name || "unknown-model"),
      agent: agentName,
      agentVersion: String(result.agent_info?.version || "unknown"),
      sharedBackbone: agentName.includes("swarm")
    },
    execution: {
      status: exception ? "errored" : "completed",
      startedAt: result.started_at,
      finishedAt: result.finished_at || result.updated_at || result.started_at,
      exception
    },
    verifier: {
      kind: "harbor-official-deterministic",
      status: hasVerifier ? (verifierReward > 0 ? "passed" : "failed") : "not-run",
      score: hasVerifier ? Number(verifierReward) : null,
      evidenceRefs: verifierEvidenceRefs
    },
    artifacts: dedupeReferences(artifacts),
    traces,
    ecology: ecologyReference,
    curriculumSignals: curriculumSignals(result, ecology, failureCapsule),
    dataPolicy: harborDataPolicy(task.name)
  });
}

async function collectHarborVerifierFeedback({ trialDirectory, result, evidenceRefs }) {
  const ctrf = await optionalJson(join(trialDirectory, "verifier", "ctrf.json"));
  const results = ctrf?.results && typeof ctrf.results === "object" ? ctrf.results : {};
  const summary = results.summary && typeof results.summary === "object" ? results.summary : {};
  const tests = Array.isArray(results.tests) ? results.tests : [];
  const checks = tests.slice(0, 1_000).map((check, index) => {
    const status = safeId(check?.status || "unknown").toLowerCase();
    const name = safeId(check?.name || `check-${index + 1}`);
    return {
      id: `official:${name}`,
      status,
      detail: String(
        check?.message
        || check?.failure?.message
        || check?.error
        || `Official checker reported ${status}.`
      ).trim().slice(0, 1_000)
    };
  });
  const reward = result.verifier_result?.rewards?.reward;
  return {
    present: Number.isFinite(reward) || tests.length > 0,
    source: "harbor-official-deterministic",
    status: Number.isFinite(reward) ? (reward > 0 ? "passed" : "failed") : "not-run",
    reward: Number.isFinite(reward) ? Number(reward) : null,
    summary: {
      totalChecks: boundedCount(summary.tests, tests.length),
      passedChecks: boundedCount(summary.passed, checks.filter(({ status }) => isPassingStatus(status)).length),
      failedChecks: boundedCount(summary.failed, checks.filter(({ status }) => !isPassingStatus(status)).length)
    },
    checks,
    evidenceRefs
  };
}

function isPassingStatus(status) {
  return ["pass", "passed", "ok", "success"].includes(String(status).trim().toLowerCase());
}

function boundedCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 1_000_000
    ? number
    : Math.max(0, Math.min(1_000_000, Number(fallback) || 0));
}

async function collectRepairableCandidate({ trialDirectory, candidateEvolution, store }) {
  const swarmRoots = [
    join(trialDirectory, "agent", "artifacts", "swarm"),
    join(trialDirectory, "artifacts", "logs", "artifacts", "swarm")
  ];
  const branchCandidates = (Array.isArray(candidateEvolution?.events)
    ? [...candidateEvolution.events].reverse()
    : [])
    .filter((event) => event?.challengerAdvanced === true || event?.promoted === true)
    .map((event) => {
      const branchName = basename(String(event?.branch || ""));
      if (!/^cycle-[0-9]{2,6}$/.test(branchName)) return null;
      return {
        selection: `selected-${branchName}`,
        evidence: event?.mutationEvidence,
        paths: swarmRoots.map((root) =>
          join(root, "candidate-branches", branchName, "solver_impl.py")
        )
      };
    })
    .filter(Boolean);
  const checkpointCandidates = [
    candidateEvolution?.pendingCheckpoint,
    candidateEvolution?.lastCheckpoint
  ]
    .filter((checkpoint) => checkpoint?.substantiveMutation === true)
    .map((checkpoint) => {
      const branchName = basename(String(checkpoint?.branch || ""));
      if (!/^cycle-[0-9]{2,6}$/.test(branchName)) return null;
      return {
        selection: `checkpoint-${branchName}`,
        evidence: checkpoint?.candidateEvidence,
        paths: swarmRoots.map((root) =>
          join(root, "candidate-branches", branchName, "solver_impl.py")
        )
      };
    })
    .filter(Boolean);
  const candidates = [
    ...checkpointCandidates,
    {
      selection: "challenger",
      evidence: candidateEvolution?.challengerEvidence,
      paths: swarmRoots.map((root) => join(root, "challenger", "solver_impl.py"))
    },
    ...branchCandidates,
    {
      selection: "incumbent",
      evidence: candidateEvolution?.incumbentEvidence,
      paths: swarmRoots.map((root) => join(root, "incumbent", "solver_impl.py"))
    }
  ];
  for (const candidate of candidates) {
    if (
      candidate.evidence?.implementationPresent !== true
      || candidate.evidence?.implementationSyntaxValid !== true
      || candidate.evidence?.implementationSubstantive !== true
    ) {
      continue;
    }
    for (const path of candidate.paths) {
      if (!await isRegularFile(path)) continue;
      const contents = await readFile(path);
      if (contents.length === 0 || contents.length > 2_000_000) continue;
      const digest = createHash("sha256").update(contents).digest("hex");
      if (digest !== candidate.evidence.implementationSha256) continue;
      const blobDigest = await store.putBlob(contents);
      return {
        available: true,
        selection: candidate.selection,
        source: {
          ref: blobReference(blobDigest, `${candidate.selection}/solver_impl.py`),
          digest: blobDigest,
          bytes: contents.length
        },
        evidence: candidate.evidence
      };
    }
  }
  return { available: false, selection: "none", source: null, evidence: null };
}

async function findTrialResults(root) {
  const discovered = [];
  await walk(root, async (path, entry) => {
    if (!entry.isFile() || entry.name !== "result.json") return;
    const value = JSON.parse(await readFile(path, "utf8"));
    if (typeof value.task_name !== "string") return;
    discovered.push({ trialDirectory: resolve(path, ".."), result: value });
  });
  return discovered.sort((left, right) =>
    left.trialDirectory.localeCompare(right.trialDirectory)
  );
}

async function collectFiles(directory, accept, kind, store) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const references = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !accept(entry.name)) continue;
    references.push(await durableFileReference(join(directory, entry.name), kind, store));
  }
  return references;
}

async function collectTrajectorySummaries(directory, store) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const references = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.startsWith("trajectory") || !entry.name.endsWith(".json")) {
      continue;
    }
    const path = join(directory, entry.name);
    const summary = summarizeTrajectory(JSON.parse(await readFile(path, "utf8")));
    const contents = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
    const digest = await store.putBlob(contents);
    references.push({
      ref: blobReference(digest, `${entry.name}.summary`),
      kind: "trajectory-summary",
      status: "collected",
      digest
    });
  }
  return references;
}

async function collectTreeFiles(directory, kind, store) {
  const references = [];
  try {
    await walk(directory, async (path, entry) => {
      if (!entry.isFile()) return;
      references.push(await durableFileReference(
        path,
        kind,
        store,
        relative(directory, path)
      ));
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return references.sort((left, right) => left.ref.localeCompare(right.ref));
}

function summarizeTrajectory(input) {
  const steps = Array.isArray(input?.steps) ? input.steps : [];
  return {
    schema: "amos.sanitized-harbor-trajectory",
    version: 1,
    sourceSchemaVersion: String(input?.schema_version || "unknown"),
    sessionId: String(input?.session_id || ""),
    agent: {
      name: String(input?.agent?.name || "unknown"),
      version: String(input?.agent?.version || "unknown"),
      modelName: String(input?.agent?.model_name || "unknown")
    },
    steps: steps.map((step) => ({
      stepId: step.step_id ?? null,
      timestamp: step.timestamp ?? null,
      source: step.source ?? null,
      modelName: step.model_name ?? null,
      toolNames: Array.isArray(step.tool_calls)
        ? step.tool_calls.map((call) => String(call.function_name || "unknown"))
        : [],
      toolResultCount: Array.isArray(step.observation?.results)
        ? step.observation.results.length
        : 0,
      metrics: numericMetrics(step.metrics)
    })),
    finalMetrics: numericMetrics(input?.final_metrics),
    safeguards: {
      rawMessagesStored: false,
      rawReasoningStored: false,
      rawToolArgumentsStored: false,
      rawToolResultsStored: false,
      credentialsIncluded: false
    }
  };
}

function numericMetrics(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([, value]) =>
    typeof value === "number" && Number.isFinite(value)
  ));
}

async function normalizeArtifacts(manifest, trialDirectory, store) {
  const normalized = [];
  for (const [index, entry] of manifest.entries()) {
    const destination = entry.destination ? join(trialDirectory, entry.destination) : null;
    const digest = destination && await isRegularFile(destination)
      ? await store.putBlob(await readFile(destination))
      : null;
    normalized.push({
      ref: digest
        ? blobReference(digest, entry.destination || `artifact-${index + 1}`)
        : `manifest-entry:${String(index + 1).padStart(5, "0")}`,
      kind: safeId(entry.type || "artifact"),
      status: safeId(entry.status || "unknown"),
      digest
    });
  }
  return normalized;
}

function dedupeReferences(references) {
  const unique = new Map();
  for (const reference of references) {
    if (!unique.has(reference.ref)) unique.set(reference.ref, reference);
  }
  return [...unique.values()];
}

function curriculumSignals(result, ecology, failureCapsule = null) {
  const signals = [];
  const message = String(result.exception_info?.exception_message || "").toLowerCase();
  for (const role of [
    "interface-scanner",
    "data-scanner",
    "state-compiler",
    "solver-builder",
    "verifier",
    "repairer",
    "executor",
    "integrator"
  ]) {
    if (message.includes(role.replace("-", " ")) || message.includes(role)) signals.push(role);
  }
  if (message.includes("no progress") || message.includes("exhausted")) signals.push("no-progress");
  for (const assignment of ecology?.assignments || []) {
    if (assignment.status !== "completed" && assignment.role) signals.push(safeId(assignment.role));
  }
  if (result.verifier_result?.rewards?.reward === 0) signals.push("official-verifier-failure");
  for (const signal of failureCapsule?.repairSignals || []) signals.push(safeId(signal));
  return [...new Set(signals)].sort();
}

function shouldCompileFailureCapsule(result) {
  const reward = result.verifier_result?.rewards?.reward;
  return Boolean(result.exception_info) || !Number.isFinite(reward) || reward <= 0;
}

/**
 * Terminal-Bench production-planning is an Apache-2.0 development fixture.
 * Its failed executions may teach the organism policy, but the immutable
 * exclusion prevents reuse for evaluation. Adapter replay still fails closed
 * because errored/unverified episodes do not satisfy its stricter gates.
 */
function harborDataPolicy(taskName) {
  const normalizedTask = safeId(taskName);
  if (normalizedTask === "production-planning" || normalizedTask.endsWith("/production-planning")) {
    return {
      sourceClass: "public-benchmark",
      permittedUses: ["research", "training"],
      trainingApproved: true,
      contaminationTags: [
        "license:apache-2.0:terminal-bench-3.0.0-production-planning",
        "exclude-eval:terminal-bench-3.0.0:production-planning",
        "terminal-bench-3.0.0:production-planning"
      ]
    };
  }
  return {
    sourceClass: "public-benchmark",
    permittedUses: ["evaluation", "research"],
    trainingApproved: false,
    contaminationTags: [`terminal-bench-3.0.0:${normalizedTask}`]
  };
}

async function walk(directory, visit) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, visit);
    else await visit(path, entry);
  }
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function firstAvailableJson(paths) {
  for (const path of paths) {
    const value = await optionalJson(path);
    if (value !== null) return value;
  }
  return null;
}

async function durableFileReference(path, kind, store, label = basename(path)) {
  const contents = await readFile(path);
  const digest = await store.putBlob(contents);
  return {
    ref: blobReference(digest, label),
    kind,
    status: "collected",
    digest
  };
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function blobReference(digest, label) {
  return `blob:sha256:${digest}/${encodeURIComponent(String(label))}`;
}

function safeId(value) {
  const normalized = String(value).trim().replace(/[^A-Za-z0-9._:/-]+/g, "-");
  return normalized || "unknown";
}
