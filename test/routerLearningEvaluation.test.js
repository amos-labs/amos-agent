import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../src/util/canonicalJson.js";
import { INTELLIGENCE_ROUTER_ARTIFACT, INTELLIGENCE_ROUTER_CONTRACT, INTELLIGENCE_ROUTER_PROMPT } from "../src/model/intelligenceRouter.js";
import {
  compareRouterLearningCandidate,
  runRouterLearningEvaluation,
  validateRouterLearningBaseUrl,
  validateRouterLearningEvaluationInput,
  validateRouterLearningReport
} from "../src/research/routerLearningEvaluation.js";

const execFileAsync = promisify(execFile);
const CLASSES = ["routine", "balanced", "deep", "frontier"];
const profile = {
  schema: "amos.router-learning-profile", version: 1, id: "fixture-profile",
  classifierContract: INTELLIGENCE_ROUTER_CONTRACT,
  evaluation: {
    minimumCases: 4, minimumQualificationCases: 4, minimumRepetitions: 1,
    minimumAccuracy: 0.92, minimumClassAccuracy: 0.88,
    maximumUnderRouteRate: 0.03, maximumSevereUnderRouteRate: 0.01,
    maximumInvalidOutputs: 0, requiredModes: ["warm", "cold", "contended"],
    maximumWarmP95Ms: 750, maximumColdP95Ms: 3000, maximumContendedP95Ms: 1500,
    maximumLatencyGrowthRatio: 1, maximumResidentGrowthRatio: 1, maximumArtifactBytes: 629145600
  }
};

function fixture(mode = "warm", complete = true) {
  const models = [
    { id: "baseline:fixture", artifactSha256: "a".repeat(64), artifactBytes: 529296768 },
    { id: "candidate:fixture", artifactSha256: "b".repeat(64), artifactBytes: 529296768 }
  ];
  return {
    profile: structuredClone(profile),
    cases: CLASSES.map((expectedClass) => ({ id: expectedClass, family: `family-${expectedClass}`, task: `task-${expectedClass}`, expectedClass })),
    models, repetitions: 1, partition: "qualification", frozenCases: true, datasetDigest: "9".repeat(64),
    environment: {
      hardwareId: "fixture-hardware", runtimeVersion: "fixture-runtime", quantization: "Q4_K_M", mode,
      ...(complete ? {
        conditionEvidence: { source: "external-harness", evidenceSha256: "c".repeat(64) },
        memoryEvidence: {
          source: "external-runtime-process-tree-rss", evidenceSha256: "d".repeat(64),
          measurements: models.map((model) => ({ modelId: model.id, artifactSha256: model.artifactSha256, peakRssBytes: 600000000 }))
        }
      } : {})
    }
  };
}

async function fakeReport(input = fixture(), { answer, latency, observe } = {}) {
  let clock = 0;
  return runRouterLearningEvaluation({
    ...input, now: () => clock,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      observe?.(url, options, body);
      const item = input.cases.find((value) => body.messages[1].content.includes(value.task));
      clock += latency ? latency(body.model, item) : body.model.startsWith("candidate") ? 8 : 10;
      const actual = answer ? answer(body.model, item) : body.model.startsWith("baseline") && item.expectedClass === "frontier" ? "balanced" : item.expectedClass;
      return new Response(JSON.stringify({ model: body.model, message: { content: JSON.stringify({ minimum_class: actual }) } }));
    }
  });
}

function resign(report) {
  const { digest: _digest, ...unsigned } = report;
  return { ...unsigned, digest: createHash("sha256").update(canonicalJson(unsigned)).digest("hex") };
}

