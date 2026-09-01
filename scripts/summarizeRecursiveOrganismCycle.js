#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { openSwarmLearningStore } from "../src/research/swarmLearningStore.js";

const args = process.argv.slice(2);
const root = resolve(requiredOption("--root"));
const storePath = resolve(requiredOption("--store"));
const output = resolve(requiredOption("--output"));
const store = await openSwarmLearningStore(storePath);
const episodes = await store.listEpisodes();
const resultPaths = await findFiles(root, "result.json");
const iterations = [];
for (const path of resultPaths) {
  const result = JSON.parse(await readFile(path, "utf8"));
  if (typeof result.task_name !== "string") continue;
  const episodeId = `harbor-${safeId(result.id || path.split("/").at(-2))}`;
  const episode = episodes.find(({ id }) => id === episodeId) || null;
  const ecology = episode?.ecology?.digest
    ? JSON.parse(await store.readBlob(episode.ecology.digest))
    : null;
  const capsuleReference = episode?.traces?.find(({ kind }) => kind === "failure-capsule");
  const capsule = capsuleReference?.digest
    ? JSON.parse(await store.readBlob(capsuleReference.digest))
    : null;
  const assignments = ecology?.assignments || [];
  iterations.push({
    resultPath: path,
    runId: String(result.id || "unknown"),
    task: result.task_name,
    outcome: episode?.outcome || null,
    verifier: episode?.verifier || null,
    agentVersion: episode?.model?.agentVersion || null,
    durationSeconds: durationSeconds(result.started_at, result.finished_at || result.updated_at),
    completedAssignments: assignments.filter(({ status }) => status === "completed").length,
    totalAssignments: assignments.length,
    terminalRole: assignments.at(-1)?.role || null,
    repairSignals: capsule?.repairSignals || [],
    failureCapsuleDigest: capsule?.digest || null,
    holographicWorld: capsule?.holographicWorld || summarizeHrr(ecology)
  });
}
iterations.sort((left, right) => left.resultPath.localeCompare(right.resultPath));
const hrrExperimentPath = (await findFiles(root, "hrr-dual-channel.json")).at(0);
const hrrExperiment = hrrExperimentPath
  ? JSON.parse(await readFile(hrrExperimentPath, "utf8"))
  : null;
const reportBase = {
  schema: "amos.swarm-organism-recursive-cycle-report",
  version: 1,
  generatedAt: new Date().toISOString(),
  root,
  iterations,
  comparison: compare(iterations),
  holographicWorldGate: {
    included: true,
    architecture: "dual-channel-hrr",
    staticExperimentPassed: hrrExperiment?.gate?.passed === true,
    liveSnapshotCount: iterations.reduce(
      (total, iteration) => total + Number(iteration.holographicWorld?.snapshotCount || 0),
      0
    ),
    maximumAuthorityLeakRate: Math.max(
      0,
      ...iterations.map((iteration) => Number(iteration.holographicWorld?.authorityLeakRate || 0))
    ),
    behaviorInfluence: iterations.some(
      (iteration) => iteration.holographicWorld?.behaviorInfluence === true
    ),
    authorityEnabled: false,
    requiredNextGate: iterations.some(
      (iteration) => iteration.holographicWorld?.behaviorInfluence === true
    ) ? "real-qwen-active-utility" : "development-shadow-utility"
  },
  governance: {
    developmentOnly: true,
    evaluationExclusionsEnforced: true,
    productionPolicyPromoted: false,
    modelWeightsChanged: false
  }
};
const report = { ...reportBase, digest: digestResearchValue(reportBase) };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  iterations: iterations.length,
  comparison: report.comparison,
  holographicWorldGate: report.holographicWorldGate,
  digest: report.digest
}, null, 2));

function compare(values) {
  if (values.length < 2) return { status: "insufficient-iterations" };
  const first = values[0];
  const last = values.at(-1);
  return {
    status: "observed-not-promotional",
    verifierScoreDelta: Number(last.verifier?.score || 0) - Number(first.verifier?.score || 0),
    completedAssignmentDelta: last.completedAssignments - first.completedAssignments,
    durationSecondsDelta: last.durationSeconds - first.durationSeconds,
    reachedVerifierInFinalIteration: last.verifier?.status !== "not-run",
    failureSignalsRemoved: first.repairSignals.filter((signal) => !last.repairSignals.includes(signal)),
    failureSignalsRemaining: last.repairSignals
  };
}

function summarizeHrr(ecology) {
  const world = ecology?.dualChannelWorld ?? ecology?.dualChannelShadow;
  const snapshots = world?.snapshots || [];
  const active = world?.mode === "bounded-active-retrieval" &&
    world?.behaviorInfluence === true;
  return {
    mode: active ? "bounded-active-retrieval" : "read-only-shadow",
    snapshotCount: snapshots.length,
    authorityLeakRate: average(snapshots.map(({ authorityLeakRate }) => authorityLeakRate)),
    exactFalsePositiveRate: average(snapshots.map(({ exactFalsePositiveRate }) => exactFalsePositiveRate)),
    exactPositiveRate: average(snapshots.map(({ exactPositiveRate }) => exactPositiveRate)),
    behaviorInfluence: active,
    authorityEnabled: false
  };
}

async function findFiles(directory, name) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return found;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await findFiles(path, name));
    else if (entry.name === name && (await stat(path)).isFile()) found.push(path);
  }
  return found.sort();
}

function durationSeconds(startedAt, finishedAt) {
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(finish)
    ? Math.max(0, (finish - start) / 1_000)
    : 0;
}

function average(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length === 0 ? 0 : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function safeId(value) {
  return String(value).trim().replace(/[^A-Za-z0-9._:/-]+/g, "-") || "unknown";
}

function requiredOption(name) {
  const index = args.indexOf(name);
  const value = index === -1 ? null : args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}
