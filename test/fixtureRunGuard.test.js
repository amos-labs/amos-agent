import test from "node:test";
import assert from "node:assert/strict";
import { startFixtureRunGuard } from "../src/evals/fixtureRunGuard.js";
import { createFixtureRequestBudget } from "../src/evals/fixtureRequestBudget.js";

const source = "synthetic-primary-traffic";
const limits = {
  maxWallMs: 5000, pollIntervalMs: 10, readTimeoutMs: 100,
  maxSampleAgeMs: 1000, sampleWindowMs: 600_000, minSamples: 200, maxP95IncreaseRatio: 0.2
};
const budget = () => createFixtureRequestBudget({
  maxHttpCalls: 20, maxTotalTokens: 1000, maxInputTokensPerRequest: 100, maxConcurrentRequests: 2
});
function sample(extra = {}) {
  const end = Date.now();
  return { source, windowStartMs: end - 600_000, windowEndMs: end, sampleCount: 200, http5xxCount: 0, p95Ms: 100, ...extra };
}
function start(extra = {}) {
  return startFixtureRunGuard({ requestBudget: budget(), loadProbe: async () => sample(), loadSource: source, limits, ...extra });
}
async function stopped(guard) {
  if (guard.signal.aborted) return;
  await new Promise(resolve => guard.signal.addEventListener("abort", resolve, { once: true }));
}

test("valid baseline opens monitoring, defensive snapshots and stop close shared admission", async t => {
  const b = budget();
  const g = await start({ requestBudget: b, loadProbe: async ({ windowMs, signal }) => {
    assert.equal(windowMs, 600_000);
    assert.equal(signal.aborted, false);
    return sample({ trafficContent: "must not retain" });
  } });
  t.after(() => g.stop());
  assert.equal(g.snapshot().state, "monitoring");
  assert.equal(g.snapshot().baseline.p95Ms, 100);
  const copy = g.snapshot(); copy.baseline.p95Ms = 999;
  assert.equal(g.snapshot().baseline.p95Ms, 100);
  assert.equal("trafficContent" in g.snapshot().latest, false);
  b.reserve({ inputTokens: 10, maxOutputTokens: 20 }).complete();
  g.stop();
  assert.equal(g.snapshot().stopReason, "run_guard_stopped");
  assert.throws(() => b.reserve({ inputTokens: 1, maxOutputTokens: 1 }), /run_guard_stopped/);
});

test("baseline needs fresh, identified primary traffic with sufficient samples and no errors", async () => {
  const staleEnd = Date.now() - 2000;
  for (const [data, reason] of [
    [sample({ sampleCount: 199 }), "insufficient_load_samples"],
    [sample({ http5xxCount: 1 }), "primary_traffic_5xx"],
    [sample({ windowStartMs: staleEnd - 600_000, windowEndMs: staleEnd }), "stale_load_sample"],
    [sample({ source: "research-traffic" }), "invalid_load_sample"],
    [sample({ windowStartMs: 0 }), "invalid_load_sample"],
    [sample({ p95Ms: NaN }), "invalid_load_sample"],
    [sample({ http5xxCount: 201 }), "invalid_load_sample"],
    [sample({ windowEndMs: Date.now() + 10_000 }), "invalid_load_sample"]
  ]) {
    const b = budget();
    const g = await start({ requestBudget: b, loadProbe: async () => data });
    assert.equal(g.snapshot().state, "stopped");
    assert.equal(g.snapshot().stopReason, reason);
    assert.equal(b.snapshot().httpCalls, 0);
    assert.throws(() => b.reserve({ inputTokens: 1, maxOutputTokens: 1 }));
  }
});

test("latency uses the fixed baseline, not a rising rolling baseline", { timeout: 3000 }, async t => {
  let calls = 0;
  const g = await start({ loadProbe: async () => sample({ p95Ms: [100, 120, 121][calls++] }) });
  t.after(() => g.stop());
  await stopped(g);
  assert.equal(calls, 3);
  assert.equal(g.snapshot().stopReason, "primary_latency_limit");
  assert.equal(g.snapshot().baseline.p95Ms, 100);
  assert.equal(g.snapshot().latest.p95Ms, 121);
});

test("one primary 5xx after baseline cancels in-flight budget users and preserves reservations", { timeout: 3000 }, async t => {
  const b = budget();
  let calls = 0;
  const g = await start({ requestBudget: b, loadProbe: async () => sample({ http5xxCount: calls++ ? 1 : 0 }) });
  t.after(() => g.stop());
  const ticket = b.reserve({ inputTokens: 10, maxOutputTokens: 20 });
  const inFlight = new Promise(resolve => b.signal.addEventListener("abort", () => resolve(b.signal.reason), { once: true }));
  assert.equal(await inFlight, "primary_traffic_5xx");
  assert.equal(b.snapshot().reservedTokens, 30);
  ticket.complete();
  assert.equal(b.snapshot().chargedTokens, 30);
  assert.equal(b.snapshot().activeRequests, 0);
});

test("stale and regressing telemetry stop the run after a valid baseline", { timeout: 3000 }, async t => {
  for (const reason of ["stale_load_sample", "load_sample_time_regressed"]) {
    let initial;
    const g = await start({ loadProbe: async () => {
      if (!initial) return initial = sample();
      const end = initial.windowEndMs - (reason === "stale_load_sample" ? 2000 : 1);
      return sample({ windowStartMs: end - 600_000, windowEndMs: end });
    } });
    t.after(() => g.stop());
    await stopped(g);
    assert.equal(g.snapshot().stopReason, reason);
  }
});

