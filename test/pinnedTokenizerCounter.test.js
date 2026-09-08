import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPinnedTokenizerCounter } from "../src/evals/pinnedTokenizerCounter.js";

const limits = { startupTimeoutMs: 1000, countTimeoutMs: 100, maxPendingCounts: 2, maxRequestBytes: 4096 };
const sha = value => createHash("sha256").update(value).digest("hex");
async function setup(t, { startup = true, reply = (request, send) => send({ type: "count", id: request.id, inputTokens: request.body.tokens }), readyOverride = {}, ...extra } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "amos-counter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, '{"syntheticProtocolTest":true}\n');
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let kills = 0;
  child.kill = () => { kills++; child.emit("exit", 0); return true; };
  const requests = [];
  const send = value => child.stdout.write(JSON.stringify(value) + "\n");
  child.stdin.on("data", data => {
    const request = JSON.parse(data.toString()); requests.push(request); reply(request, send);
  });
  const promise = createPinnedTokenizerCounter({
    pythonExecutable: join(directory, "synthetic-python"), tokenizerDirectory: directory, manifestPath, limits,
    spawnImpl: (_command, args, options) => {
      assert.equal(options.env.HF_HUB_OFFLINE, "1");
      assert.equal(options.env.TRANSFORMERS_OFFLINE, "1");
      if (startup) readFile(args[0]).then(source => send({ type: "ready", manifestSha256: args[4], workerSha256: sha(source), ...readyOverride }));
      return child;
    }, ...extra
  });
  return { promise, child, send, requests, kills: () => kills };
}

test("one pinned worker counts repeated full bodies without changing tool argument strings", async t => {
  const f = await setup(t);
  const counter = await f.promise; t.after(() => counter.close());
  const body = { tokens: 123, messages: [{ role: "assistant", tool_calls: [{ function: { arguments: '{"name":"café"}' } }] }] };
  assert.equal(await counter.count(body), 123);
  assert.equal(await counter.count({ ...body, tokens: 321 }), 321);
  assert.deepEqual(f.requests[0].body, body);
  assert.match(counter.identity, /^pinned-tokenizer-v1:[a-f0-9]{64}$/);
  assert.equal(f.kills(), 0);
});

test("response IDs route concurrent counts even when completion order differs", async t => {
  const waiting = [];
  const f = await setup(t, { reply: (r, send) => { waiting.push(r); if (waiting.length === 2) for (const item of [...waiting].reverse()) send({ type: "count", id: item.id, inputTokens: item.body.tokens }); } });
  const c = await f.promise; t.after(() => c.close());
  assert.deepEqual(await Promise.all([c.count({ tokens: 12 }), c.count({ tokens: 34 })]), [12, 34]);
});

test("startup requires exact manifest and worker bindings", async t => {
  for (const readyOverride of [{ manifestSha256: "wrong" }, { workerSha256: "wrong" }, { type: "error" }]) {
    const f = await setup(t, { readyOverride });
    await assert.rejects(f.promise, /tokenizer_startup_binding_failed/);
    assert.ok(f.kills() > 0);
  }
});

test("startup timeout kills an unresponsive worker", { timeout: 3000 }, async t => {
  const f = await setup(t, { startup: false, limits: { ...limits, startupTimeoutMs: 15 } });
  await assert.rejects(f.promise, /tokenizer_startup_timeout/);
  assert.ok(f.kills() > 0);
});

test("count timeout rejects all queued work and prevents later reuse", { timeout: 3000 }, async t => {
  const f = await setup(t, { reply: () => {}, limits: { ...limits, countTimeoutMs: 15 } });
  const c = await f.promise; t.after(() => c.close());
  await Promise.all([assert.rejects(c.count({}), /tokenizer_count_timeout/), assert.rejects(c.count({}), /tokenizer_count_timeout/)]);
  await assert.rejects(c.count({}), /tokenizer_count_timeout/);
  assert.ok(f.kills() > 0);
});

test("count cancellation stops the worker and rejects parallel counts", async t => {
  const f = await setup(t, { reply: () => {} });
  const c = await f.promise; t.after(() => c.close());
  const a = new AbortController();
  const first = assert.rejects(c.count({}, { signal: a.signal }), /tokenizer_count_aborted/);
  const second = assert.rejects(c.count({}), /tokenizer_count_aborted/);
  a.abort(); await Promise.all([first, second]);
  assert.ok(f.kills() > 0);
});

test("pre-canceled count never writes a body", async t => {
  const f = await setup(t); const c = await f.promise; t.after(() => c.close());
  const a = new AbortController(); a.abort();
  await assert.rejects(c.count({}, { signal: a.signal }), /tokenizer_count_aborted/);
  assert.equal(f.requests.length, 0);
  assert.equal(await c.count({ tokens: 7 }), 7);
});

test("pending and byte limits reject work before writing another body", async t => {
  const f = await setup(t, { reply: () => {}, limits: { ...limits, maxPendingCounts: 1 } });
  const c = await f.promise; t.after(() => c.close());
  const first = assert.rejects(c.count({}), /tokenizer_pending_limit/);
  await assert.rejects(c.count({}), /tokenizer_pending_limit/); await first;
  assert.equal(f.requests.length, 1);
  const h = await setup(t, { limits: { ...limits, maxRequestBytes: 20 } });
  const d = await h.promise; t.after(() => d.close());
  await assert.rejects(d.count({ large: "x".repeat(100) }), /tokenizer_request_limit/);
  assert.equal(h.requests.length, 0);
});

test("malformed, unknown, fractional and negative responses close admission", async t => {
  for (const reply of [
    (_r, send) => send({ type: "count", id: 999, inputTokens: 1 }),
    (r, send) => send({ type: "count", id: r.id, inputTokens: -1 }),
    (r, send) => send({ type: "count", id: r.id, inputTokens: 1.5 }),
    (_r, send) => send({ type: "error", secret: "must-not-escape" })
  ]) {
    const f = await setup(t, { reply }); const c = await f.promise; t.after(() => c.close());
    await assert.rejects(c.count({}), error => error.message === "tokenizer_count_response_invalid");
    assert.ok(f.kills() > 0);
  }
});

test("worker exit and oversized output terminate pending counts", async t => {
  for (const action of [child => child.emit("exit", 1), child => child.stdout.write("x".repeat(65_537))]) {
    const f = await setup(t, { reply: () => {} }); const c = await f.promise; t.after(() => c.close());
    const result = assert.rejects(c.count({}), /tokenizer_worker_exit|tokenizer_response_limit/);
    action(f.child); await result;
  }
});

test("external cancellation closes an initialized worker", async t => {
  const a = new AbortController(); const f = await setup(t, { signal: a.signal });
  const c = await f.promise; t.after(() => c.close()); a.abort();
  await assert.rejects(c.count({}), /tokenizer_counter_aborted/);
});

test("explicit limits are validated before spawn", async () => {
  for (const key of Object.keys(limits)) {
    await assert.rejects(createPinnedTokenizerCounter({ pythonExecutable: "/unused/python", tokenizerDirectory: "/unused/model", manifestPath: "/unused/manifest", limits: { ...limits, [key]: undefined } }), /Invalid explicit counter limit/);
  }
});
