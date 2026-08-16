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
    inputTokens: 1_000_000,
    outputTokens: 1_000_000
  });
  assert.equal(grok.costUsedMicrousd, 8_000_000);
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
