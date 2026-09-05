import { createHash } from "node:crypto";
import { canonicalJson } from "../util/canonicalJson.js";
import {
  INTELLIGENCE_ROUTER_CLASSES,
  INTELLIGENCE_ROUTER_CONTRACT,
  INTELLIGENCE_ROUTER_FORMAT,
  INTELLIGENCE_ROUTER_PROMPT,
  intelligenceRouterPayload,
  LocalIntelligenceRouter,
  parseIntelligenceRouterOutput
} from "../model/intelligenceRouter.js";

export const ROUTER_LEARNING_EVALUATION_SCHEMA = "amos.router-learning-evaluation";
const MODES = ["warm", "cold", "contended"];
const CLASSES = INTELLIGENCE_ROUTER_CLASSES;
const HASH = /^[a-f0-9]{64}$/;
const PROTOCOL = Object.freeze({
  classifierContract: INTELLIGENCE_ROUTER_CONTRACT,
  inputContract: "amos-router-task-wrapper-v1",
  outputFormat: "json",
  promptSha256: textDigest(INTELLIGENCE_ROUTER_PROMPT),
  formatSha256: digest(INTELLIGENCE_ROUTER_FORMAT),
  contextTokens: 4096,
  outputTokens: 24,
  thinking: false,
  temperature: 0,
  classificationCallsPerAttempt: 1,
  repairCalls: 0
});

export function validateRouterLearningBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Router evaluation requires an explicit literal loopback HTTP(S) origin");
  }
  return url.origin;
}

/** Validate without making any requests. Artifact hashes are caller-pinned GGUF
 * identities; optional runtimeDigest is a separate Ollama manifest identity. */
export function validateRouterLearningEvaluationInput({
  cases, models, environment, repetitions = 3, baseUrl = "http://127.0.0.1:11435",
  timeoutMs = 5000, profile = null, partition = "development", frozenCases = false,
  datasetDigest = null
} = {}) {
  assertArray(cases, "cases", 1, 10000);
  assertArray(models, "models", 1, 8);
  integer(repetitions, "repetitions", 1, 100);
  integer(timeoutMs, "timeoutMs", 250, 60000);
  if (cases.length * models.length * repetitions > 100000) throw new Error("Evaluation exceeds 100000 attempts");
  if (!["development", "qualification"].includes(partition)) throw new Error("Invalid evaluation partition");
  if (typeof frozenCases !== "boolean") throw new Error("frozenCases must be boolean");
  if (datasetDigest !== null) sha(datasetDigest, "datasetDigest");
  const normalizedCases = cases.map((item) => {
    exact(item, ["id", "family", "task", "expectedClass"], ["messages"], "case");
    nonempty(item.id, "case.id", 200);
    nonempty(item.family, "case.family", 200);
    nonempty(item.task, "case.task", 100000);
    if (!CLASSES.includes(item.expectedClass)) throw new Error(`Unknown expectedClass for ${item.id}`);
    if (item.messages !== undefined) {
      assertArray(item.messages, "case.messages", 1, 100);
      for (const message of item.messages) {
        exact(message, ["role", "content"], [], "case.message");
        if (!["user", "assistant"].includes(message.role)) throw new Error("Evaluation conversation supports only user and assistant text");
        nonempty(message.content, "case.message.content", 100000);
      }
      if (!item.messages.some(m => m.role === "user")) throw new Error("Evaluation conversation needs a user task");
      if (item.messages.findLast(m => m.role === "user").content !== item.task) throw new Error("Case task must equal the latest user request");
    }
    const payload = intelligenceRouterPayload({ messages: item.messages ?? [{ role: "user", content: item.task }] });
    return { ...item, payload, payloadSha256: textDigest(payload) };
  });
  unique(normalizedCases.map((item) => item.id), "case IDs");
  unique(normalizedCases.map((item) => item.payloadSha256), "rendered task payloads");
  const normalizedModels = models.map((model) => {
    exact(model, ["id", "artifactSha256"], ["runtimeDigest", "artifactBytes"], "model");
    nonempty(model.id, "model.id", 200);
    sha(model.artifactSha256, "model.artifactSha256");
    if (model.runtimeDigest !== undefined) sha(model.runtimeDigest, "model.runtimeDigest");
    if (model.artifactBytes !== undefined) integer(model.artifactBytes, "model.artifactBytes", 1, Number.MAX_SAFE_INTEGER);
    return { ...model };
  });
  unique(normalizedModels.map((item) => item.id), "model IDs");
  const normalizedEnvironment = validateEnvironment(environment, normalizedModels);
  if (profile !== null) validateProfile(profile);
  const plan = {
    protocol: { ...PROTOCOL },
    profileId: profile?.id ?? null,
    profileDigest: profile ? digest(profile) : null,
    cases: normalizedCases,
    casesDigest: digest(normalizedCases),
    models: normalizedModels,
    environment: normalizedEnvironment,
    environmentDigest: digest(normalizedEnvironment),
    repetitions, timeoutMs, baseUrl: validateRouterLearningBaseUrl(baseUrl), partition, frozenCases, datasetDigest
  };
  digest(plan);
  return plan;
}

