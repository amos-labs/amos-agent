import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  intelligenceRoutingEnvelope,
  intelligenceRouterPayload,
  INTELLIGENCE_ROUTER_ARTIFACT,
  INTELLIGENCE_ROUTER_CONTRACT,
  INTELLIGENCE_ROUTER_FORMAT,
  INTELLIGENCE_ROUTER_MODEL,
  INTELLIGENCE_ROUTER_PROMPT,
  LocalIntelligenceRouter,
  normalizeIntelligenceRouterRolloutMode,
  parseIntelligenceRouterOutput
} from "../src/model/intelligenceRouter.js";
import { signedTextSha256 } from "../src/model/signedText.js";

test("local router uses the narrow 0.8B class-only contract", async () => {
  let request;
  const router = new LocalIntelligenceRouter({
    baseUrl: "http://127.0.0.1:11435",
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        message: { content: '{"minimum_class":"deep"}' }
      }));
    }
  });

  const result = await router.classify({
    messages: [{ role: "user", content: "Explain how the universe works" }],
    tools: [{ name: "search" }]
  });

  assert.equal(result.minimumClass, "deep");
  assert.equal(request.url, "http://127.0.0.1:11435/api/chat");
  assert.equal(request.body.model, INTELLIGENCE_ROUTER_MODEL);
  assert.equal(request.body.think, false);
  assert.deepEqual(request.body.format, INTELLIGENCE_ROUTER_FORMAT);
  assert.equal(request.body.options.num_ctx, 4_096);
  assert.equal(request.body.options.num_predict, 24);
  assert.equal(result.artifactSha256, INTELLIGENCE_ROUTER_ARTIFACT.gguf_sha256);
});

test("local router release pins the champion artifact and conservative prompt", () => {
  assert.equal(INTELLIGENCE_ROUTER_MODEL, "amos-router:0.8b-pilot003-v2");
  assert.equal(INTELLIGENCE_ROUTER_ARTIFACT.qualified, false);
  assert.equal(INTELLIGENCE_ROUTER_ARTIFACT.default_rollout_mode, "active");
  const prompt = readFileSync(
    new URL("../src/model/intelligence-router-v1.txt", import.meta.url),
    "utf8"
  );
  assert.equal(
    signedTextSha256(prompt),
    INTELLIGENCE_ROUTER_ARTIFACT.prompt_sha256
  );
  assert.equal(
    signedTextSha256(prompt.replaceAll("\n", "\r\n")),
    INTELLIGENCE_ROUTER_ARTIFACT.prompt_sha256
  );
});

test("router rollout defaults local-primary and the platform envelope stays bounded", () => {
  assert.equal(normalizeIntelligenceRouterRolloutMode(), "active");
  assert.equal(normalizeIntelligenceRouterRolloutMode("active"), "active");
  assert.equal(normalizeIntelligenceRouterRolloutMode("shadow"), "shadow");
  assert.equal(normalizeIntelligenceRouterRolloutMode("unknown"), "active");
  assert.deepEqual(intelligenceRoutingEnvelope({ minimumClass: "deep", phase: "continue" }), {
    version: 1,
    source: "amos-router",
    phase: "continue",
    workflow: "general",
    minimum_class: "deep",
    requirements: [],
    autonomy: "draft",
    verification: "high",
    classifier_contract: INTELLIGENCE_ROUTER_CONTRACT
  });
});

test("router payload is bounded and excludes system and tool content", () => {
  const payload = intelligenceRouterPayload({
    messages: [
      { role: "system", content: "secret system prompt" },
      { role: "user", content: "x".repeat(5_000) },
      { role: "tool", content: "large tool output" },
      { role: "assistant", content: [{ type: "text", text: "short response" }] }
    ],
    toolCount: 7
  });
  assert.match(payload, /^Classify only the task/);
  assert.match(payload, /assistant: short response/);
  assert.ok(payload.length < 4_300);
  assert.doesNotMatch(payload, /secret system prompt|large tool output/);
});

test("router output rejects extra fields and unknown classes", () => {
  assert.equal(parseIntelligenceRouterOutput('{"minimum_class":"routine"}'), "routine");
  assert.throws(
    () => parseIntelligenceRouterOutput('{"minimum_class":"routine","confidence":1}'),
    /invalid class/
  );
  assert.throws(
    () => parseIntelligenceRouterOutput('{"minimum_class":"extreme"}'),
    /invalid class/
  );
});