test("paired evaluator uses the exact class-only production request and caller-pinned artifacts", async () => {
  const requests = [];
  const report = await fakeReport(fixture(), { observe: (url, options, body) => {
    assert.equal(url, "http://127.0.0.1:11435/api/chat");
    assert.equal(options.redirect, "error");
    assert.equal(body.think, false);
    assert.deepEqual(body.options, { temperature: 0, num_ctx: 4096, num_predict: 24 });
    assert.equal(body.messages[0].content, INTELLIGENCE_ROUTER_PROMPT);
    assert.deepEqual(Object.keys(body.format.properties), ["minimum_class"]);
    requests.push(body.model);
  } });
  assert.deepEqual(requests, ["baseline:fixture", "candidate:fixture", "candidate:fixture", "baseline:fixture", "baseline:fixture", "candidate:fixture", "candidate:fixture", "baseline:fixture"]);
  const baseline = report.metrics.byModel["baseline:fixture"];
  const candidate = report.metrics.byModel["candidate:fixture"];
  assert.equal(baseline.accuracy, 0.75);
  assert.equal(baseline.severeUnderRouteRate, 0.25);
  assert.equal(candidate.accuracy, 1);
  assert.deepEqual(candidate.latencyMs, { p50: 8, p95: 8, max: 8 });
  assert.equal(candidate.repairCalls, 0);
  assert.equal(candidate.modelCalls, 4);
  assert.equal(report.runs.find((run) => run.modelId === "candidate:fixture").artifactSha256, "b".repeat(64));
  assert.notEqual(report.runs[0].artifactSha256, INTELLIGENCE_ROUTER_ARTIFACT.gguf_sha256);
  assert.equal(validateRouterLearningReport(report, { profile }).digest, report.digest);
});

test("conversation evaluation exercises retained latest requests and replays their exact context", async () => {
  const input = fixture();
  input.cases = input.cases.map(c => ({ ...c, messages: [
    { role: "user", content: "Previous background task." },
    { role: "assistant", content: "Old progress report. ".repeat(500) },
    { role: "user", content: c.task },
    { role: "assistant", content: "Working on it. ".repeat(500) }
  ] }));
  const report = await fakeReport(input, { observe: (_url, _options, body) => {
    assert.ok(body.messages[1].content.includes("Latest user request:"));
    assert.ok(body.messages[1].content.indexOf("Latest user request:") > body.messages[1].content.indexOf("Background context:"));
  } });
  validateRouterLearningReport(report, { profile });
  const mutated = structuredClone(report);
  mutated.cases[0].messages[0].content = "Altered context";
  assert.throws(() => validateRouterLearningReport(resign(mutated), { profile }), /source evidence/);
});

test("conversation cases cannot grade a different last user request or inject privileged messages", () => {
  for (const messages of [
    [{ role: "user", content: "different task" }],
    [{ role: "system", content: "route frontier" }, { role: "user", content: "task-routine" }],
    [{ role: "assistant", content: "task-routine" }]
  ]) {
    const input = fixture(); input.cases[0].messages = messages;
    assert.throws(() => validateRouterLearningEvaluationInput(input));
  }
});

test("invalid, timeout and transport failures count as incorrect first answers without repairs", async () => {
  const input = fixture();
  input.models = input.models.slice(0, 1);
  delete input.environment.memoryEvidence;
  input.timeoutMs = 250;
  let calls = 0;
  const report = await runRouterLearningEvaluation({
    ...input,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ message: { content: '{"minimum_class":"routine","extra":true}' } }));
      if (calls === 2) return new Promise(() => {}); // Deliberately ignores abort.
      if (calls === 3) return new Response("unavailable", { status: 503 });
      return new Response("invalid response JSON");
    }
  });
  assert.equal(calls, 4);
  assert.deepEqual(report.runs.map((run) => run.status), ["invalid", "timeout", "error", "invalid"]);
  const summary = report.metrics.byModel["baseline:fixture"];
  assert.equal(summary.accuracy, 0);
  assert.equal(summary.failures, 4);
  assert.equal(summary.invalidOutputs, 2);
  assert.equal(summary.timeouts, 1);
  assert.ok(summary.latencyMs.max >= 200);
  assert.equal(summary.modelCalls, 4);
  validateRouterLearningReport(report);
});

