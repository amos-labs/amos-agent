import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  parseExpertTrace,
  simulateExpertCache,
  slotsForBudget,
  sweepExpertCache
} from "../src/experiments/expertCache.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/expert-cache-trace.jsonl", import.meta.url)
);

test("expert trace parser accepts routing only and normalizes the contract", async () => {
  const trace = parseExpertTrace(await readFile(fixturePath, "utf8"));
  assert.equal(trace.metadata.model, "fixture-moe");
  assert.equal(trace.metadata.layers, 2);
  assert.equal(trace.metadata.expertsPerLayer, 8);
  assert.equal(trace.metadata.activeExperts, 2);
  assert.equal(trace.tokens.length, 6);
  assert.deepEqual(trace.tokens[0].experts, [[0, 1], [4, 5]]);
});

test("expert trace rejects payload data, duplicate experts, and invalid layers", () => {
  const metadata = JSON.stringify({
    type: "metadata",
    schema: "amos.expert-routing-trace",
    version: 1,
    model: "fixture",
    layers: 1,
    experts_per_layer: 4,
    active_experts: 2,
    expert_bytes: 1024
  });
  assert.throws(
    () => parseExpertTrace(`${metadata}\n${JSON.stringify({
      type: "token",
      trace_id: "trace",
      token_index: 0,
      phase: "decode",
      workflow: "test",
      experts: [[0, 1]],
      prompt: "must never enter a routing trace"
    })}`),
    /unsupported field prompt/
  );
  assert.throws(
    () => parseExpertTrace(`${metadata}\n${JSON.stringify({
      type: "token",
      trace_id: "trace",
      token_index: 0,
      phase: "decode",
      workflow: "test",
      experts: [[1, 1]]
    })}`),
    /repeats an expert/
  );
  assert.throws(
    () => parseExpertTrace(`${metadata}\n${JSON.stringify({
      type: "token",
      trace_id: "trace",
      token_index: 0,
      phase: "decode",
      workflow: "test",
      experts: [[0, 1], [2, 3]]
    })}`),
    /must contain 1 expert layers/
  );
});

test("LRU reports reproducible hit, cold-byte, phase, and footprint metrics", async () => {
  const trace = parseExpertTrace(await readFile(fixturePath, "utf8"));
  const result = simulateExpertCache(trace, {
    policy: "lru",
    slotsPerLayer: 2
  });
  assert.equal(result.accesses, 24);
  assert.equal(result.hits, 12);
  assert.equal(result.misses, 12);
  assert.equal(result.hitRate, 0.5);
  assert.equal(result.cacheFootprintBytes, 4 * 1024 ** 2);
  assert.equal(result.estimatedResidentBytes, 8 * 1024 ** 2);
  assert.equal(result.coldBytes, 12 * 1024 ** 2);
  assert.equal(result.coldBytesPerToken.maximum, 4 * 1024 ** 2);
  assert.equal(result.coldRangesPerToken.maximum, 2);
  assert.equal(result.reuseTokenDistance.p50, 1);
  assert.equal(result.reuseTokenDistance.p95, 2);
  assert.equal(result.phases.prefill.accesses, 8);
  assert.equal(result.phases.decode.accesses, 16);
  assert.equal(result.workflows["campaign-analysis"].hitRate, 0.5);
});

test("TinyLFU protects the recurring hot set from one-off workflow pollution", async () => {
  const trace = parseExpertTrace(await readFile(fixturePath, "utf8"));
  const lru = simulateExpertCache(trace, { policy: "lru", slotsPerLayer: 2 });
  const tinylfu = simulateExpertCache(trace, { policy: "tinylfu", slotsPerLayer: 2 });
  assert.ok(tinylfu.hitRate > lru.hitRate);
  assert.equal(tinylfu.hits, 16);
  assert.equal(tinylfu.misses, 8);
});

test("policy sweep ranks bounded configurations and rejects unknown policies", async () => {
  const trace = parseExpertTrace(await readFile(fixturePath, "utf8"));
  const results = sweepExpertCache(trace, {
    policies: ["lru", "lfu", "slru", "tinylfu"],
    slots: [2, 4]
  });
  assert.equal(results.length, 8);
  assert.ok(results[0].hitRate >= results.at(-1).hitRate);
  assert.ok(
    results.find((result) => result.policy === "slru" && result.slotsPerLayer === 4).hitRate > 0
  );
  assert.throws(
    () => simulateExpertCache(trace, { policy: "magic", slotsPerLayer: 2 }),
    /Unknown ExpertCache policy/
  );
});

test("memory budgets derive bounded per-layer slot counts", async () => {
  const trace = parseExpertTrace(await readFile(fixturePath, "utf8"));
  assert.equal(slotsForBudget(trace.metadata, 8 * 1024 ** 2), 2);
  assert.equal(slotsForBudget(trace.metadata, 12 * 1024 ** 2), 4);
  assert.equal(slotsForBudget(trace.metadata, 2 * 1024 ** 2), 0);
  assert.equal(slotsForBudget(trace.metadata, 100 * 1024 ** 2), 8);
  const results = sweepExpertCache(trace, {
    policies: ["lru"],
    slots: [],
    budgetsBytes: [8 * 1024 ** 2, 12 * 1024 ** 2]
  });
  assert.deepEqual(
    results.map((result) => result.slotsPerLayer).sort((left, right) => left - right),
    [2, 4]
  );
  assert.ok(results.every((result) => result.requestedBudgetBytes));
});

test("metadata cannot activate more experts than a layer owns", () => {
  assert.throws(
    () => parseExpertTrace(`${JSON.stringify({
      type: "metadata",
      schema: "amos.expert-routing-trace",
      version: 1,
      model: "invalid",
      layers: 1,
      experts_per_layer: 2,
      active_experts: 3,
      expert_bytes: 1024
    })}\n${JSON.stringify({
      type: "token",
      trace_id: "trace",
      token_index: 0,
      phase: "decode",
      workflow: "test",
      experts: [[0, 1, 2]]
    })}`),
    /active_experts cannot exceed experts_per_layer/
  );
});