/** Executes only the production class-only router, serially and in rotated
 * paired order. Environment preparation and process-tree RSS collection belong
 * to an external harness: merely labelling a run "cold" is not qualification. */
export async function runRouterLearningEvaluation({
  fetchImpl = globalThis.fetch, signal = null, now = () => performance.now(),
  ...input
} = {}) {
  const plan = validateRouterLearningEvaluationInput(input);
  if (typeof fetchImpl !== "function" || typeof now !== "function") throw new Error("Invalid evaluator transport or clock");
  checkAbort(signal);
  await verifyRuntimeIdentities(plan, fetchImpl, signal);
  const runs = [];
  for (const attempt of attemptOrder(plan)) {
    checkAbort(signal);
    const { model, item, repetition } = attempt;
    let responseContent = null;
    let status = "ok";
    let error = null;
    let actualClass = null;
    let calls = 0;
    const startedAt = now();
    const router = new LocalIntelligenceRouter({
      model: model.id, baseUrl: plan.baseUrl, timeoutMs: plan.timeoutMs,
      fetchImpl: async (url, options) => {
        checkAbort(signal);
        if (++calls !== 1 || url !== `${plan.baseUrl}/api/chat`) throw new Error("Evaluator attempted an unexpected request");
        const body = JSON.parse(options.body);
        const expected = {
          model: model.id, stream: false, think: false, format: INTELLIGENCE_ROUTER_FORMAT,
          keep_alive: "10m", options: { temperature: 0, num_ctx: 4096, num_predict: 24 },
          messages: [{ role: "system", content: INTELLIGENCE_ROUTER_PROMPT }, { role: "user", content: item.payload }]
        };
        if (canonicalJson(body) !== canonicalJson(expected)) throw new Error("Production router request no longer matches the frozen evaluation protocol");
        const response = await abortable(() => fetchImpl(url, { ...options, redirect: "error" }), options.signal);
        if (!response || typeof response.ok !== "boolean") throw new Error("Invalid router HTTP response");
        if (response.url && new URL(response.url).origin !== plan.baseUrl) throw new Error("Router response left the selected local origin");
        if (!response.ok) return response;
        return {
          ok: true,
          async json() {
            let payload;
            try {
              payload = await abortable(() => response.json(), options.signal);
            } catch (failure) {
              if (failure.name !== "AbortError") status = "invalid";
              throw failure;
            }
            if (payload?.model !== undefined && payload.model !== model.id) {
              status = "artifact-mismatch";
              throw new Error("Router response model does not match the pinned candidate");
            }
            if (typeof payload?.message?.content !== "string" || payload.message.content.length > 16384) {
              status = "invalid";
              throw new Error("Router response content is missing or oversized");
            }
            responseContent = payload.message.content;
            try { parseIntelligenceRouterOutput(responseContent); }
            catch (failure) { status = "invalid"; throw failure; }
            return payload;
          }
        };
      }
    });
    try {
      const answer = await router.classify({ messages: item.messages ?? [{ role: "user", content: item.task }], signal });
      // LocalIntelligenceRouter currently returns the installed champion's hash
      // even for another model ID. Never use that return value as provenance.
      actualClass = answer.minimumClass;
    } catch (failure) {
      checkAbort(signal);
      if (status === "ok") status = /timed out|abort/i.test(failure?.message || "") ? "timeout" : "error";
      error = String(failure?.message || failure).slice(0, 2000);
    }
    const latencyMs = now() - startedAt;
    finite(latencyMs, "measured latencyMs");
    runs.push({
      index: runs.length, pairId: `${repetition}:${item.id}`, repetition,
      caseId: item.id, payloadSha256: item.payloadSha256,
      modelId: model.id, artifactSha256: model.artifactSha256,
      expectedClass: item.expectedClass, actualClass, responseContent,
      status, error, latencyMs, modelCalls: calls, repairCalls: 0,
      ...outcome(item.expectedClass, actualClass)
    });
  }
  await verifyRuntimeIdentities(plan, fetchImpl, signal);
  const report = {
    schema: ROUTER_LEARNING_EVALUATION_SCHEMA, version: 1,
    generatedAt: new Date().toISOString(), ...plan, runs,
    metrics: summarize(plan, runs),
    interpretation: { measuredLocalInference: true, conditionsExternallyProvided: true, cryptographicAttestation: false, automaticallyPromotes: false }
  };
  return { ...report, digest: digest(report) };
}

