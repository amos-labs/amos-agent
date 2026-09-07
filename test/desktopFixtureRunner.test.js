import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runDesktopFixture } from "../src/evals/desktopFixtureRunner.js";
import { resolveModelConfig } from "../src/model/providers.js";

const limits = { maxModelTurns: 6, maxHttpCalls: 6, maxWallMs: 2000, maxCompletionTokens: 256 };
const fixture = { id: "synthetic-balance", synthetic: true, prompt: "Read the balance and report it." };
const tool = { name: "fixture_balance", description: "Read a synthetic balance.", readOnly: true,
  parameters: { type: "object", properties: {}, additionalProperties: false }, handler: async () => ({ balance: 42 }) };
function config() { return { ...resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" }), apiKey: "private-test-credential" }; }
function response(delta, model = "fixture-s5") {
  const frames = [
    { choices: [{ delta }] },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      amos: { provider: "amos-hosted", served_model: model, frontier_route: "canary", fallback_used: false, provider_calls: 1 } }
  ];
  return new Response(frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}
function call(id = "call-1", name = "fixture_balance") { return { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "{}" } }] }; }
function options(extra = {}) {
  return { fixture, tools: [tool], modelConfig: config(), expectedServedModel: "fixture-s5", limits,
    verify: r => ({ verdict: r.answer === "42" ? "pass" : "fail" }), ...extra };
}

test("Desktop fixture executes real tool loop, captures requests/bytes, and requires independent verification", async () => {
  let calls = 0;
  const r = await runDesktopFixture(options({ fetchImpl: async (_url, request) => {
    assert.equal(request.headers.Authorization, "Bearer private-test-credential");
    assert.equal(JSON.parse(request.body).max_completion_tokens, 256);
    return response(++calls === 1 ? call() : { content: "42" });
  }}));
  assert.equal(r.verifiedComplete, true);
  assert.equal(calls, 2);
  assert.equal(r.requests[0].body.messages[0].role, "system");
  assert.ok(r.requests[0].body.tools.some(t => t.function.name === "fixture_balance"));
  assert.ok(r.requests[1].body.messages.some(m => m.role === "tool" && m.tool_call_id === "call-1"));
  assert.ok(r.events.some(e => e.type === "tool_end"));
  assert.equal(r.requests[0].responseCaptureComplete, true);
  assert.equal(r.requests[0].responseBytesSha256, createHash("sha256").update(r.requests[0].responseBody).digest("hex"));
  assert.equal(r.turns[1].usage.served_model, "fixture-s5");
  assert.equal(r.missionComparisonEligible, false);
  assert.doesNotMatch(JSON.stringify(r), /private-test-credential|Authorization/);
});

test("failed tool outcome and successful correction both survive with their tool-call IDs", async () => {
  let calls = 0, executions = 0;
  const r = await runDesktopFixture(options({ tools: [{ ...tool, handler: async () => {
    if (++executions === 1) throw new Error("fixture temporary failure");
    return { balance: 42 };
  }}], fetchImpl: async () => response(++calls < 3 ? call(`call-${calls}`) : { content: "42" }) }));
  assert.equal(r.verifiedComplete, true);
  assert.ok(r.events.some(e => e.type === "tool_error" && e.error === "fixture temporary failure"));
  const outcomes = r.transcript.filter(m => m.role === "tool");
  assert.deepEqual(outcomes.map(m => m.tool_call_id), ["call-1", "call-2"]);
  assert.match(outcomes[0].content, /fixture temporary failure/);
  assert.match(outcomes[1].content, /42/);
});

test("an unavailable tool remains a failure even if the model later claims success", async () => {
  let calls = 0;
  const r = await runDesktopFixture(options({ fetchImpl: async () => response(++calls === 1 ? call("bad", "unavailable_tool") : { content: "42" }),
    verify: r => ({ verdict: r.events.some(e => e.type === "tool_error") ? "fail" : "pass" }) }));
  assert.equal(r.status, "answered");
  assert.equal(r.verifiedComplete, false);
  assert.match(r.transcript.find(m => m.role === "tool").content, /Unknown tool/);
});

for (const [name, restriction, reason] of [
  ["HTTP", { maxHttpCalls: 1 }, "http_call_limit"],
  ["model turn", { maxModelTurns: 1 }, "model_turn_limit"]
]) test(`${name} bound stops further inference and retains partial evidence`, async () => {
  let calls = 0;
  const r = await runDesktopFixture(options({ limits: { ...limits, ...restriction }, fetchImpl: async () => { calls++; return response(call()); } }));
  assert.equal(r.status, "aborted");
  assert.equal(r.stopReason, reason);
  assert.equal(calls, 1);
  assert.equal(r.verifiedComplete, false);
  assert.equal(r.requests.length, 1);
});

test("an unexpected serving identity cannot be graded as a successful target arm", async () => {
  const r = await runDesktopFixture(options({ fetchImpl: async () => response({ content: "42" }, "different-model"), verify: () => ({ verdict: "pass" }) }));
  assert.equal(r.stopReason, "serving_identity_mismatch");
  assert.equal(r.verifiedComplete, false);
  assert.equal(r.turns[0].usage.served_model, "different-model");
});

test("wall bound covers both an unresponsive transport and an unresponsive verifier", async () => {
  for (const stage of ["transport", "verifier"]) {
    const r = await runDesktopFixture(options({ limits: { ...limits, maxWallMs: 30 },
      fetchImpl: async () => stage === "transport" ? new Promise(() => {}) : response({ content: "42" }),
      verify: () => new Promise(() => {}) }));
    assert.equal(r.status, "aborted");
    assert.equal(r.stopReason, "wall_limit");
    assert.equal(r.verifiedComplete, false);
  }
});

test("a malformed verifier result is unknown, not a successful execution label", async () => {
  const r = await runDesktopFixture(options({ fetchImpl: async () => response({ content: "42" }), verify: () => ({ success: true }) }));
  assert.equal(r.verification.verdict, "unknown");
  assert.equal(r.verifiedComplete, false);
});

test("a hidden hosted stream retry is stopped and its failed raw response is retained", async () => {
  let calls = 0;
  const r = await runDesktopFixture(options({ fetchImpl: async () => {
    calls++;
    return new Response('data: {"error":{"code":"provider_stream_error","message":"stream stopped"}}\n\n', { headers: { "content-type": "text/event-stream" } });
  }}));
  assert.equal(calls, 1);
  assert.equal(r.stopReason, "transport_retry_disallowed");
  assert.equal(r.verifiedComplete, false);
  assert.match(r.requests[0].responseBody, /provider_stream_error/);
});
