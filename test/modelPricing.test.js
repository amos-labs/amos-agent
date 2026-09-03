import test from "node:test";
import assert from "node:assert/strict";
import {
  accumulateUsage,
  estimateUsageCost,
  formatUsdMicros,
  modelRate
} from "../src/model/modelPricing.js";

test("Grok and Kimi published rates estimate token cost", () => {
  assert.ok(modelRate("grok-4.6"));
  const grok = estimateUsageCost({
    model: "grok-4.6",
    inputTokens: 100_000,
    outputTokens: 100_000
  });
  assert.equal(grok.costUsedMicrousd, 800_000);
  assert.equal(grok.estimated, true);

  const kimi = estimateUsageCost({
    model: "kimi-k2.7-code",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000
  });
  assert.equal(kimi.costUsedMicrousd, 4_950_000);
});

test("unknown models accumulate tokens without inventing a price", () => {
  const usage = estimateUsageCost({
    model: "unknown-local",
    inputTokens: 10,
    outputTokens: 5
  });
  assert.equal(usage.costUsedMicrousd, 0);
  assert.equal(usage.estimated, false);
  assert.equal(usage.totalTokens, 15);

  const summed = accumulateUsage(usage, {
    inputTokens: 2,
    outputTokens: 1,
    totalTokens: 3,
    costUsedMicrousd: 100,
    model: "grok-4.6"
  });
  assert.equal(summed.totalTokens, 18);
  assert.equal(summed.costUsedMicrousd, 100);
  assert.deepEqual(summed.models, ["grok-4.6"]);
  assert.equal(formatUsdMicros(100), "$0.0001");
});

test("Grok long-context rates double once the prompt reaches 200k tokens", () => {
  const short = estimateUsageCost({
    model: "grok-4.6",
    inputTokens: 199_999,
    outputTokens: 1_000
  });
  const long = estimateUsageCost({
    model: "grok-4.6",
    inputTokens: 200_000,
    outputTokens: 1_000
  });
  assert.ok(long.costUsedMicrousd > short.costUsedMicrousd);
  assert.equal(long.costUsedMicrousd, 812_000);
});

test("GPT-6 Astra pricing applies its asymmetric long-context rates", () => {
  const base = estimateUsageCost({
    model: "gpt-6-astra",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000
  });
  assert.equal(base.costUsedMicrousd, 95_000_000);
  assert.equal(base.estimated, true);

  const cached = estimateUsageCost({
    model: "gpt-6-astra",
    inputTokens: 272_000,
    cachedInputTokens: 100_000,
    outputTokens: 1_000
  });
  assert.equal(cached.costUsedMicrousd, 3_715_000);
});

test("usage accumulation retains wall speed and local runtime fallback evidence", () => {
  const first = accumulateUsage({}, {
    inputTokens: 1_000,
    outputTokens: 100,
    totalTokens: 1_100,
    latencyMs: 20_000,
    timeToFirstOutputMs: 15_000,
    generationMs: 5_000,
    promptEvalMs: 14_000,
    requestedRuntime: "mtplx",
    runtime: "mtplx",
    fallbackUsed: false,
    model: "amos-local-qwen38-mtplx"
  });
  const second = accumulateUsage(first, {
    inputTokens: 500,
    outputTokens: 50,
    totalTokens: 550,
    latencyMs: 40_000,
    timeToFirstOutputMs: 35_000,
    generationMs: 5_000,
    requestedRuntime: "mtplx",
    runtime: "ollama",
    fallbackUsed: true,
    fallbackReason: "primary_transport_failed",
    model: "qwen-q4"
  });

  assert.equal(second.runtime, "ollama");
  assert.equal(second.requestedRuntime, "mtplx");
  assert.equal(second.runtimeFallbacks, 1);
  assert.equal(second.performance.requestCount, 2);
  assert.equal(second.performance.totalLatencyMs, 60_000);
  assert.equal(second.performance.averageLatencyMs, 30_000);
  assert.equal(second.performance.averageTimeToFirstOutputMs, 25_000);
  assert.equal(second.performance.generationTokensPerSecond, 15);
});