/** A digest protects consistency, not evaluator authenticity. This verifier
 * reconstructs payloads, pairing, outcome flags and metrics from raw runs. */
export function validateRouterLearningReport(report, { profile = null } = {}) {
  exact(report, ["schema", "version", "generatedAt", "protocol", "profileId", "profileDigest", "cases", "casesDigest", "models", "environment", "environmentDigest", "repetitions", "timeoutMs", "baseUrl", "partition", "frozenCases", "datasetDigest", "runs", "metrics", "interpretation", "digest"], [], "report");
  if (report.schema !== ROUTER_LEARNING_EVALUATION_SCHEMA || report.version !== 1) throw new Error("Unsupported router evaluation report");
  sha(report.digest, "report.digest");
  const { digest: suppliedDigest, ...unsigned } = report;
  if (digest(unsigned) !== suppliedDigest) throw new Error("Report digest mismatch");
  if (typeof report.generatedAt !== "string" || !Number.isFinite(Date.parse(report.generatedAt))) throw new Error("Invalid report timestamp");
  assertArray(report.cases, "report.cases", 1, 10000);
  const cases = report.cases.map((item) => {
    exact(item, ["id", "family", "task", "expectedClass", "payload", "payloadSha256"], ["messages"], "report.case");
    return { id: item.id, family: item.family, task: item.task, expectedClass: item.expectedClass, ...(item.messages ? { messages: item.messages } : {}) };
  });
  const plan = validateRouterLearningEvaluationInput({ ...report, cases, profile });
  for (const key of ["protocol", "cases", "casesDigest", "models", "environment", "environmentDigest", "repetitions", "timeoutMs", "baseUrl", "partition", "frozenCases", "datasetDigest"]) {
    if (canonicalJson(plan[key]) !== canonicalJson(report[key])) throw new Error(`Report ${key} does not match its source evidence`);
  }
  if (profile !== null && (plan.profileId !== report.profileId || plan.profileDigest !== report.profileDigest)) throw new Error("Report profile digest mismatch");
  if ((report.profileId === null) !== (report.profileDigest === null)) throw new Error("Incomplete report profile binding");
  if (report.profileDigest !== null) {
    sha(report.profileDigest, "report.profileDigest");
    nonempty(report.profileId, "report.profileId", 200);
  }
  if (canonicalJson(report.interpretation) !== canonicalJson({ measuredLocalInference: true, conditionsExternallyProvided: true, cryptographicAttestation: false, automaticallyPromotes: false })) throw new Error("Invalid report interpretation");
  const order = [...attemptOrder(plan)];
  assertArray(report.runs, "report.runs", order.length, order.length);
  report.runs.forEach((run, index) => {
    exact(run, ["index", "pairId", "repetition", "caseId", "payloadSha256", "modelId", "artifactSha256", "expectedClass", "actualClass", "responseContent", "status", "error", "latencyMs", "modelCalls", "repairCalls", "correct", "underRoute", "severeUnderRoute"], [], "run");
    const { model, item, repetition } = order[index];
    const expected = { index, pairId: `${repetition}:${item.id}`, repetition, caseId: item.id, payloadSha256: item.payloadSha256, modelId: model.id, artifactSha256: model.artifactSha256, expectedClass: item.expectedClass, modelCalls: 1, repairCalls: 0 };
    for (const [key, value] of Object.entries(expected)) if (run[key] !== value) throw new Error(`Run ${index} ${key} mismatch`);
    finite(run.latencyMs, "run.latencyMs");
    if (!["ok", "invalid", "timeout", "error", "artifact-mismatch"].includes(run.status)) throw new Error("Invalid run status");
    if (run.responseContent !== null && (typeof run.responseContent !== "string" || run.responseContent.length > 16384)) throw new Error("Invalid raw response content");
    if (run.status === "ok") {
      if (run.actualClass !== parseIntelligenceRouterOutput(run.responseContent) || run.error !== null) throw new Error("Run answer does not match its first response");
    } else {
      if (run.actualClass !== null) throw new Error("Failed runs cannot contain repaired answers");
      nonempty(run.error, "run.error", 2000);
    }
    for (const [key, value] of Object.entries(outcome(run.expectedClass, run.actualClass))) {
      if (run[key] !== value) throw new Error(`Run ${key} mismatch`);
    }
  });
  if (canonicalJson(summarize(plan, report.runs)) !== canonicalJson(report.metrics)) throw new Error("Report metrics do not match raw runs");
  return report;
}

