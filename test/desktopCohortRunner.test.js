import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { runDesktopCohort } from "../src/evals/desktopCohortRunner.js";
import { runDesktopFixture } from "../src/evals/desktopFixtureRunner.js";
import { resolveModelConfig } from "../src/model/providers.js";
import { canonicalJson } from "../src/util/canonicalJson.js";
const sha = value => createHash("sha256").update(value).digest("hex");
const systemPrompt = "Use fixture tools and report a verified answer.";
const limits = { maxModelTurns: 3, maxToolCalls: 2, maxHttpCalls: 3, maxWallMs: 1000, maxCompletionTokens: 32 };
const fixture = { id: "fixture-balance", synthetic: true, prompt: "Return 42." };
const config = { ...resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" }),
  baseUrl: "http://replica.fixture.invalid/v1", apiKey: "private-fixture-credential" };
function response(model, content = "42", usage = false) {
  const row = { model, choices: [{ delta: { content }, finish_reason: "stop" }],
    ...(usage ? { usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } } : {}) };
  return new Response(`data: ${JSON.stringify(row)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "amos-cohort-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prepareCase = async () => ({ fixture, tools: [], verify: result => ({ verdict: result.answer === "42" ? "pass" : "fail" }), modelConfig: config });
  const compiled = await runDesktopFixture({ ...await prepareCase(), systemPrompt, limits, transportProfile: "direct-cortex", expectedServedModel: "model-base",
    fetchImpl: async () => { throw new Error("local input compilation only"); } });
  const plan = { version: 1, runId: "synthetic-run", resource: { mode: "isolated-replica", instanceId: "i-fixture", origin: "http://replica.fixture.invalid" },
    maxWallMs: 3000, concurrency: 1, requestBudget: { maxHttpCalls: 4, maxTotalTokens: 1000, maxInputTokensPerRequest: 100, maxConcurrentRequests: 2 },
    tokenizerIdentity: "test-double-counter", protocolSha256: "a".repeat(64), fixtureSourceSha256: "b".repeat(64),
    desktopRevision: "c".repeat(40), systemPromptSha256: sha(systemPrompt), arms: { base: "model-base", candidate: "model-candidate" },
    entries: ["base", "candidate"].map(arm => ({ key: `balance-${arm}`, scenarioId: "balance", fixtureId: fixture.id, arm, phase: "development",
      initialInputSha256: compiled.requests[0].modelIndependentBodySha256, limits: { ...limits } })) };
  let closes = 0;
  return { directory, plan, outputDirectory: join(directory, "run"), systemPrompt, prepareCase,
    createInputTokenCounter: async () => ({ identity: "test-double-counter", count: async () => 10, close: () => { closes++; } }),
    fetchImpl: async (_url, request) => response(JSON.parse(request.body).model), closes: () => closes };
}
async function journal(directory) { return (await readFile(join(directory, "journal.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)); }

test("all arms execute through Desktop with durable intents before HTTP and no credential export", async t => {
  const f = await setup(t); let calls = 0;
  const result = await runDesktopCohort({ ...f, fetchImpl: async (_url, request) => {
    const records = await journal(f.outputDirectory);
    const intent = records.at(-1);
    assert.equal(intent.type, "request_reserved");
    assert.equal(intent.requestBodySha256, sha(request.body));
    assert.equal(intent.budget.httpCalls, ++calls);
    assert.equal(intent.budget.reservedTokens, 42);
    return response(JSON.parse(request.body).model);
  } });
  assert.equal(result.status, "completed"); assert.equal(result.qualityDecision, "not_assessed");
  assert.deepEqual(result.entries.map(x => x.verdict), ["pass", "pass"]);
  assert.equal(result.budget.chargedTokens, 84); assert.equal(result.budget.unknownUsageCalls, 2);
  const records = await journal(f.outputDirectory); let previous = null;
  for (const { sha256, ...record } of records) {
    assert.equal(record.previousSha256, previous); assert.equal(sha256, sha(canonicalJson(record))); previous = sha256;
  }
  for (const name of ["manifest.json", "journal.jsonl", "summary.json"])
    assert.doesNotMatch(await readFile(join(f.outputDirectory, name), "utf8"), /private-fixture-credential|Authorization/);
  assert.equal((await readdir(join(f.outputDirectory, "results"))).length, 2);
  assert.equal(f.closes(), 1);
});

test("same-directory concurrent dispatch and restart cannot spend or replay a consumed run", async t => {
  const f = await setup(t); let calls = 0;
  const options = { ...f, fetchImpl: async (_url, request) => { calls++; return response(JSON.parse(request.body).model); } };
  const outcomes = await Promise.allSettled([runDesktopCohort(options), runDesktopCohort(options)]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(x => x.status === "rejected").reason.code, "EEXIST");
  await assert.rejects(runDesktopCohort(options), { code: "EEXIST" }); assert.equal(calls, 2);
  const partial = join(f.directory, "crashed"); await mkdir(partial);
  await assert.rejects(runDesktopCohort({ ...options, outputDirectory: partial }), { code: "EEXIST" }); assert.equal(calls, 2);
});

test("shared token limit preserves missing cases and never calls a partial cohort complete", async t => {
  const f = await setup(t); f.plan.requestBudget.maxTotalTokens = 60;
  let calls = 0;
  const result = await runDesktopCohort({ ...f, fetchImpl: async (_url, r) => { calls++; return response(JSON.parse(r.body).model); } });
  assert.equal(calls, 1); assert.equal(result.status, "incomplete"); assert.equal(result.entries.length, 2);
  assert.equal(result.stopReason, "aggregate_token_limit"); assert.equal(result.budget.chargedTokens, 42);
  assert.equal(result.entries[1].verdict, "unknown");
});

test("aggregate wall deadline stops a hung tokenizer factory and closes its late worker", { timeout: 5000 }, async t => {
  const f = await setup(t); f.plan.maxWallMs = 30;
  // The durable run-start journal can take longer than the deadline on a busy
  // runner. Advance time only after the factory is actually waiting.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let entered, finish, onClosed, counterSignal, closes = 0;
  const factoryStarted = new Promise(resolve => { entered = resolve; });
  const worker = new Promise(resolve => { finish = resolve; });
  const workerClosed = new Promise(resolve => { onClosed = resolve; });
  const running = runDesktopCohort({ ...f, createInputTokenCounter: ({ signal }) => {
    counterSignal = signal; entered(); return worker;
  } });
  await Promise.race([factoryStarted, running.then(() => assert.fail("cohort exited before tokenizer creation"))]);
  t.mock.timers.tick(29);
  assert.equal(counterSignal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(counterSignal.aborted, true);
  const result = await running;
  assert.equal(result.status, "incomplete"); assert.equal(result.stopReason, "cohort_wall_limit");
  assert.equal(result.budget.httpCalls, 0); assert.ok(result.entries.every(e => e.verdict === "unknown"));
  assert.equal(closes, 0);
  finish({ close: () => { closes++; onClosed(); } });
  await workerClosed;
  assert.equal(closes, 1);
});

test("replica 5xx cancels remaining arms and retains request reservation", async t => {
  const f = await setup(t); let calls = 0;
  const result = await runDesktopCohort({ ...f, fetchImpl: async () => { calls++; return new Response("failure", { status: 503 }); } });
  assert.equal(calls, 1); assert.equal(result.status, "incomplete"); assert.equal(result.stopReason, "replica_http_5xx");
  assert.equal(result.budget.chargedTokens, 42); assert.equal(result.entries[1].status, "unresolved");
});

test("served identity mismatch cannot complete a cohort", async t => {
  const f = await setup(t);
  const result = await runDesktopCohort({ ...f, fetchImpl: async () => response("wrong-model") });
  assert.equal(result.status, "incomplete"); assert.equal(result.stopReason, "serving_identity_mismatch");
  assert.equal(result.entries[0].verdict, "unknown"); assert.equal(result.entries[1].status, "unresolved");
});

test("malformed or unpaired manifests fail before resource claim or transport", async t => {
  const f = await setup(t);
  for (const modify of [p => { p.entries.pop(); }, p => { p.entries[1].initialInputSha256 = "d".repeat(64); },
    p => { p.resource.mode = "live-cell"; }, p => { p.systemPromptSha256 = "0".repeat(64); }, p => { p.entries[1].limits.maxToolCalls++; }]) {
    const plan = structuredClone(f.plan); modify(plan);
    await assert.rejects(runDesktopCohort({ ...f, plan }));
  }
  assert.deepEqual(await readdir(f.directory), []);
});

test("runtime fixture/endpoint/tokenizer mismatches cannot reach HTTP", async t => {
  const f = await setup(t); let calls = 0;
  const variants = [
    { prepareCase: async () => ({ ...await f.prepareCase(), fixture: { ...fixture, id: "other" } }) },
    { prepareCase: async () => ({ ...await f.prepareCase(), modelConfig: { ...config, baseUrl: "https://other.invalid/v1" } }) },
    { createInputTokenCounter: async () => ({ ...await f.createInputTokenCounter(), identity: "other" }) }
  ];
  for (let i = 0; i < variants.length; i++) {
    const result = await runDesktopCohort({ ...f, ...variants[i], outputDirectory: join(f.directory, `variant-${i}`), fetchImpl: async () => { calls++; throw new Error("unexpected"); } });
    assert.equal(result.status, "incomplete");
  }
  assert.equal(calls, 0);
});

test("compiled input mismatch stops before HTTP", async t => {
  const f = await setup(t); let calls = 0;
  const result = await runDesktopCohort({ ...f, prepareCase: async () => ({ ...await f.prepareCase(), fixture: { ...fixture, prompt: "different input" } }),
    fetchImpl: async () => { calls++; throw new Error("unexpected"); } });
  assert.equal(result.status, "incomplete"); assert.equal(result.stopReason, "cohort_initial_input_mismatch"); assert.equal(calls, 0);
});


test("cancellation aborts two in-flight arms and conservatively charges both", async t => {
  const f = await setup(t); f.plan.concurrency = 2; const abort = new AbortController(); let calls = 0;
  const result = await runDesktopCohort({ ...f, signal: abort.signal, fetchImpl: async () => {
    if (++calls === 2) queueMicrotask(() => abort.abort());
    return new Promise(() => {});
  } });
  assert.equal(calls, 2); assert.equal(result.status, "incomplete");
  assert.equal(result.stopReason, "cohort_external_abort"); assert.equal(result.budget.chargedTokens, 84);
  assert.ok(result.entries.every(entry => entry.verdict === "unknown"));
});

test("process death leaves a durable reservation and restart cannot repeat it", { timeout: 8000 }, async t => {
  const f = await setup(t); const script = join(f.directory, "crash-child.mjs");
  const moduleUrl = new URL("../src/evals/desktopCohortRunner.js", import.meta.url).href;
  await writeFile(script, `
    import { runDesktopCohort } from ${JSON.stringify(moduleUrl)};
    await runDesktopCohort({
      plan: ${JSON.stringify(f.plan)}, outputDirectory: ${JSON.stringify(f.outputDirectory)}, systemPrompt: ${JSON.stringify(systemPrompt)},
      createInputTokenCounter: async () => ({identity:"test-double-counter", count:async()=>10, close:()=>{}}),
      prepareCase: async () => ({fixture:${JSON.stringify(fixture)}, tools:[], modelConfig:${JSON.stringify(config)}, verify:()=>({verdict:"unknown"})}),
      fetchImpl: async () => { process.send("reserved"); return new Promise(()=>{}); }
    });
  `);
  const child = spawn(process.execPath, [script], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const exited = new Promise(resolve => child.once("exit", resolve));
  await new Promise((resolve, reject) => { child.once("message", resolve); child.once("error", reject); child.once("exit", () => reject(new Error("child exited before dispatch"))); });
  child.kill("SIGKILL"); await exited;
  const records = await journal(f.outputDirectory);
  assert.equal(records.at(-1).type, "request_reserved"); assert.equal(records.at(-1).budget.reservedTokens, 42);
  let calls = 0;
  await assert.rejects(runDesktopCohort({ ...f, fetchImpl: async () => { calls++; } }), { code: "EEXIST" });
  assert.equal(calls, 0);
  await assert.rejects(readFile(join(f.outputDirectory, "summary.json")), { code: "ENOENT" });
});


test("warmup barrier prevents a fast arm from exposing the holdout early", async t => {
  const f = await setup(t); f.plan.concurrency = 2;
  f.plan.entries = ["warmup", "holdout"].flatMap(phase => f.plan.entries.map(entry => ({...entry, phase, key:`${phase}-${entry.key}`})));
  let calls = 0, entered, release;
  const ready = new Promise(resolve => {entered=resolve;}); const gate = new Promise(resolve => {release=resolve;});
  const running = runDesktopCohort({...f, fetchImpl: async (_url, request) => {
    if (++calls === 2) {entered(); await gate;}
    return response(JSON.parse(request.body).model);
  }});
  await ready; await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 2);
  release(); const result = await running; assert.equal(calls, 4); assert.equal(result.status,"completed");
});

test("failed warmup leaves all holdout entries undispatched", async t => {
  const f = await setup(t);
  f.plan.entries = ["warmup", "holdout"].flatMap(phase => f.plan.entries.map(entry => ({...entry, phase, key:`${phase}-${entry.key}`})));
  let calls = 0;
  const result = await runDesktopCohort({...f, prepareCase:async()=>({...await f.prepareCase(),verify:()=>({verdict:"fail"})}),
    fetchImpl:async(_url,request)=>{calls++;return response(JSON.parse(request.body).model);}});
  assert.equal(calls,1);assert.equal(result.status,"incomplete");assert.equal(result.stopReason,"cohort_warmup_failed");
  assert.ok(result.entries.filter(e=>e.phase==='holdout').every(e=>e.status==='unresolved'));
});


test("an erroneous passing verifier cannot qualify a failed warmup execution", async t => {
  const f = await setup(t);
  f.plan.entries = ["warmup", "holdout"].flatMap(phase => f.plan.entries.map(entry => ({...entry, phase, key:`${phase}-${entry.key}`})));
  let calls = 0;
  const result = await runDesktopCohort({...f, prepareCase:async()=>({...await f.prepareCase(),verify:()=>({verdict:"pass"})}),
    fetchImpl:async()=>{calls++;return new Response("invalid request",{status:400});}});
  assert.equal(calls,1);assert.equal(result.status,"incomplete");assert.equal(result.stopReason,"cohort_warmup_failed");
  assert.equal(result.entries[0].verdict,"pass");assert.equal(result.entries[0].status,"error");assert.equal(result.entries[0].verifiedComplete,false);
  assert.ok(result.entries.filter(e=>e.phase==='holdout').every(e=>e.status==='unresolved' && !e.verifiedComplete));
});

function overToolLimitResponse(model, knownUsage = true) {
  const row = { model, choices: [{ delta: { tool_calls: [0, 1, 2].map(index => ({
    index, id: `call-${index}`, type: "function", function: { name: "unavailable", arguments: "{}" }
  })) }, finish_reason: "tool_calls" }],
  ...(knownUsage ? { usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } } : {}) };
  return new Response(`data: ${JSON.stringify(row)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

test("an accounted case limit does not cancel an in-flight paired arm", async t => {
  const f = await setup(t); f.plan.caseLimitPolicy = "isolate-accounted"; f.plan.concurrency = 2;
  let entered;
  const candidateStarted = new Promise(resolve => { entered = resolve; });
  const result = await runDesktopCohort({ ...f, fetchImpl: async (_url, request) => {
    const model = JSON.parse(request.body).model;
    if (model === "model-base") { await candidateStarted; return overToolLimitResponse(model); }
    entered();
    for (let i = 0; i < 100; i++) {
      assert.equal(request.signal.aborted, false, "base failure must not cancel the candidate request");
      if ((await journal(f.outputDirectory)).some(row => row.type === "case_finished" && row.index === 0))
        return response(model, "42", true);
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error("base did not finish within test bound");
  } });
  assert.equal(result.status, "completed"); assert.equal(result.budget.closed, false);
  assert.equal(result.budget.httpCalls, 2); assert.equal(result.budget.unknownUsageCalls, 0);
  assert.equal(result.budget.chargedTokens, 26); assert.equal(result.budget.reservedTokens, 0);
  assert.deepEqual(result.entries.map(e => e.verifiedComplete), [false, true]);
  assert.deepEqual(result.entries.map(e => e.status), ["aborted", "answered"]);
  const failed = JSON.parse(await readFile(join(f.outputDirectory, result.entries[0].result), "utf8"));
  assert.equal(failed.caseLimitIsolated, true); assert.equal(failed.stopReason, "tool_call_limit");
  assert.equal(failed.proposedToolCalls, 3); assert.equal(failed.verification.verdict, "unknown");
});

for (const [name, policy, usage, expectedReason] of [
  ["default policy", undefined, true, "tool_call_limit"],
  ["unknown provider usage", "isolate-accounted", false, "tool_call_limit"]
]) test(`${name} still closes the cohort on a case limit`, async t => {
  const f = await setup(t); if (policy) f.plan.caseLimitPolicy = policy;
  let calls = 0;
  const result = await runDesktopCohort({ ...f, fetchImpl: async (_url, request) => {
    calls++; return overToolLimitResponse(JSON.parse(request.body).model, usage);
  } });
  assert.equal(calls, 1); assert.equal(result.status, "incomplete");
  assert.equal(result.stopReason, expectedReason); assert.equal(result.budget.closed, true);
  assert.equal(result.entries[1].status, "unresolved");
  const failed = JSON.parse(await readFile(join(f.outputDirectory, result.entries[0].result), "utf8"));
  assert.equal(failed.caseLimitIsolated, false);
});

for (const [name, transport, reason] of [
  ["identity mismatch", async () => response("wrong-model", "42", true), "serving_identity_mismatch"],
  ["replica failure", async () => new Response("failure", { status: 503 }), "replica_http_5xx"]
]) test(`case isolation preserves the global ${name} stop`, async t => {
  const f = await setup(t); f.plan.caseLimitPolicy = "isolate-accounted";
  let calls = 0;
  const result = await runDesktopCohort({ ...f, fetchImpl: async (...args) => { calls++; return transport(...args); } });
  assert.equal(calls, 1); assert.equal(result.status, "incomplete"); assert.equal(result.stopReason, reason);
  assert.equal(result.entries[1].status, "unresolved");
});

test("invalid case-limit policy rejects before claiming the run", async t => {
  const f = await setup(t); f.plan.caseLimitPolicy = "ignore-all-errors";
  await assert.rejects(runDesktopCohort(f), /Invalid case limit policy/);
  assert.deepEqual(await readdir(f.directory), []);
});
