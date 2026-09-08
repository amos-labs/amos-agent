import { createHash } from "node:crypto";
import { mkdir, open, rename } from "node:fs/promises";
import { isAbsolute, join, dirname } from "node:path";
import { runDesktopFixture } from "./desktopFixtureRunner.js";
import { createFixtureRequestBudget } from "./fixtureRequestBudget.js";
import { canonicalJson } from "../util/canonicalJson.js";
import { SYSTEM_PROMPT } from "../prompts.js";

const sha = value => createHash("sha256").update(value).digest("hex");
const digest = value => sha(canonicalJson(value));
const named = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(value);
const hashed = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
function require(value, message) { if (!value) throw new Error(message); }

// Research only. The caller supplies trusted synthetic fixtures, explicit
// credentials/transport and a bound isolated replica. No live-cell discovery.
export async function runDesktopCohort({
  plan: suppliedPlan, outputDirectory, prepareCase, createInputTokenCounter,
  fetchImpl, signal = null, systemPrompt = SYSTEM_PROMPT
}) {
  const plan = structuredClone(suppliedPlan);
  validate(plan, outputDirectory, systemPrompt);
  require(typeof prepareCase === "function" && typeof createInputTokenCounter === "function" &&
    typeof fetchImpl === "function", "Explicit fixture, tokenizer and transport factories required");
  const budget = createFixtureRequestBudget(plan.requestBudget);
  // Exclusive directory creation is the durable run claim. Never resume or
  // reset a consumed run after a crash, a completed run, or a concurrent start.
  await mkdir(outputDirectory, { mode: 0o700 });
  await syncDirectory(dirname(outputDirectory));
  await mkdir(join(outputDirectory, "results"), { mode: 0o700 });
  await writeDurable(join(outputDirectory, "manifest.json"), { ...plan, planSha256: digest(plan) });
  const log = await open(join(outputDirectory, "journal.jsonl"), "ax", 0o600);
  await syncDirectory(outputDirectory);
  let sequence = 0, previous = null, writes = Promise.resolve(), counter = null;
  let next = 0, failure = null;
  const completed = new Map();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const close = reason => budget.close(reason);
  const externallyAborted = () => close("cohort_external_abort");
  signal?.addEventListener("abort", externallyAborted, { once: true });
  if (signal?.aborted) externallyAborted();
  const timer = setTimeout(() => close("cohort_wall_limit"), plan.maxWallMs);
  const journal = data => {
    writes = writes.then(async () => {
      const item = { sequence: ++sequence, previousSha256: previous, at: new Date().toISOString(), ...data };
      const hash = digest(item);
      await log.writeFile(JSON.stringify({ ...item, sha256: hash }) + "\n");
      await log.sync();
      previous = hash;
    });
    return writes.catch(error => { close("cohort_journal_failed"); throw error; });
  };
  const check = () => { if (budget.signal.aborted) throw new Error(String(budget.signal.reason)); };
  try {
    await journal({ type: "run_started", runId: plan.runId, planSha256: digest(plan) });
    check();
    const creating = Promise.resolve().then(() => createInputTokenCounter({ signal: budget.signal }));
    // A late factory result is closed even if a timeout wins the race.
    creating.then(value => { if (budget.signal.aborted) value?.close?.(); }, () => {});
    counter = await abortable(creating, budget.signal);
    require(counter?.identity === plan.tokenizerIdentity && typeof counter.count === "function" &&
      typeof counter.close === "function", "cohort_tokenizer_binding_mismatch");
    await journal({ type: "tokenizer_ready", identity: counter.identity });
    const worker = async end => {
      while (!budget.signal.aborted && next < end) {
        const index = next++, entry = plan.entries[index];
        try {
          await journal({ type: "case_started", index, entry });
          check();
          const prepared = await abortable(Promise.resolve().then(() => prepareCase(structuredClone(entry), { signal: budget.signal })), budget.signal);
          check();
          require(prepared?.fixture?.synthetic === true && prepared.fixture.id === entry.fixtureId,
            "cohort_fixture_binding_mismatch");
          const url = new URL(prepared.modelConfig?.baseUrl);
          require(url.origin === plan.resource.origin && !url.username && !url.password,
            "cohort_endpoint_binding_mismatch");
          let calls = 0;
          const result = await runDesktopFixture({
            fixture: prepared.fixture, tools: prepared.tools, verify: prepared.verify,
            modelConfig: prepared.modelConfig, systemPrompt,
            expectedServedModel: plan.arms[entry.arm], limits: entry.limits,
            transportProfile: "direct-cortex", requestBudget: budget,
            inputTokenCounter: counter, signal: budget.signal,
            fetchImpl: async (target, options) => {
              check();
              const body = JSON.parse(options.body);
              const { model: _model, ...input } = body;
              if (calls === 0 && digest(input) !== entry.initialInputSha256) {
                close("cohort_initial_input_mismatch"); check();
              }
              // This fsynced record precedes HTTP. Headers/credentials and
              // query strings are omitted; bodies are synthetic fixture data.
              await journal({ type: "request_reserved", index, call: ++calls,
                requestBody: body, requestBodySha256: sha(options.body), budget: budget.snapshot() });
              check();
              const response = await fetchImpl(target, options);
              await journal({ type: "response_headers", index, call: calls, status: response.status });
              if (response.status >= 500) close("replica_http_5xx");
              return response;
            }
          });
          // Persist the complete answer/trace before advertising completion.
          const resultName = `${String(index).padStart(5, "0")}.json`;
          const resultPath = join(outputDirectory, "results", resultName);
          await writeDurable(resultPath, result);
          const record = { index, key: entry.key, scenarioId: entry.scenarioId, arm: entry.arm,
            phase: entry.phase, status: result.status, verdict: result.verification.verdict,
            result: `results/${resultName}`, resultSha256: digest(result), wallMs: result.wallMs };
          await journal({ type: "case_finished", ...record, budget: budget.snapshot() });
          completed.set(index, record);
          if (result.status === "aborted") close(result.stopReason || "cohort_case_aborted");
          if (entry.phase === "warmup" && result.verification.verdict !== "pass") close("cohort_warmup_failed");
        } catch {
          failure = failure || "cohort_execution_failed";
          close(failure);
        }
      }
    };
    while (!budget.signal.aborted && next < plan.entries.length) {
      const phase = plan.entries[next].phase;
      let end = next;
      while (end < plan.entries.length && plan.entries[end].phase === phase) end++;
      // A fast arm cannot expose a holdout while another warmup is unfinished.
      await Promise.all(Array.from({ length: plan.concurrency }, () => worker(end)));
    }
  } catch {
    failure = failure || "cohort_preflight_failed";
    close(failure);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", externallyAborted);
    try { counter?.close?.(); } catch { failure = failure || "cohort_counter_close_failed"; close(failure); }
  }
  const snapshot = budget.snapshot();
  const summary = {
    schema: "amos.desktop-cohort-execution", version: 1, runId: plan.runId, planSha256: digest(plan),
    synthetic: true, missionComparisonEligible: false, qualityDecision: "not_assessed",
    startedAt, wallMs: performance.now() - started,
    status: completed.size === plan.entries.length && !snapshot.closed && !failure ? "completed" : "incomplete",
    stopReason: snapshot.stopReason || failure, budget: snapshot,
    entries: plan.entries.map((entry, index) => completed.get(index) || {
      index, key: entry.key, scenarioId: entry.scenarioId, arm: entry.arm, phase: entry.phase,
      status: "unresolved", verdict: "unknown", result: null
    })
  };
  try {
    await journal({ type: "run_finished", status: summary.status, stopReason: summary.stopReason, budget: snapshot });
    await writeDurable(join(outputDirectory, "summary.json"), summary);
  } finally {
    close("cohort_finished");
    await log.close();
  }
  return summary;
}