/** A release-readiness recommendation only. External hardware evidence and a
 * frozen qualification set must be reviewed independently of this checksum. */
export function compareRouterLearningCandidate({ reports, profile, baselineModelId, candidateModelId } = {}) {
  validateProfile(profile);
  assertArray(reports, "reports", 1, MODES.length);
  if (baselineModelId === candidateModelId) throw new Error("Baseline and candidate must differ");
  const validated = reports.map((report) => validateRouterLearningReport(report, { profile }));
  unique(validated.map((report) => report.environment.mode), "report modes");
  const first = validated[0];
  const limits = profile.evaluation;
  const reasons = [];
  const checks = [];
  const gate = (name, pass) => { checks.push({ name, passed: Boolean(pass) }); if (!pass) reasons.push(name); };
  for (const report of validated) {
    for (const key of ["casesDigest", "profileDigest", "partition", "repetitions", "timeoutMs", "datasetDigest"]) {
      if (report[key] !== first[key]) throw new Error(`Paired reports have mismatched ${key}`);
    }
    for (const key of ["hardwareId", "runtimeVersion", "quantization"]) {
      if (report.environment[key] !== first.environment[key]) throw new Error(`Paired reports have mismatched environment.${key}`);
    }
    for (const id of [baselineModelId, candidateModelId]) {
      const model = report.models.find((item) => item.id === id);
      const reference = first.models.find((item) => item.id === id);
      if (!model || !reference) throw new Error("Every report must contain the exact baseline and candidate");
      if (canonicalJson(model) !== canonicalJson(reference)) throw new Error("Paired reports have mismatched artifact provenance");
    }
  }
  gate("qualification-partition", first.partition === "qualification");
  gate("frozen-cases", validated.every((report) => report.frozenCases));
  gate("dataset-binding", first.datasetDigest !== null);
  gate("minimum-cases", first.cases.length >= limits.minimumCases);
  gate("minimum-qualification-cases", first.cases.length >= limits.minimumQualificationCases);
  gate("minimum-repetitions", first.repetitions >= limits.minimumRepetitions);
  gate("all-classes-covered", CLASSES.every((value) => first.cases.some((item) => item.expectedClass === value)));
  gate("minimum-class-cases", CLASSES.every((value) => first.cases.filter((item) => item.expectedClass === value).length >= Math.ceil(limits.minimumQualificationCases / CLASSES.length)));
  const minimumQualificationFamilies = profile.minimumQualificationTaskFamilies ?? profile.minimumTaskFamilies;
  if (minimumQualificationFamilies !== undefined) gate("minimum-task-families", new Set(first.cases.map((item) => item.family)).size >= minimumQualificationFamilies);
  for (const mode of limits.requiredModes) gate(`${mode}:evidence`, validated.some((report) => report.environment.mode === mode));
  let baselineCorrect = 0;
  let candidateCorrect = 0;
  for (const report of validated) {
    const mode = report.environment.mode;
    const baseline = report.metrics.byModel[baselineModelId];
    const candidate = report.metrics.byModel[candidateModelId];
    baselineCorrect += baseline.correct;
    candidateCorrect += candidate.correct;
    gate(`${mode}:condition-evidence`, Boolean(report.environment.conditionEvidence));
    gate(`${mode}:accuracy`, candidate.accuracy >= limits.minimumAccuracy && candidate.accuracy >= baseline.accuracy);
    gate(`${mode}:per-class-accuracy`, CLASSES.every((value) => candidate.byClass[value].accuracy !== null && candidate.byClass[value].accuracy >= limits.minimumClassAccuracy && candidate.byClass[value].accuracy >= baseline.byClass[value].accuracy));
    gate(`${mode}:under-routing`, candidate.underRouteRate <= limits.maximumUnderRouteRate && candidate.underRouteRate <= baseline.underRouteRate);
    gate(`${mode}:severe-under-routing`, candidate.severeUnderRouteRate <= limits.maximumSevereUnderRouteRate && candidate.severeUnderRouteRate <= baseline.severeUnderRouteRate);
    gate(`${mode}:first-answer-failures`, candidate.failures === 0 && candidate.invalidOutputs <= limits.maximumInvalidOutputs);
    const maximum = limits[`maximum${mode[0].toUpperCase()}${mode.slice(1)}P95Ms`];
    gate(`${mode}:p95-budget`, candidate.latencyMs.p95 <= maximum);
    gate(`${mode}:p95-no-regression`, candidate.latencyMs.p95 <= baseline.latencyMs.p95 * limits.maximumLatencyGrowthRatio);
    const memories = report.environment.memoryEvidence?.measurements || [];
    const baselineMemory = memories.find((item) => item.modelId === baselineModelId);
    const candidateMemory = memories.find((item) => item.modelId === candidateModelId);
    gate(`${mode}:memory-evidence`, Boolean(baselineMemory && candidateMemory));
    gate(`${mode}:memory-no-regression`, Boolean(baselineMemory && candidateMemory && candidateMemory.peakRssBytes <= baselineMemory.peakRssBytes * limits.maximumResidentGrowthRatio));
  }
  gate("strict-quality-lift", candidateCorrect > baselineCorrect);
  const candidate = first.models.find((item) => item.id === candidateModelId);
  gate("artifact-size", candidate.artifactBytes !== undefined && candidate.artifactBytes <= limits.maximumArtifactBytes);
  const candidateEligible = reasons.length === 0;
  const replicationPending = profile.promotion?.requiresThreeSeedReplication === true;
  if (replicationPending) gate("three-seed-replication-pending", false);
  const result = {
    schema: "amos.router-learning-comparison", version: 1,
    baselineModelId, candidateModelId, casesDigest: first.casesDigest, profileDigest: digest(profile),
    reportDigests: validated.map((report) => report.digest),
    candidateEligible, replicationPending,
    releaseReady: reasons.length === 0, checks, reasons, automaticallyPromotes: false,
    authenticity: "Checksums bind evidence; external measurement and evaluator authenticity require independent review."
  };
  return { ...result, digest: digest(result) };
}

