import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runDesktopFixture } from "../src/evals/desktopFixtureRunner.js";
import { resolveModelConfig } from "../src/model/providers.js";
import { createFixtureRequestBudget } from "../src/evals/fixtureRequestBudget.js";

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

const sharedBudget = extra => createFixtureRequestBudget({ maxHttpCalls: 4, maxTotalTokens: 600, maxInputTokensPerRequest: 100, maxConcurrentRequests: 2, ...extra });
const inputCounter = { identity: "synthetic-tokenizer-v1", count: async () => 10 };

test("shared budget counts final Desktop requests and growing history, then reconciles normalized usage", async () => {
  let calls = 0;
  const counted = [];
  const budget = sharedBudget({ maxHttpCalls: 2, maxTotalTokens: 280 });
  const r = await runDesktopFixture(directOptions({ requestBudget: budget,
    inputTokenCounter: { identity: inputCounter.identity, count: async body => {
      counted.push(structuredClone(body));
      assert.equal(body.model, "fixture-s5");
      assert.equal(body.enable_thinking, false);
      assert.ok(body.tools.some(t => t.function.name === "desktop_read_scratchpad"));
      body.messages.length = 0; // The supplied counter cannot mutate the wire request.
      return 10;
    } },
    fetchImpl: async (_url, request) => {
      assert.ok(JSON.parse(request.body).messages.length > 0);
      return directResponse(++calls === 1 ? call() : { content: "42" });
    } }));
  assert.equal(r.verifiedComplete, true);
  assert.equal(calls, 2);
  assert.ok(counted[1].messages.some(m => m.role === "tool"));
  assert.ok(counted[1].messages.length > counted[0].messages.length);
  assert.equal(r.requestBudget.chargedTokens, 26);
  assert.equal(r.requestBudget.reservedTokens, 0);
  assert.ok(r.requests.every(q => q.dispatched && q.budgetReceipt.usageKnown && q.budgetReceipt.chargedTokens === 13));
  assert.equal(r.requests[0].inputTokenizer, inputCounter.identity);
});

test("shared token reservation blocks a parallel request before transport and cancels the other fixture", async () => {
  const started = Promise.withResolvers();
  let calls = 0;
  const budget = sharedBudget({ maxTotalTokens: 300 });
  const first = runDesktopFixture(options({ requestBudget: budget, inputTokenCounter: inputCounter,
    fetchImpl: async (_url, { signal }) => {
      calls++; started.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stub aborted")), { once: true }));
    } }));
  await started.promise;
  const second = await runDesktopFixture(options({ requestBudget: budget, inputTokenCounter: inputCounter,
    fetchImpl: async () => { calls++; return response({ content: "42" }); } }));
  const a = await first;
  assert.equal(calls, 1);
  assert.equal(second.requests[0].dispatched, false);
  assert.equal(a.stopReason, "aggregate_token_limit");
  assert.equal(second.stopReason, "aggregate_token_limit");
  assert.equal(a.verifiedComplete, false);
  assert.equal(second.verifiedComplete, false);
  assert.equal(budget.snapshot().chargedTokens, 266);
  assert.equal(budget.snapshot().activeRequests, 0);
});

test("input limit and counter failure stop before transport", async () => {
  for (const failCounter of [false, true]) {
    let calls = 0;
    const r = await runDesktopFixture(options({ requestBudget: sharedBudget({ maxInputTokensPerRequest: 9 }),
      inputTokenCounter: failCounter ? { identity: "broken-test-counter", count: async () => { throw new Error("cannot tokenize"); } } : inputCounter,
      fetchImpl: async () => { calls++; return response({ content: "42" }); } }));
    assert.equal(calls, 0);
    assert.equal(r.stopReason, failCounter ? "input_token_count_failed" : "input_token_limit");
    assert.equal(r.requests[0].dispatched, false);
    assert.equal(r.requestBudget.httpCalls, 0);
    assert.equal(r.verifiedComplete, false);
  }
});

test("a missing usage report retains the full charge instead of treating it as free inference", async () => {
  const r = await runDesktopFixture(directOptions({ requestBudget: sharedBudget(), inputTokenCounter: inputCounter,
    fetchImpl: async () => new Response(JSON.stringify({ model: "fixture-s5", choices: [{ message: { role: "assistant", content: "42" } }] }), { headers: { "content-type": "application/json" } }) }));
  assert.equal(r.verifiedComplete, true);
  assert.equal(r.requests[0].budgetReceipt.usageKnown, false);
  assert.equal(r.requestBudget.chargedTokens, 266);
});

test("tokenizer disagreement aborts before executing returned tool proposals", async () => {
  let executions = 0;
  const r = await runDesktopFixture(options({ requestBudget: sharedBudget(),
    inputTokenCounter: { identity: "deliberate-mismatch", count: async () => 9 },
    tools: [{ ...tool, handler: async () => { executions++; return { balance: 42 }; } }],
    fetchImpl: async () => response(call()) }));
  assert.equal(executions, 0);
  assert.equal(r.stopReason, "input_token_count_mismatch");
  assert.equal(r.turns[0].message.tool_calls.length, 1);
  assert.equal(r.requests[0].budgetReceipt.reportedUsage.inputTokens, 10);
  assert.equal(r.verifiedComplete, false);
});

test("wall cancellation closes shared admission while an input counter is still pending", async () => {
  const counting = Promise.withResolvers();
  const budget = sharedBudget();
  let calls = 0;
  const r = await runDesktopFixture(options({ requestBudget: budget,
    limits: { ...limits, maxWallMs: 30 },
    inputTokenCounter: { identity: "delayed-test-counter", count: () => counting.promise },
    fetchImpl: async () => { calls++; return response({ content: "42" }); } }));
  assert.equal(r.stopReason, "wall_limit");
  assert.equal(budget.snapshot().closed, true);
  counting.resolve(10);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.equal(budget.snapshot().httpCalls, 0);
});

test("a request budget and identified counter must be supplied together", async () => {
  for (const extra of [{ requestBudget: sharedBudget() }, { inputTokenCounter: inputCounter }, { requestBudget: sharedBudget(), inputTokenCounter: { count: () => 10 } }]) {
    await assert.rejects(runDesktopFixture(options({ ...extra, fetchImpl: async () => { assert.fail("must reject before transport"); } })), /required together/);
  }
});
