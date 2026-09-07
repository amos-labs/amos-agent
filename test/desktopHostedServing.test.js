import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../src/agentLoop.js";
import { DesktopController } from "../src/desktop/controller.js";
import { createModelClient, resolveModelConfig } from "../src/model/providers.js";
import { ToolRegistry } from "../src/tools/registry.js";

const correlationId = "db85300a-6c13-45ed-a4f9-b1f2fcb7ea76";

function responseFor(amos, stream) {
  const usage = { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 };
  const payload = {
    choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
    usage,
    ...(amos ? { amos } : {})
  };
  // Hosted SSE carries serving evidence after the content, in a separate
  // terminal usage frame with no choices. It must survive stream assembly.
  const frames = [
    { choices: [{ delta: { role: "assistant", content: "done" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage, ...(amos ? { amos } : {}) }
  ];
  return new Response(stream
    ? frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n"
    : JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": stream ? "text/event-stream" : "application/json" }
  });
}

for (const stream of [false, true]) {
  for (const scenario of [
    { route: "canary", model: "stage1-060408-r32-s5", calls: 1, fallback: false, reason: null },
    { route: "opus_fallback", model: "opus-5", calls: 2, fallback: true, reason: "frontier_canary_fallback_opus" },
    { route: "opus", model: "opus-5", calls: 2, fallback: true, reason: "hosted_provider_fallback" },
    { route: null, model: "amos-qwen38-27b-fp8", calls: 1, fallback: false, reason: null }
  ]) {
    test(`hosted ${scenario.route || "base"} evidence reaches Desktop usage (${stream ? "SSE" : "JSON"})`, async () => {
      const config = resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" });
      const amos = {
        provider: "amos-hosted", served_model: scenario.model,
        routed_tier: "frontier", frontier_route: scenario.route,
        fallback_used: scenario.fallback, provider_calls: scenario.calls,
        correlation_id: correlationId
      };
      const client = createModelClient(config, async () => responseFor(amos, stream));
      const result = await client.chat({ messages: [{ role: "user", content: "Reply with done" }],
        onDelta: stream ? () => {} : undefined });
      assert.equal(result.message.content, "done");
      assert.equal(result.usage.model, scenario.model);
      assert.equal(result.usage.requested_model, "auto");
      assert.equal(result.usage.served_model, scenario.model);
      assert.equal(result.usage.frontier_route, scenario.route);
      assert.equal(result.usage.fallback_used, scenario.fallback);
      assert.equal(result.usage.fallback_reason, scenario.reason);
      assert.equal(result.usage.provider_calls, scenario.calls);
      assert.equal(result.usage.correlation_id, correlationId);

      const controller = new DesktopController({ userDataPath: "/tmp/amos-hosted-serving-evidence",
        settingsStore: {}, openBrowser() {}, emit() {} });
      const task = { usage: {} };
      const events = [];
      const loop = new AgentLoop({ config: { agent: {}, model: config },
        registry: new ToolRegistry(), approvals: {}, amosClient: {}, modelClient: client });
      await loop.run("Reply with done", { onEvent: event => {
        if (event.type === "usage") events.push(controller.annotateUsageEvent(event, task));
      } });
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.model, scenario.model);
      assert.equal(event.requestedModel, "auto");
      assert.equal(event.servedModel, scenario.model);
      assert.equal(event.frontierRoute, scenario.route);
      assert.equal(event.fallbackUsed, scenario.fallback);
      assert.equal(event.fallbackReason, scenario.reason);
      assert.equal(event.providerCalls, scenario.calls);
      assert.equal(event.correlationId, correlationId);
      assert.equal(event.totalTokens, 120);
      assert.ok(task.usage.models.includes(scenario.model));
    });
  }
}

test("a Frontier selection without serving metadata does not establish S5 identity", async () => {
  const config = resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" });
  const client = createModelClient(config, async () => responseFor({ routed_tier: "frontier" }, false));
  const result = await client.chat({ messages: [{ role: "user", content: "done" }] });
  assert.equal(result.usage.model, "auto");
  assert.equal(result.usage.served_model, null);
  assert.equal(result.usage.frontier_route, null);
  assert.equal(result.usage.provider_calls, null);
  assert.equal(result.usage.fallback_used, false);
});

test("malformed hosted evidence does not invent a model, route or fallback", async () => {
  const config = resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" });
  const client = createModelClient(config, async () => responseFor({
    served_model: { name: "S5" }, frontier_route: "unknown", fallback_used: "true",
    provider_calls: -1, correlation_id: ["not-a-reference"]
  }, false));
  const result = await client.chat({ messages: [{ role: "user", content: "done" }] });
  assert.equal(result.usage.model, "auto");
  assert.equal(result.usage.served_model, null);
  assert.equal(result.usage.frontier_route, null);
  assert.equal(result.usage.provider_calls, null);
  assert.equal(result.usage.correlation_id, null);
  assert.equal(result.usage.fallback_used, false);
});

test("AMOS-shaped metadata from another provider does not change its identity or fallback", async () => {
  const config = resolveModelConfig({ AMOS_MODEL_PROVIDER: "ollama" });
  const client = createModelClient(config, async () => responseFor({
    served_model: "stage1-060408-r32-s5", frontier_route: "opus_fallback", fallback_used: true,
    provider_calls: 2, correlation_id: correlationId
  }, false));
  const result = await client.chat({ messages: [{ role: "user", content: "done" }] });
  assert.equal(result.usage.model, config.model);
  assert.equal(result.usage.served_model, undefined);
  assert.equal(result.usage.frontier_route, undefined);
  assert.equal(result.usage.fallback_used, false);
  assert.equal(result.usage.fallback_reason, null);
});