function validateProfile(profile) {
  if (!profile || profile.schema !== "amos.router-learning-profile" || profile.version !== 1 || profile.classifierContract !== INTELLIGENCE_ROUTER_CONTRACT) throw new Error("Unsupported router learning profile");
  nonempty(profile.id, "profile.id", 200);
  if (profile.quantization !== undefined && profile.quantization !== "Q4_K_M") throw new Error("Profile quantization differs from evaluation protocol");
  if (profile.minimumTaskFamilies !== undefined) integer(profile.minimumTaskFamilies, "profile.minimumTaskFamilies", 1, 10000);
  if (profile.minimumQualificationTaskFamilies !== undefined) integer(profile.minimumQualificationTaskFamilies, "profile.minimumQualificationTaskFamilies", 1, 10000);
  if (profile.inference !== undefined && canonicalJson(profile.inference) !== canonicalJson({ maxInputCharacters: 4000, contextTokens: 4096, maxOutputTokens: 24, thinking: false, repairAttempts: 0 })) throw new Error("Profile inference differs from the production router protocol");
  const e = profile.evaluation;
  if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("Profile evaluation constraints are required");
  for (const key of ["minimumCases", "minimumQualificationCases", "minimumRepetitions", "maximumWarmP95Ms", "maximumColdP95Ms", "maximumContendedP95Ms", "maximumArtifactBytes"]) integer(e[key], `profile.evaluation.${key}`, 1, Number.MAX_SAFE_INTEGER);
  integer(e.maximumInvalidOutputs, "profile.evaluation.maximumInvalidOutputs", 0, Number.MAX_SAFE_INTEGER);
  for (const key of ["minimumAccuracy", "minimumClassAccuracy", "maximumUnderRouteRate", "maximumSevereUnderRouteRate", "maximumLatencyGrowthRatio", "maximumResidentGrowthRatio"]) {
    finite(e[key], `profile.evaluation.${key}`);
    if (e[key] > 1) throw new Error(`Profile ${key} must not permit regression`);
  }
  if (!Array.isArray(e.requiredModes) || canonicalJson([...e.requiredModes].sort()) !== canonicalJson([...MODES].sort())) throw new Error("Profile must require warm, cold, and contended evidence");
  digest(profile); // Reject non-JSON values rather than silently dropping them.
  return profile;
}

