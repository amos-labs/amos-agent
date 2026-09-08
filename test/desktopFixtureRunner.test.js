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

test("tool-call cap permits the exact limit and an explicit zero for answer-only cases", async () => {
  for (const maxToolCalls of [0, 1]) {
    let calls = 0, executions = 0;
    const r = await runDesktopFixture(options({ limits: { ...limits, maxToolCalls },
      tools: [{ ...tool, handler: async () => { executions++; return { balance: 42 }; } }],
      fetchImpl: async () => response(++calls === 1 && maxToolCalls ? call() : { content: "42" }) }));
    assert.equal(r.verifiedComplete, true);
    assert.equal(r.proposedToolCalls, maxToolCalls);
    assert.equal(executions, maxToolCalls);
  }
});

for (const profile of ["hosted", "direct-cortex"]) test(`${profile} rejects a whole over-budget tool batch before any effect`, async () => {
  let executions = 0;
  const delta = { tool_calls: [call("one").tool_calls[0], { ...call("two").tool_calls[0], index: 1 }] };
  const setup = profile === "direct-cortex" ? directOptions : options;
  const r = await runDesktopFixture(setup({ limits: { ...limits, maxToolCalls: 1 },
    tools: [{ ...tool, handler: async () => { executions++; return { balance: 42 }; } }],
    fetchImpl: async () => profile === "direct-cortex" ? directResponse(delta) : response(delta) }));
  assert.equal(r.stopReason, "tool_call_limit");
  assert.equal(r.verifiedComplete, false);
  assert.equal(r.proposedToolCalls, 2);
  assert.equal(r.turns[0].proposedToolCallCount, 2);
  assert.equal(r.turns[0].message.tool_calls.length, 2);
  assert.equal(r.requests.length, 1);
  assert.equal(executions, 0);
});

for (const failure of ["unknown", "handler"]) test(`${failure} tool failure still consumes the cumulative tool-call cap`, async () => {
  let calls = 0, executions = 0;
  const r = await runDesktopFixture(options({ limits: { ...limits, maxToolCalls: 1 },
    tools: [{ ...tool, handler: async () => { executions++; throw new Error("fixture failure"); } }],
    fetchImpl: async () => response(call(`call-${++calls}`, calls === 1 && failure === "unknown" ? "missing_tool" : "fixture_balance")) }));
  assert.equal(r.stopReason, "tool_call_limit");
  assert.equal(r.proposedToolCalls, 2);
  assert.equal(calls, 2);
  assert.equal(executions, failure === "handler" ? 1 : 0);
  assert.ok(r.events.some(e => e.type === "tool_error"));
  assert.equal(r.turns[1].message.tool_calls.length, 1);
  assert.equal(r.verifiedComplete, false);
});