function validate(plan, outputDirectory, systemPrompt) {
  require(isAbsolute(outputDirectory), "An absolute new output directory is required");
  require(plan?.version === 1 && named(plan.runId), "Invalid cohort run identity");
  require(plan.resource?.mode === "isolated-replica" && named(plan.resource.instanceId), "An explicit isolated replica is required");
  const origin = new URL(plan.resource.origin);
  require(["http:", "https:"].includes(origin.protocol) && origin.origin === plan.resource.origin,
    "Provide the replica origin without credentials, path or query");
  require(positive(plan.maxWallMs) && plan.maxWallMs <= 86_400_000, "Invalid cohort wall limit");
  require(positive(plan.concurrency) && plan.concurrency <= 2 &&
    plan.concurrency <= plan.requestBudget?.maxConcurrentRequests, "Invalid cohort concurrency");
  require(typeof plan.tokenizerIdentity === "string" && plan.tokenizerIdentity.length > 0,
    "An explicit tokenizer identity is required");
  require(hashed(plan.protocolSha256) && hashed(plan.fixtureSourceSha256) &&
    hashed(plan.systemPromptSha256) && plan.systemPromptSha256 === sha(systemPrompt), "Invalid source/protocol binding");
  require(/^[a-f0-9]{40}$/.test(plan.desktopRevision), "A Desktop source revision is required");
  require(plan.arms && Object.keys(plan.arms).length >= 2 && Object.keys(plan.arms).length <= 4 &&
    Object.entries(plan.arms).every(([key, model]) => named(key) && typeof model === "string" && model.trim()), "Invalid model arms");
  require(new Set(Object.values(plan.arms)).size === Object.keys(plan.arms).length, "Model arms must be distinct");
  require(Array.isArray(plan.entries) && plan.entries.length > 0 && plan.entries.length <= 2000, "Invalid cohort entries");
  const keys = new Set(), groups = new Map();
  const rank = { warmup: 0, development: 1, regression: 1, holdout: 2 };
  let latestPhase = -1;
  for (const entry of plan.entries) {
    require(named(entry.key) && !keys.has(entry.key) && named(entry.scenarioId) && named(entry.fixtureId), "Invalid or duplicate case identity");
    keys.add(entry.key);
    require(Object.hasOwn(plan.arms, entry.arm) && ["warmup", "development", "regression", "holdout"].includes(entry.phase), "Invalid case arm or phase");
    require(rank[entry.phase] >= latestPhase, "Cohort phases must not move backwards");
    latestPhase = rank[entry.phase];
    require(hashed(entry.initialInputSha256), "Compiled initial input binding required");
    const limits = entry.limits;
    require(positive(limits?.maxModelTurns) && limits.maxModelTurns <= 32 &&
      Number.isSafeInteger(limits.maxToolCalls) && limits.maxToolCalls >= 0 && limits.maxToolCalls <= 256 &&
      positive(limits.maxHttpCalls) && limits.maxHttpCalls <= 64 && positive(limits.maxWallMs) && limits.maxWallMs <= 300_000 &&
      positive(limits.maxCompletionTokens) && limits.maxCompletionTokens <= 24_576, "Invalid case limits");
    const key = `${entry.phase}:${entry.scenarioId}`;
    const group = groups.get(key) || { arms: new Set(), input: entry.initialInputSha256, limits: digest(limits) };
    require(!group.arms.has(entry.arm) && group.input === entry.initialInputSha256 && group.limits === digest(limits), "Unpaired initial input or limits");
    group.arms.add(entry.arm); groups.set(key, group);
  }
  require(!plan.entries.some(entry => entry.phase === "holdout") || plan.entries.some(entry => entry.phase === "warmup"), "A holdout requires a preceding warmup for every arm");
  require([...groups.values()].every(group => group.arms.size === Object.keys(plan.arms).length), "Every scenario must include every model arm");
}

async function writeDurable(path, value) {
  const temporary = `${path}.pending`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
  // Flush the directory entry as well as the file contents on POSIX hosts.
  await syncDirectory(dirname(path));
}

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const directory = await open(path, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error(String(signal.reason || "aborted")));
    const done = (fn, value) => { signal.removeEventListener("abort", aborted); fn(value); };
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise).then(value => done(resolve, value), error => done(reject, error));
    if (signal.aborted) aborted();
  });
}