function validateEnvironment(value, models) {
  exact(value, ["hardwareId", "runtimeVersion", "quantization", "mode"], ["conditionEvidence", "memoryEvidence"], "environment");
  nonempty(value.hardwareId, "environment.hardwareId", 300);
  nonempty(value.runtimeVersion, "environment.runtimeVersion", 200);
  if (value.quantization !== "Q4_K_M") throw new Error("Router evaluation requires Q4_K_M artifacts");
  if (!MODES.includes(value.mode)) throw new Error("Invalid environment mode");
  if (value.conditionEvidence !== undefined) {
    exact(value.conditionEvidence, ["source", "evidenceSha256"], [], "conditionEvidence");
    if (value.conditionEvidence.source !== "external-harness") throw new Error("Condition evidence must come from an external harness");
    sha(value.conditionEvidence.evidenceSha256, "conditionEvidence.evidenceSha256");
  }
  if (value.memoryEvidence !== undefined) {
    exact(value.memoryEvidence, ["source", "evidenceSha256", "measurements"], [], "memoryEvidence");
    if (value.memoryEvidence.source !== "external-runtime-process-tree-rss") throw new Error("Memory evidence must measure the external runtime process tree, not evaluator Node RSS");
    sha(value.memoryEvidence.evidenceSha256, "memoryEvidence.evidenceSha256");
    assertArray(value.memoryEvidence.measurements, "memoryEvidence.measurements", 1, models.length);
    unique(value.memoryEvidence.measurements.map((item) => item.modelId), "memory model IDs");
    for (const measurement of value.memoryEvidence.measurements) {
      exact(measurement, ["modelId", "artifactSha256", "peakRssBytes"], [], "memory measurement");
      const model = models.find((item) => item.id === measurement.modelId);
      if (!model || model.artifactSha256 !== measurement.artifactSha256) throw new Error("Memory evidence artifact mismatch");
      integer(measurement.peakRssBytes, "peakRssBytes", 1, Number.MAX_SAFE_INTEGER);
    }
  }
  return structuredClone(value);
}