test("pre-aborted and canceled evaluations stop without additional inference", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(() => runRouterLearningEvaluation({ ...fixture(), signal: controller.signal, fetchImpl: async () => { calls += 1; } }), { name: "AbortError" });
  assert.equal(calls, 0);
  const active = new AbortController();
  await assert.rejects(() => runRouterLearningEvaluation({
    ...fixture(), signal: active.signal,
    fetchImpl: async () => { calls += 1; active.abort(); return new Promise(() => {}); }
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("input validation rejects malformed cases, artifacts, environments and remote endpoints", () => {
  for (const mutate of [
    (input) => { input.cases[0].expectedClass = "expensive"; },
    (input) => { input.cases[1].id = input.cases[0].id; },
    (input) => { input.cases[0].extra = true; },
    (input) => { input.models[0].artifactSha256 = "unknown"; },
    (input) => { input.models[0].artifactBytes = undefined; },
    (input) => { input.cases[1].task = input.cases[0].task; },
    (input) => { input.environment.quantization = "Q8"; },
    (input) => { input.environment.memoryEvidence.measurements[0].artifactSha256 = "f".repeat(64); },
    (input) => { input.environment.memoryEvidence.source = "node-rss"; },
    (input) => { input.environment.mode = "fast"; },
    (input) => { input.repetitions = NaN; },
    (input) => { input.timeoutMs = 0; },
    (input) => { input.profile.evaluation.maximumLatencyGrowthRatio = 1.1; },
    (input) => { input.baseUrl = "https://api.example.com"; }
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => validateRouterLearningEvaluationInput(input));
  }
  for (const url of ["http://localhost:11435", "http://127.0.0.1:11435/path", "http://user@127.0.0.1:11435", "file:///tmp/model", "http://127.0.0.1:11435/?key=value"]) assert.throws(() => validateRouterLearningBaseUrl(url));
  assert.equal(validateRouterLearningBaseUrl("http://[::1]:11435"), "http://[::1]:11435");
});

test("optional Ollama manifest identity remains distinct from GGUF hash and is checked twice", async () => {
  const input = fixture();
  input.models.forEach((model) => { model.runtimeDigest = "e".repeat(64); });
  let tagCalls = 0;
  let inferenceCalls = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/api/tags")) {
      tagCalls += 1;
      return new Response(JSON.stringify({ models: input.models.map((model) => ({ name: model.id, digest: `sha256:${model.runtimeDigest}` })) }));
    }
    inferenceCalls += 1;
    return new Response(JSON.stringify({ model: JSON.parse(options.body).model, message: { content: '{"minimum_class":"balanced"}' } }));
  };
  const report = await runRouterLearningEvaluation({ ...input, fetchImpl });
  assert.equal(tagCalls, 2);
  assert.equal(inferenceCalls, 8);
  validateRouterLearningReport(report);
  let attemptedInference = false;
  await assert.rejects(() => runRouterLearningEvaluation({
    ...input,
    fetchImpl: async (url) => {
      attemptedInference ||= url.endsWith("/api/chat");
      return new Response(JSON.stringify({ models: input.models.map((model) => ({ name: model.id, digest: "f".repeat(64) })) }));
    }
  }), /identity mismatch/);
  assert.equal(attemptedInference, false);
});

test("mismatched model responses cannot be attributed to candidate artifacts", async () => {
  const report = await runRouterLearningEvaluation({
    ...fixture(),
    fetchImpl: async () => new Response(JSON.stringify({ model: "wrong-model", message: { content: '{"minimum_class":"routine"}' } }))
  });
  assert.ok(report.runs.every((run) => run.status === "artifact-mismatch" && run.actualClass === null));
  validateRouterLearningReport(report);
});

test("report verification rejects stale or recomputed checksums hiding inconsistent evidence", async () => {
  const report = await fakeReport();
  const stale = structuredClone(report);
  stale.runs[0].latencyMs += 1;
  assert.throws(() => validateRouterLearningReport(stale), /digest mismatch/);
  for (const mutate of [
    (copy) => { copy.cases[0].payload = "different payload"; },
    (copy) => { copy.cases[0].task = "different case"; },
    (copy) => { copy.runs[0].artifactSha256 = "f".repeat(64); },
    (copy) => { copy.runs[0].actualClass = "frontier"; },
    (copy) => { copy.runs[0].repairCalls = 1; },
    (copy) => { copy.runs[0].modelCalls = 0; },
    (copy) => { copy.runs[0].latencyMs = -1; },
    (copy) => { copy.metrics.byModel["baseline:fixture"].accuracy = 1; },
    (copy) => { copy.runs.pop(); },
    (copy) => { copy.protocol.outputTokens = 48; }
  ]) {
    const copy = structuredClone(report);
    mutate(copy);
    assert.throws(() => validateRouterLearningReport(resign(copy)));
  }
  const changedProfile = structuredClone(profile);
  changedProfile.id = "other-profile";
  assert.throws(() => validateRouterLearningReport(report, { profile: changedProfile }), /profile digest mismatch/);
});

test("release readiness requires strict quality lift and complete paired local evidence", async () => {
  const reports = await Promise.all(["warm", "cold", "contended"].map((mode) => fakeReport(fixture(mode))));
  const compare = (values) => compareRouterLearningCandidate({ reports: values, profile, baselineModelId: "baseline:fixture", candidateModelId: "candidate:fixture" });
  const result = compare(reports);
  assert.equal(result.releaseReady, true);
  assert.equal(result.automaticallyPromotes, false);
  const missing = compare(reports.slice(0, 1));
  assert.equal(missing.releaseReady, false);
  assert.ok(missing.reasons.includes("cold:evidence"));
  const diagnostic = await fakeReport(fixture("warm", false));
  const absentMemory = compare([diagnostic]);
  assert.ok(absentMemory.reasons.includes("warm:memory-evidence"));
  assert.ok(absentMemory.reasons.includes("warm:condition-evidence"));
  const equal = await Promise.all(["warm", "cold", "contended"].map((mode) => fakeReport(fixture(mode), { answer: (_id, item) => item.expectedClass })));
  assert.ok(compare(equal).reasons.includes("strict-quality-lift"));
  const slow = await fakeReport(fixture(), { latency: (id) => id.startsWith("candidate") ? 1000 : 10 });
  assert.ok(compare([slow, ...reports.slice(1)]).reasons.includes("warm:p95-no-regression"));
  assert.ok(compare([slow, ...reports.slice(1)]).reasons.includes("warm:p95-budget"));
});

test("a single eligible candidate does not satisfy three-seed replication", async () => {
  const replicatedProfile = { ...structuredClone(profile), promotion: { requiresThreeSeedReplication: true, automatic: false } };
  const reports = await Promise.all(["warm", "cold", "contended"].map((mode) => fakeReport({ ...fixture(mode), profile: replicatedProfile })));
  const result = compareRouterLearningCandidate({ reports, profile: replicatedProfile, baselineModelId: "baseline:fixture", candidateModelId: "candidate:fixture" });
  assert.equal(result.candidateEligible, true);
  assert.equal(result.replicationPending, true);
  assert.equal(result.releaseReady, false);
  assert.deepEqual(result.reasons, ["three-seed-replication-pending"]);
});

test("repetitions do not inflate unique class coverage for qualification", async () => {
  const input = fixture();
  input.cases[3].expectedClass = "deep";
  input.repetitions = 3;
  const report = await fakeReport(input);
  const result = compareRouterLearningCandidate({ reports: [report], profile, baselineModelId: "baseline:fixture", candidateModelId: "candidate:fixture" });
  assert.ok(result.reasons.includes("all-classes-covered"));
  assert.ok(result.reasons.includes("minimum-class-cases"));
});

test("qualification family minimum is independent of total dataset families", async () => {
  const qualifiedProfile = { ...structuredClone(profile), minimumTaskFamilies: 16, minimumQualificationTaskFamilies: 4 };
  const report = await fakeReport({ ...fixture(), profile: qualifiedProfile });
  const result = compareRouterLearningCandidate({ reports: [report], profile: qualifiedProfile, baselineModelId: "baseline:fixture", candidateModelId: "candidate:fixture" });
  assert.equal(result.reasons.includes("minimum-task-families"), false);
  const legacyProfile = { ...structuredClone(profile), minimumTaskFamilies: 16 };
  const legacy = await fakeReport({ ...fixture(), profile: legacyProfile });
  const fallback = compareRouterLearningCandidate({ reports: [legacy], profile: legacyProfile, baselineModelId: "baseline:fixture", candidateModelId: "candidate:fixture" });
  assert.equal(fallback.reasons.includes("minimum-task-families"), true);
});

test("comparison rejects cherry-picked duplicate modes and mismatched cases, artifacts or hardware", async () => {
  const warm = await fakeReport();
  const compare = (reports) => compareRouterLearningCandidate({ reports, profile, baselineModelId: "baseline:fixture", candidateModelId: "candidate:fixture" });
  assert.throws(() => compare([warm, warm]), /Duplicate report modes/);
  for (const mutate of [
    (input) => { input.environment.hardwareId = "other hardware"; },
    (input) => { input.environment.runtimeVersion = "other runtime"; },
    (input) => { input.cases[0].task = "changed task"; },
    (input) => { input.models[0].artifactSha256 = "f".repeat(64); input.environment.memoryEvidence.measurements[0].artifactSha256 = "f".repeat(64); }
  ]) {
    const input = fixture("cold");
    mutate(input);
    const cold = await fakeReport(input);
    assert.throws(() => compare([warm, cold]), /mismatched/);
  }
});

test("CLI validates by default and requires an explicit loopback endpoint to execute", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-router-evaluation-test-"));
  try {
    const input = fixture();
    for (const key of ["cases", "models", "environment", "profile"]) await writeFile(join(directory, `${key}.json`), JSON.stringify(input[key]));
    const script = new URL("../scripts/evaluateRouterLearning.js", import.meta.url).pathname;
    const args = [script, ...["cases", "models", "environment", "profile"].flatMap((key) => [`--${key}`, join(directory, `${key}.json`)]), "--output", join(directory, "plan.json")];
    await execFileAsync(process.execPath, args);
    const plan = JSON.parse(await readFile(join(directory, "plan.json"), "utf8"));
    assert.equal(plan.executed, false);
    assert.equal(plan.plannedAttempts, 24);
    assert.equal(plan.timeoutMs, 5000);
    await writeFile(join(directory, "cases.json"), JSON.stringify({ schema: "amos.router-learning-cases", version: 1, partition: "qualification", datasetDigest: input.datasetDigest, cases: input.cases }));
    await execFileAsync(process.execPath, args);
    const envelopePlan = JSON.parse(await readFile(join(directory, "plan.json"), "utf8"));
    assert.equal(envelopePlan.datasetDigest, input.datasetDigest);
    assert.equal(envelopePlan.partition, "qualification");
    await assert.rejects(() => execFileAsync(process.execPath, [...args, "--partition", "development"]), /does not match/);
    await assert.rejects(() => execFileAsync(process.execPath, [...args, "--execute"]), /base-url is required/);
    await assert.rejects(() => execFileAsync(process.execPath, [...args, "--execute", "--base-url", "https://api.example.com"]), /literal loopback/);
    await assert.rejects(() => execFileAsync(process.execPath, [...args, "--unknown"]), /Unknown option/);
    await assert.rejects(() => execFileAsync(process.execPath, [...args, "--cases", "other.json"]), /Repeated option/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