test("invalid explicit tool-call caps fail before transport", async () => {
  let calls = 0;
  for (const maxToolCalls of [-1, 1.5, null, Infinity, "1"]) {
    await assert.rejects(runDesktopFixture(options({ limits: { ...limits, maxToolCalls },
      fetchImpl: async () => { calls++; return response({ content: "42" }); } })), /Explicit integer limit/);
  }
  assert.equal(calls, 0);
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

function directResponse(delta, model = "fixture-s5") {
  const frames = [
    { model, choices: [{ delta }] },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }
  ];
  return new Response(frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}
function directOptions(extra = {}) {
  return options({ transportProfile: "direct-cortex", modelConfig: { ...config(), baseUrl: "http://cortex.fixture.invalid/v1" }, ...extra });
}

test("direct cortex runs both model IDs through Desktop with otherwise identical thinking-off requests", async () => {
  const runs = [];
  for (const model of ["fixture-base", "fixture-s5"]) {
    let calls = 0;
    const sent = [];
    const r = await runDesktopFixture(directOptions({ expectedServedModel: model, fetchImpl: async (url, request) => {
      assert.equal(url, "http://cortex.fixture.invalid/v1/chat/completions");
      assert.equal(request.redirect, "error");
      sent.push(request.body);
      return directResponse(++calls === 1 ? call() : { content: "42" }, model);
    } }));
    assert.equal(r.verifiedComplete, true);
    assert.equal(r.turns.length, 2);
    assert.equal(r.transportProfile, "direct-cortex");
    assert.equal(r.transportOrigin, "http://cortex.fixture.invalid");
    for (const [i, request] of r.requests.entries()) {
      assert.deepEqual(request.body, JSON.parse(sent[i]));
      assert.equal(request.bodyBytesSha256, createHash("sha256").update(sent[i]).digest("hex"));
      assert.equal(request.body.model, model);
      assert.equal(request.body.enable_thinking, false);
      assert.deepEqual(request.body.chat_template_kwargs, { enable_thinking: false });
      assert.deepEqual(request.body.stream_options, { include_usage: true });
      assert.equal(request.body.max_completion_tokens, 256);
      assert.equal(request.body.amos_routing, undefined);
      assert.equal(request.body.amos_routing_shadow, undefined);
      assert.equal(request.body.reasoning_effort, undefined);
      assert.equal(request.clientBody.model, "auto");
      assert.ok(request.clientBody.amos_routing);
      assert.deepEqual(request.clientBody.messages, request.body.messages);
      assert.deepEqual(request.clientBody.tools, request.body.tools);
      assert.equal(request.responseCaptureComplete, true);
    }
    for (const turn of r.turns) {
      assert.equal(turn.raw.model, model);
      assert.equal(turn.raw.amos, undefined);
      assert.deepEqual(turn.servingEvidence, { source: "provider-response-model", expectedModel: model, reportedModel: model, matched: true });
      assert.equal(turn.usage.model, model);
      assert.equal(turn.usage.requested_model, model);
      assert.equal(turn.usage.runtime, "direct-cortex");
      assert.equal(turn.usage.total_tokens, 13);
      for (const key of ["served_model", "frontier_route", "provider_calls", "correlation_id", "fallback_used", "fallback_reason"]) assert.equal(turn.usage[key], null);
    }
    assert.doesNotMatch(JSON.stringify(r), /private-test-credential|Authorization/);
    runs.push(r);
  }
  for (let i = 0; i < 2; i++) {
    const { model: _base, ...baseBody } = runs[0].requests[i].body;
    const { model: _s5, ...s5Body } = runs[1].requests[i].body;
    assert.deepEqual(baseBody, s5Body);
    assert.equal(runs[0].requests[i].modelIndependentBodySha256, runs[1].requests[i].modelIndependentBodySha256);
  }
});

test("direct cortex identity failures stop before executing a proposed side effect", async () => {
  for (const model of ["wrong-model", null, undefined]) {
    let executed = 0;
    const r = await runDesktopFixture(directOptions({ tools: [{ ...tool, handler: async () => { executed++; return {}; } }],
      fetchImpl: async () => new Response(JSON.stringify({ ...(model === undefined ? {} : { model }), choices: [{ message: { role: "assistant", ...call() } }] }), { headers: { "content-type": "application/json" } }),
      verify: () => ({ verdict: "pass" }) }));
    assert.equal(r.stopReason, "serving_identity_mismatch");
    assert.equal(r.verifiedComplete, false);
    assert.equal(executed, 0);
    assert.equal(r.turns[0].servingEvidence.matched, false);
  }
});

test("hosted and direct cortex identity evidence cannot be substituted for one another", async () => {
  const direct = await runDesktopFixture(directOptions({ fetchImpl: async () => new Response(JSON.stringify({
    model: "fixture-s5", amos: { served_model: "fixture-s5", fallback_used: false },
    choices: [{ message: { role: "assistant", content: "42" } }]
  }), { headers: { "content-type": "application/json" } }) }));
  assert.equal(direct.stopReason, "serving_identity_mismatch");
  const hosted = await runDesktopFixture(options({ fetchImpl: async () => directResponse({ content: "42" }) }));
  assert.equal(hosted.stopReason, "serving_identity_mismatch");
  assert.equal(hosted.transportProfile, "hosted");
});

test("direct cortex retains the corrected Desktop SSE assembly for repeated fragments", async () => {
  const frames = [
    { model: "fixture-s5", choices: [{ delta: { content: "  x" } }] },
    { choices: [{ delta: { content: "  x" } }] },
    { choices: [{ delta: { content: "\n\n" }, finish_reason: "stop" }] }
  ];
  const r = await runDesktopFixture(directOptions({
    fetchImpl: async () => new Response(frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }),
    verify: exec => ({ verdict: exec.turns[0].message.content === "  x  x\n\n" ? "pass" : "fail" })
  }));
  assert.equal(r.verifiedComplete, true);
  assert.equal(r.turns[0].message.content, "  x  x\n\n");
});

test("a misspelled transport profile is rejected before any network call", async () => {
  let calls = 0;
  await assert.rejects(runDesktopFixture(directOptions({ transportProfile: "direct", fetchImpl: async () => { calls++; } })), /Unsupported fixture transport profile/);
  assert.equal(calls, 0);
});
