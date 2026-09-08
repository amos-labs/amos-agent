import test from "node:test";
import assert from "node:assert/strict";
import { createFixtureRequestBudget } from "../src/evals/fixtureRequestBudget.js";

const budget = extra => createFixtureRequestBudget({ maxHttpCalls: 10, maxTotalTokens: 100, maxInputTokensPerRequest: 50, maxConcurrentRequests: 2, ...extra });
const tokens = { inputTokens: 10, maxOutputTokens: 40 };

test("all in-flight output allowances are reserved before another request is admitted", () => {
  const b = budget({ maxTotalTokens: 90 });
  const first = b.reserve(tokens);
  assert.throws(() => b.reserve(tokens), /aggregate_token_limit/);
  assert.equal(b.signal.aborted, true);
  assert.equal(b.snapshot().httpCalls, 1);
  assert.equal(b.snapshot().reservedTokens, 50);
  assert.equal(first.complete().chargedTokens, 50);
  assert.equal(b.snapshot().activeRequests, 0);
  assert.throws(() => b.reserve({ inputTokens: 0, maxOutputTokens: 1 }), /aggregate_token_limit/);
});

test("known usage refunds unused output once but never refunds the HTTP attempt", () => {
  const b = budget({ maxHttpCalls: 2, maxTotalTokens: 70 });
  const first = b.reserve(tokens);
  const receipt = first.complete({ inputTokens: 10, outputTokens: 3 });
  assert.equal(receipt.chargedTokens, 13);
  assert.deepEqual(first.complete({ inputTokens: 0, outputTokens: 0 }), receipt);
  receipt.chargedTokens = 0;
  assert.equal(first.complete().chargedTokens, 13);
  b.reserve(tokens).complete();
  assert.equal(b.snapshot().chargedTokens, 63);
  assert.equal(b.snapshot().unknownUsageCalls, 1);
  assert.throws(() => b.reserve({ inputTokens: 0, maxOutputTokens: 1 }), /aggregate_http_limit/);
});

test("concurrency and input limits reject before consuming an HTTP attempt", () => {
  const b = budget({ maxConcurrentRequests: 1 });
  b.reserve(tokens);
  assert.throws(() => b.reserve(tokens), /aggregate_concurrency_limit/);
  assert.equal(b.snapshot().httpCalls, 1);
  const input = budget({ maxInputTokensPerRequest: 9 });
  assert.throws(() => input.reserve(tokens), /input_token_limit/);
  assert.equal(input.snapshot().httpCalls, 0);
});

test("missing, partial or invalid usage retains the full reservation", () => {
  for (const usage of [null, {}, { inputTokens: 10 }, { outputTokens: 3 }, { inputTokens: -1, outputTokens: 3 }, { inputTokens: 10, outputTokens: "3" }]) {
    const b = budget();
    const receipt = b.reserve(tokens).complete(usage);
    assert.equal(receipt.usageKnown, false);
    assert.equal(b.snapshot().chargedTokens, 50);
    assert.equal(b.snapshot().reservedTokens, 0);
    assert.equal(b.snapshot().unknownUsageCalls, 1);
  }
});

test("tokenizer or server-limit disagreement preserves its charge and closes shared admission", () => {
  for (const [usage, reason, charge] of [
    [{ inputTokens: 9, outputTokens: 3 }, "input_token_count_mismatch", 50],
    [{ inputTokens: 10, outputTokens: 41 }, "reported_output_token_limit", 51],
    [{ inputTokens: 100, outputTokens: 50 }, "input_token_count_mismatch", 150]
  ]) {
    const b = budget();
    const receipt = b.reserve(tokens).complete(usage);
    assert.equal(receipt.chargedTokens, charge);
    assert.equal(b.snapshot().stopReason, reason);
    assert.throws(() => b.reserve(tokens), new RegExp(reason));
  }
});

test("invalid explicit limits and reservations cannot create usable budget", () => {
  for (const maxTotalTokens of [0, -1, 1.5, Infinity, "100"]) assert.throws(() => budget({ maxTotalTokens }), /Positive integer/);
  for (const inputTokens of [-1, 1.5, null, NaN, "10", Number.MAX_SAFE_INTEGER]) {
    const b = budget();
    assert.throws(() => b.reserve({ inputTokens, maxOutputTokens: 40 }), /invalid_token_reservation/);
    assert.equal(b.snapshot().httpCalls, 0);
  }
});