async function verifyRuntimeIdentities(plan, fetchImpl, signal) {
  if (!plan.models.some((model) => model.runtimeDigest)) return;
  checkAbort(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, plan.timeoutMs);
  try {
    const response = await abortable(() => fetchImpl(`${plan.baseUrl}/api/tags`, { method: "GET", redirect: "error", signal: controller.signal }), controller.signal);
    if (!response?.ok || (response.url && new URL(response.url).origin !== plan.baseUrl)) throw new Error("Could not verify local runtime model identities");
    const tags = await abortable(() => response.json(), controller.signal);
    for (const model of plan.models.filter((item) => item.runtimeDigest)) {
      const matches = (Array.isArray(tags?.models) ? tags.models : []).filter((item) => item.name === model.id || item.model === model.id);
      if (matches.length !== 1 || String(matches[0].digest || "").replace(/^sha256:/, "") !== model.runtimeDigest) throw new Error(`Runtime artifact identity mismatch for ${model.id}`);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function* attemptOrder(plan) {
  let pair = 0;
  for (let repetition = 0; repetition < plan.repetitions; repetition += 1) {
    for (const item of plan.cases) {
      for (let offset = 0; offset < plan.models.length; offset += 1) {
        yield { repetition, item, model: plan.models[(pair + offset) % plan.models.length] };
      }
      pair += 1;
    }
  }
}

function outcome(expected, actual) {
  const distance = actual === null ? 0 : CLASSES.indexOf(expected) - CLASSES.indexOf(actual);
  return { correct: expected === actual, underRoute: distance > 0, severeUnderRoute: distance >= 2 };
}

function summarize(plan, runs) {
  return { byModel: Object.fromEntries(plan.models.map((model) => {
    const selected = runs.filter((run) => run.modelId === model.id);
    return [model.id, {
      ...metrics(selected),
      byClass: Object.fromEntries(CLASSES.map((value) => [value, metrics(selected.filter((run) => run.expectedClass === value))])),
      byFamily: Object.fromEntries([...new Set(plan.cases.map((item) => item.family))].sort().map((family) => {
        const ids = new Set(plan.cases.filter((item) => item.family === family).map((item) => item.id));
        return [family, metrics(selected.filter((run) => ids.has(run.caseId)))];
      }))
    }];
  })) };
}

function metrics(runs) {
  const count = runs.length;
  const countWhere = (key) => runs.filter((run) => run[key]).length;
  const correct = countWhere("correct");
  const underRoutes = countWhere("underRoute");
  const severeUnderRoutes = countWhere("severeUnderRoute");
  const latencies = runs.map((run) => run.latencyMs).sort((a, b) => a - b);
  const percentile = (p) => count ? latencies[Math.ceil(count * p) - 1] : null;
  return {
    attempts: count, correct, accuracy: count ? correct / count : null,
    failures: runs.filter((run) => run.status !== "ok").length,
    invalidOutputs: runs.filter((run) => run.status === "invalid").length,
    timeouts: runs.filter((run) => run.status === "timeout").length,
    underRoutes, underRouteRate: count ? underRoutes / count : null,
    severeUnderRoutes, severeUnderRouteRate: count ? severeUnderRoutes / count : null,
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: count ? latencies.at(-1) : null },
    modelCalls: runs.reduce((sum, run) => sum + run.modelCalls, 0), repairCalls: 0
  };
}

function abortable(action, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(action).then(resolve, reject).finally(() => signal?.removeEventListener("abort", onAbort));
  });
}
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function abortError() { const error = new Error("Router evaluation aborted"); error.name = "AbortError"; return error; }
function exact(value, required, optional, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) throw new Error(`Invalid ${label} fields`);
}
function assertArray(value, label, min, max) { if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label} must contain ${min} to ${max} items`); }
function nonempty(value, label, max) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`); }
function integer(value, label, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`); }
function finite(value, label) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`); }
function sha(value, label) { if (typeof value !== "string" || !HASH.test(value)) throw new Error(`Invalid ${label}`); }
function unique(values, label) { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`); }
function textDigest(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function digest(value) {
  function check(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) { item.forEach(check); return; }
    if (item && typeof item === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(item))) { Object.values(item).forEach(check); return; }
    throw new Error("Evaluation evidence must contain only finite JSON values");
  }
  check(value);
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
