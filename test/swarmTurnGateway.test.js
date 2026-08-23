import test from "node:test";
import assert from "node:assert/strict";
import { SwarmTurnOrchestrator } from "../src/research/swarmTurnGateway.js";

test("the swarm turn gateway fans out proposals, critiques them, and returns one integrated action", async () => {
  const calls = [];
  const traces = [];
  const fetchImpl = async (_url, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload);
    const index = calls.length;
    return new Response(JSON.stringify({
      id: `response-${index}`,
      model: payload.model,
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: `response ${index}` }
      }],
      usage: { prompt_tokens: 10 * index, completion_tokens: index, total_tokens: 11 * index }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  let tick = 0;
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    backendApiKey: "secret",
    fetchImpl,
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    monotonicNow: () => tick += 25,
    onTrace: (trace) => traces.push(trace)
  });

  const result = await gateway.complete({
    model: "gateway-alias",
    messages: [
      { role: "system", content: "Use the terminal protocol." },
      { role: "user", content: "Fix the failing task." }
    ],
    max_tokens: 2_000,
    temperature: 0.4
  });

  assert.equal(calls.length, 4);
  assert.match(calls[0].messages[0].content, /PRIVATE AMOS ROLE/);
  assert.match(calls[1].messages[0].content, /different approach/);
  assert.equal(Object.hasOwn(calls[2], "response_format"), false);
  assert.match(calls[2].messages.at(-1).content, /PRIVATE CANDIDATE BOARD/);
  assert.match(calls[3].messages.at(-1).content, /PRIVATE VERIFIER CRITIQUE/);
  assert.equal(result.choices[0].message.content, "response 4");
  assert.deepEqual(result.usage, {
    prompt_tokens: 100,
    completion_tokens: 10,
    total_tokens: 110
  });
  assert.equal(result.amos_swarm.stageCount, 4);
  assert.equal(traces.length, 1);
  assert.match(traces[0].digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(traces[0].stages.map((stage) => stage.stage), [
    "candidate:primary",
    "candidate:alternative",
    "critic",
    "integrator"
  ]);
});

test("the swarm turn gateway rejects streaming rather than returning a false stream", async () => {
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080/v1",
    backendModel: "qwen-test",
    fetchImpl: async () => assert.fail("the backend must not be called")
  });
  await assert.rejects(
    gateway.complete({
      model: "gateway-alias",
      stream: true,
      messages: [{ role: "user", content: "hello" }]
    }),
    /streaming is not supported/
  );
});

test("the swarm turn gateway recovers a reasoning-only integration without replaying candidates", async () => {
  const calls = [];
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    internalMaxTokens: 1_024,
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      calls.push(payload);
      const index = calls.length;
      const exhausted = index === 4;
      return new Response(JSON.stringify({
        id: `response-${index}`,
        model: payload.model,
        choices: [{
          index: 0,
          finish_reason: exhausted ? "length" : "stop",
          message: exhausted
            ? { role: "assistant", content: null, reasoning: "unfinished reasoning" }
            : { role: "assistant", content: `visible response ${index}` }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await gateway.complete({
    model: "gateway-alias",
    messages: [{ role: "user", content: "Fix the task." }],
    max_tokens: 256
  });

  assert.equal(calls.length, 5);
  assert.equal(calls[4].enable_thinking, false);
  assert.deepEqual(calls[4].chat_template_kwargs, { enable_thinking: false });
  assert.equal(calls[4].max_tokens, 1_024);
  assert.equal(result.choices[0].message.content, "visible response 5");
  assert.equal(result.amos_swarm.stageCount, 5);
  assert.deepEqual(result.usage, {
    prompt_tokens: 50,
    completion_tokens: 25,
    total_tokens: 75
  });
});