test("probe exceptions close admission without retaining caller error content", async () => {
  for (const error of [new Error("private-token"), "private-token", null, undefined]) {
    const g = await start({ loadProbe: async () => { throw error; } });
    assert.equal(g.snapshot().stopReason, "load_probe_failed");
    assert.equal(JSON.stringify(g.snapshot()).includes("private-token"), false);
  }
});

test("telemetry expiry closes admission between polls and during a hung next probe", { timeout: 3000 }, async t => {
  for (const pollIntervalMs of [10, 1000]) {
    let calls = 0;
    const g = await start({ limits: { ...limits, pollIntervalMs, maxSampleAgeMs: 35, readTimeoutMs: 1000 }, loadProbe: () => {
      if (calls++ === 0) return sample();
      return new Promise(() => {});
    } });
    t.after(() => g.stop());
    await stopped(g);
    assert.equal(g.snapshot().stopReason, "stale_load_sample");
    assert.equal(calls, pollIntervalMs === 10 ? 2 : 1);
  }
});

test("a non-cooperative probe cannot overrun its read deadline", { timeout: 3000 }, async () => {
  let signal;
  const g = await start({ limits: { ...limits, readTimeoutMs: 15 }, loadProbe: args => {
    signal = args.signal;
    return new Promise(() => {});
  } });
  assert.equal(g.snapshot().stopReason, "load_probe_timeout");
  assert.equal(signal.aborted, true);
});

test("the aggregate wall ceiling includes a hung baseline read", { timeout: 3000 }, async () => {
  const g = await start({ limits: { ...limits, maxWallMs: 15, readTimeoutMs: 1000 }, loadProbe: () => new Promise(() => {}) });
  assert.equal(g.snapshot().stopReason, "aggregate_wall_limit");
  assert.equal(g.snapshot().baseline, null);
});

test("aggregate wall ceiling also stops healthy monitoring", { timeout: 3000 }, async t => {
  const g = await start({ limits: { ...limits, maxWallMs: 35 } });
  t.after(() => g.stop());
  await stopped(g);
  assert.equal(g.snapshot().stopReason, "aggregate_wall_limit");
  assert.ok(g.snapshot().probeCount >= 1);
});

test("external and preexisting budget cancellation prevent baseline calls", async () => {
  let calls = 0;
  const probe = async () => { calls++; return sample(); };
  const a = new AbortController(); a.abort("private-reason");
  const g = await start({ signal: a.signal, loadProbe: probe });
  assert.equal(g.snapshot().stopReason, "external_abort");
  const b = budget(); b.close("earlier_limit");
  const h = await start({ requestBudget: b, loadProbe: probe });
  assert.equal(h.snapshot().stopReason, "earlier_limit");
  assert.equal(calls, 0);
});

test("closing the shared budget interrupts an active read and late samples cannot reopen it", { timeout: 3000 }, async t => {
  const b = budget();
  let resolveRead, entered;
  const reading = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const g = await start({ requestBudget: b, loadProbe: () => {
    if (calls++ === 0) return sample();
    entered();
    return new Promise(resolve => { resolveRead = resolve; });
  } });
  t.after(() => g.stop());
  await reading;
  b.close("aggregate_token_limit");
  resolveRead(sample());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.snapshot().stopReason, "aggregate_token_limit");
  assert.equal(g.snapshot().state, "stopped");
  assert.equal(calls, 2);
});

test("missing or invalid explicit limits reject before any probe", async () => {
  let calls = 0;
  const loadProbe = async () => { calls++; return sample(); };
  for (const name of Object.keys(limits)) {
    await assert.rejects(start({ loadProbe, limits: { ...limits, [name]: undefined } }));
  }
  for (const maxWallMs of [0, -1, 1.5, Infinity, 2_147_483_648, "5000"]) {
    await assert.rejects(start({ loadProbe, limits: { ...limits, maxWallMs } }));
  }
  assert.equal(calls, 0);
});

test("load failure cancels a real Desktop fixture and retains unknown in-flight usage", { timeout: 5000 }, async t => {
  const { runDesktopFixture } = await import("../src/evals/desktopFixtureRunner.js");
  const { resolveModelConfig } = await import("../src/model/providers.js");
  const b = budget();
  let httpCalls = 0, transportSignal;
  const g = await start({ requestBudget: b, loadProbe: async () => sample({ http5xxCount: httpCalls ? 1 : 0 }) });
  t.after(() => g.stop());
  const result = await runDesktopFixture({
    fixture: { id: "synthetic-load-cancellation", synthetic: true, prompt: "Answer with 42." },
    tools: [], expectedServedModel: "fixture-model", transportProfile: "direct-cortex",
    modelConfig: { ...resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" }),
      baseUrl: "http://local-fixture.invalid/v1", apiKey: "synthetic-test-only" },
    limits: { maxModelTurns: 2, maxHttpCalls: 2, maxToolCalls: 0, maxWallMs: 2000, maxCompletionTokens: 20 },
    requestBudget: b, inputTokenCounter: { identity: "synthetic-test-counter", count: async () => 10 },
    fetchImpl: async (_url, options) => {
      httpCalls++;
      transportSignal = options.signal;
      return new Promise(() => {});
    },
    verify: () => ({ verdict: "pass" })
  });
  assert.equal(httpCalls, 1);
  assert.equal(transportSignal.aborted, true);
  assert.equal(result.status, "aborted");
  assert.equal(result.stopReason, "primary_traffic_5xx");
  assert.equal(result.verifiedComplete, false);
  assert.equal(result.requests[0].budgetReceipt.usageKnown, false);
  assert.equal(result.requestBudget.chargedTokens, 30);
  assert.equal(result.requestBudget.activeRequests, 0);
  assert.equal(g.snapshot().stopReason, "primary_traffic_5xx");
});
