import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiResearchWorker } from "../src/research/openAiResearchWorker.js";
import { RESEARCH_TEST_DIGESTS } from "./fixtures/researchProtocolFixtures.js";

test("the canonical research worker supports pinned Qwen and Fable-shaped loopback controls", async () => {
  const calls = [];
  const dates = [
    new Date("2026-08-22T21:00:00.000Z"),
    new Date("2026-08-22T21:00:00.100Z")
  ];
  const monotonic = [0, 100];
  const worker = new OpenAiResearchWorker({
    controlId: "qwen-direct",
    model: "amos-qwen38-27b-fp8",
    baseUrl: "http://127.0.0.1:18080",
    apiKey: "test-key",
    dialect: "qwen",
    reasoningEffort: "low",
    fetchImpl: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), options, body });
      if (String(url).endsWith("/v1/models")) {
        return response({ data: [{ id: "amos-qwen38-27b-fp8" }] });
      }
      return response({
        choices: [{ message: { role: "assistant", content: "visible answer" } }],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
        timings: { prompt_ms: 2, predicted_ms: 50 }
      });
    },
    now: () => dates.shift(),
    monotonicNow: () => monotonic.shift()
  });

  assert.equal((await worker.probe()).ready, true);
  const observation = await worker.runCase({
    caseId: "case-001",
    messages: [{ role: "user", content: "Answer." }],
    tools: [{ type: "function", function: { name: "first" } }, {
      type: "function",
      function: { name: "second" }
    }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.a,
    maxOutputTokens: 64,
    reasoningEffortOverride: "none",
    responseFormat: { type: "json_object" }
  });

  assert.equal(calls[0].options.headers.authorization, "Bearer test-key");
  assert.equal(calls[1].body.enable_thinking, false);
  assert.equal(calls[1].body.parallel_tool_calls, false);
  assert.deepEqual(calls[1].body.response_format, { type: "json_object" });
  assert.equal(Object.hasOwn(calls[1].body, "reasoning_effort"), false);
  assert.equal(observation.metrics.generationTokensPerSecond, 100);
  assert.equal(observation.message.content, "visible answer");
});

test("generic research controls carry explicit reasoning and recovery overrides to their gateway", async () => {
  const bodies = [];
  const worker = new OpenAiResearchWorker({
    controlId: "opus-control",
    model: "us.anthropic.claude-opus-5",
    baseUrl: "http://127.0.0.1:11440",
    dialect: "generic",
    reasoningEffort: "high",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return response({
        choices: [{ message: { role: "assistant", content: "answer" } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 }
      });
    }
  });

  const common = {
    caseId: "case-opus",
    messages: [{ role: "user", content: "Answer." }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.a,
    maxOutputTokens: 128
  };
  await worker.runCase(common);
  await worker.runCase({ ...common, reasoningEffortOverride: "none" });

  assert.deepEqual(bodies.map((body) => body.reasoning_effort), ["high", "none"]);
});

function response(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    }
  };
}
