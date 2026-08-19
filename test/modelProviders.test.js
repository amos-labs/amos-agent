import test from "node:test";
import assert from "node:assert/strict";
import {
  AMOS_INTELLIGENCE_ROUTING,
  createModelClient,
  hostedInferenceBaseUrl,
  listModelProviders,
  resolveModelConfig,
  validateModelConfig
} from "../src/model/providers.js";
import { OpenAICompatibleClient } from "../src/model/openAiCompatibleClient.js";
import { OpenAIResponsesClient } from "../src/model/openAiResponsesClient.js";
import { AnthropicMessagesClient } from "../src/model/anthropicMessagesClient.js";
import { INTELLIGENCE_ROUTING_OWNERS } from "../src/model/intelligenceRouter.js";

test("provider catalog exposes managed, customer-cloud, and local deployment modes", () => {
  const providers = listModelProviders();
  assert.ok(providers.some((provider) => provider.id === "amos-hosted" && provider.deployment === "amos"));
  assert.ok(providers.some((provider) => provider.id === "bedrock" && provider.deployment === "customer-cloud"));
  assert.ok(providers.some((provider) => provider.id === "ollama" && provider.deployment === "local"));
  assert.ok(providers.some((provider) => provider.id === "openai" && provider.protocol === "openai-responses"));
  assert.ok(providers.some((provider) => provider.id === "anthropic" && provider.protocol === "anthropic-messages"));
  assert.deepEqual(
    providers.find((provider) => provider.id === "openai").models.map((model) => model.id),
    ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"]
  );
  assert.deepEqual(
    providers.find((provider) => provider.id === "anthropic").models.map((model) => model.id),
    ["claude-sonnet-5", "claude-opus-5", "claude-fable-5"]
  );
  assert.deepEqual(
    providers.find((provider) => provider.id === "xai").models.map((model) => model.id),
    ["grok-4.6", "grok-4.5", "grok-4.3", "grok-build-0.1"]
  );
  assert.deepEqual(
    providers.find((provider) => provider.id === "xai").models.find((model) => model.id === "grok-4.6")
      .supportedReasoningEfforts,
    ["low", "medium", "high", "xhigh"]
  );
  assert.deepEqual(
    providers.find((provider) => provider.id === "xai").models.find((model) => model.id === "grok-4.5")
      .supportedReasoningEfforts,
    ["low", "medium", "high"]
  );
  assert.deepEqual(
    providers.find((provider) => provider.id === "kimi").models.map((model) => model.id),
    ["kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6"]
  );
  const bedrock = providers.find((provider) => provider.id === "bedrock");
  assert.deepEqual(
    bedrock.models.map((model) => model.id),
    [
      "openai.gpt-5.6-luna",
      "openai.gpt-5.6-terra",
      "openai.gpt-5.6-sol",
      "openai.gpt-oss-20b",
      "openai.gpt-oss-120b",
      "anthropic.claude-fable-5",
      "anthropic.claude-sonnet-5",
      "anthropic.claude-opus-5"
    ]
  );
  assert.ok(bedrock.models.every((model) => model.protocol && model.endpointPath));
  assert.equal(bedrock.defaultModel, "openai.gpt-5.6-terra");
  assert.deepEqual(
    bedrock.models.find((model) => model.id === "anthropic.claude-fable-5").dataRetention,
    {
      requiredMode: "provider_data_share",
      dataSharedWithProvider: true,
      maximumRetentionDays: 30
    }
  );
});

test("native providers resolve their protocol, current default, endpoint, and credential", () => {
  const openai = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-key"
  });
  assert.equal(openai.protocol, "openai-responses");
  assert.equal(openai.baseUrl, "https://api.openai.com/v1");
  assert.equal(openai.model, "gpt-5.6-terra");
  assert.equal(openai.apiKey, "openai-key");
  assert.equal(openai.routingOwner, INTELLIGENCE_ROUTING_OWNERS.SELECTED_PROVIDER);
  assert.equal(openai.routingMode, "pinned");
  assert.equal(openai.localRouterMode, "disabled");

  const anthropic = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "anthropic-key"
  });
  assert.equal(anthropic.protocol, "anthropic-messages");
  assert.equal(anthropic.baseUrl, "https://api.anthropic.com/v1");
  assert.equal(anthropic.model, "claude-sonnet-5");
  assert.equal(anthropic.apiVersion, "2023-06-01");
  assert.equal(anthropic.apiKey, "anthropic-key");
  assert.equal(anthropic.routingOwner, INTELLIGENCE_ROUTING_OWNERS.SELECTED_PROVIDER);
  assert.equal(anthropic.routingMode, "pinned");
  assert.equal(anthropic.localRouterMode, "disabled");

  const grok = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "xai",
    XAI_API_KEY: "xai-key"
  });
  assert.equal(grok.protocol, "openai-chat-completions");
  assert.equal(grok.baseUrl, "https://api.x.ai/v1");
  assert.equal(grok.model, "grok-4.6");
  assert.equal(grok.apiKey, "xai-key");
  assert.equal(grok.reasoningEffort, "high");
  assert.equal(grok.requestTimeoutMs, 660_000);
});

test("xAI long-turn timeout remains explicitly configurable and bounded", () => {
  const configured = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "xai",
    XAI_API_KEY: "xai-key",
    XAI_REQUEST_TIMEOUT_MS: "720000"
  });
  const bounded = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "xai",
    XAI_API_KEY: "xai-key",
    GROK_REQUEST_TIMEOUT_MS: "1200000"
  });
  assert.equal(configured.requestTimeoutMs, 720_000);
  assert.equal(bounded.requestTimeoutMs, 900_000);
});

test("model factory selects the protocol adapter and rejects unknown protocols", () => {
  const base = {
    baseUrl: "https://models.example/v1",
    model: "test",
    capabilities: {}
  };
  assert.ok(createModelClient({ ...base, protocol: "openai-chat-completions" }) instanceof OpenAICompatibleClient);
  assert.ok(createModelClient({ ...base, protocol: "openai-responses" }) instanceof OpenAIResponsesClient);
  assert.ok(createModelClient({ ...base, protocol: "anthropic-messages" }) instanceof AnthropicMessagesClient);
  assert.throws(
    () => createModelClient({ ...base, protocol: "imaginary-protocol" }),
    /Unsupported model protocol/
  );
});

test("AMOS Intelligence exposes one automatic route without exposing routed models", () => {
  assert.equal(AMOS_INTELLIGENCE_ROUTING.id, "auto");
  assert.equal(AMOS_INTELLIGENCE_ROUTING.label, "Automatic");
  const managed = listModelProviders().find((provider) => provider.id === "amos-hosted");
  assert.equal(managed.displayName, "AMOS Intelligence");
  assert.equal(managed.models, undefined);
  assert.match(managed.description, /automatically routes every step/i);
});

test("reasoning effort is normalized to each provider or model contract", () => {
  const kimi = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "kimi",
    AMOS_MODEL_API_KEY: "test-key",
    AMOS_MODEL_REASONING_EFFORT: "medium"
  });
  assert.equal(kimi.reasoningEffort, "max");

  const hosted = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "amos-hosted",
    AMOS_MCP_URL: "https://app.amoslabs.com/mcp",
    AMOS_MODEL_REASONING_EFFORT: "max"
  });
  assert.equal(hosted.reasoningEffort, "");
  assert.equal(hosted.routingOwner, INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP);
  assert.equal(hosted.routingMode, "automatic");
  assert.equal(hosted.localRouterMode, "active");

  const anthropic = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-key",
    AMOS_MODEL_REASONING_EFFORT: "none"
  });
  assert.equal(anthropic.reasoningEffort, "medium");

  const bedrockClaude = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "bedrock",
    AMOS_MODEL: "anthropic.claude-sonnet-5",
    AWS_BEARER_TOKEN_BEDROCK: "test-key",
    AMOS_MODEL_REASONING_EFFORT: "none"
  });
  assert.equal(bedrockClaude.reasoningEffort, "medium");

  const localExtraHigh = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "ollama",
    AMOS_MODEL: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
    AMOS_MODEL_REASONING_EFFORT: "xhigh"
  });
  const localDefault = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "ollama",
    AMOS_MODEL: "qwen3:8b"
  });
  assert.equal(localExtraHigh.reasoningEffort, "high");
  assert.equal(localExtraHigh.requestTimeoutMs, 300_000);
  assert.equal(localDefault.reasoningEffort, "medium");
  assert.equal(localDefault.requestTimeoutMs, 120_000);

  const bedrockFable = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "bedrock",
    AMOS_MODEL: "anthropic.claude-fable-5",
    AMOS_BEDROCK_AUTH_MODE: "sigv4",
    AWS_REGION: "us-east-1"
  });
  assert.deepEqual(bedrockFable.modelProfile.dataRetention, {
    requiredMode: "provider_data_share",
    dataSharedWithProvider: true,
    maximumRetentionDays: 30
  });
});

test("AMOS-hosted provider derives its endpoint and reuses the AMOS identity", () => {
  const config = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "amos-hosted",
    AMOS_MCP_URL: "https://app.amoslabs.com/mcp",
    AMOS_MODEL_API_KEY: "must-not-be-forwarded"
  });
  assert.deepEqual(validateModelConfig(config), []);
  assert.equal(config.usesAmosIdentity, true);
  assert.equal(config.baseUrl, "https://app.amoslabs.com/v1");
  assert.equal(config.model, "auto");
  assert.equal(config.routingOwner, INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP);
  assert.equal(config.routingMode, "automatic");
  assert.equal(config.reasoningEffort, "");
  assert.equal(config.apiKey, "");
  assert.equal(config.maxCompletionTokens, 32_768);
  assert.equal(config.contextTokens, 131_072);
  assert.equal(config.requestTimeoutMs, 660_000);
  assert.equal(config.localRouterMode, "active");
});

test("AMOS Local Router rollout is configurable only for automatic hosted routing", () => {
  const active = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "amos-hosted",
    AMOS_MCP_URL: "https://app.amoslabs.com/mcp",
    AMOS_LOCAL_ROUTER_MODE: "active"
  });
  const pinned = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "ollama",
    AMOS_LOCAL_ROUTER_MODE: "active"
  });
  assert.equal(active.localRouterMode, "active");
  assert.equal(pinned.localRouterMode, "disabled");
});

test("local model context follows the qualified runtime window", () => {
  const configured = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "ollama",
    AMOS_MODEL_CONTEXT_TOKENS: "16384"
  });
  const fallback = resolveModelConfig({ AMOS_MODEL_PROVIDER: "ollama" });
  assert.equal(configured.contextTokens, 16_384);
  assert.equal(fallback.contextTokens, 32_768);
});

test("AMOS-hosted long-task limits remain operator configurable and bounded", () => {
  const config = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "amos-hosted",
    AMOS_MCP_URL: "https://app.amoslabs.com/mcp",
    AMOS_MODEL_MAX_COMPLETION_TOKENS: "65536",
    AMOS_MODEL_REQUEST_TIMEOUT_MS: "1200000"
  });

  assert.equal(config.maxCompletionTokens, 65_536);
  assert.equal(config.requestTimeoutMs, 900_000);
});

test("AMOS-hosted endpoint follows a custom AMOS deployment origin", () => {
  assert.equal(
    hostedInferenceBaseUrl("https://company.example.com/mcp?ignored=true"),
    "https://company.example.com/v1"
  );
});

test("AMOS-hosted inference ignores stale BYOK routing values", () => {
  const config = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "amos-hosted",
    AMOS_MCP_URL: "https://platform.custom.amoslabs.com/mcp",
    AMOS_MODEL_BASE_URL: "https://api.moonshot.ai/v1",
    MOONSHOT_BASE_URL: "https://attacker.invalid/v1",
    KIMI_MODEL: "kimi-k3",
    AMOS_MODEL: "some-provider-model",
    AMOS_MODEL_PROTOCOL: "anthropic-messages"
  });

  assert.equal(config.baseUrl, "https://platform.custom.amoslabs.com/v1");
  assert.equal(config.model, "auto");
  assert.equal(config.protocol, "openai-chat-completions");
});

test("only a controlled compatible endpoint accepts an explicit protocol override", () => {
  const config = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "openai-compatible",
    AMOS_MODEL_PROTOCOL: "openai-responses",
    AMOS_MODEL_BASE_URL: "https://gateway.example/v1",
    AMOS_MODEL: "routed-model"
  });
  assert.equal(config.protocol, "openai-responses");
  assert.throws(
    () => resolveModelConfig({
      AMOS_MODEL_PROVIDER: "openai-compatible",
      AMOS_MODEL_PROTOCOL: "imaginary",
      AMOS_MODEL_BASE_URL: "https://gateway.example/v1",
      AMOS_MODEL: "routed-model"
    }),
    /Unsupported model protocol/
  );
});

test("provider-controlled clients cannot opt into AMOS Desktop routing", async () => {
  let routerCalls = 0;
  let body;
  const client = createModelClient({
    provider: "openai-compatible",
    protocol: "openai-chat-completions",
    displayName: "Controlled endpoint",
    baseUrl: "https://gateway.example/v1",
    model: "controlled-model",
    usesAmosIdentity: true,
    routingOwner: INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP,
    routingMode: "automatic",
    localRouterMode: "active",
    requestTimeoutMs: 1_000,
    capabilities: {},
    intelligenceRouter: {
      classify: async () => {
        routerCalls += 1;
        return { minimumClass: "routine" };
      }
    }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonModelResponse("ready");
  });

  await client.chat({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(routerCalls, 0);
  assert.equal(client.config.routingOwner, INTELLIGENCE_ROUTING_OWNERS.SELECTED_PROVIDER);
  assert.equal(client.config.routingMode, "pinned");
  assert.equal(client.config.localRouterMode, "disabled");
  assert.equal(client.config.intelligenceRouter, null);
  assert.equal(body.amos_routing, undefined);
  assert.equal(body.amos_routing_shadow, undefined);
});

test("Claude and OpenAI controlled adapters never receive the Desktop classifier", () => {
  const classifier = { classify: async () => ({ minimumClass: "routine" }) };
  const cases = [
    resolveModelConfig({
      AMOS_MODEL_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "anthropic-key",
      AMOS_LOCAL_ROUTER_MODE: "active"
    }),
    resolveModelConfig({
      AMOS_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-key",
      AMOS_LOCAL_ROUTER_MODE: "active"
    })
  ];

  for (const config of cases) {
    const client = createModelClient({
      ...config,
      routingOwner: INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP,
      routingMode: "automatic",
      localRouterMode: "active",
      intelligenceRouter: classifier
    });
    assert.equal(client.config.routingOwner, INTELLIGENCE_ROUTING_OWNERS.SELECTED_PROVIDER);
    assert.equal(client.config.routingMode, "pinned");
    assert.equal(client.config.localRouterMode, "disabled");
    assert.equal(client.config.intelligenceRouter, null);
  }
});

test("OpenAI-compatible client omits reasoning for runtimes without that capability", async () => {
  let body;
  const client = createModelClient(
    {
      displayName: "Local test",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "",
      model: "test",
      reasoningEffort: "max",
      maxCompletionTokens: 100,
      requestTimeoutMs: 1000,
      capabilities: { tools: true, reasoning: false }
    },
    async (_url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ choices: [{ message: { role: "assistant", content: "ready" } }] });
        }
      };
    }
  );

  const result = await client.chat({
    messages: [{
      role: "user",
      content: "test",
      provider_state: { protocol: "anthropic-messages", content: [{ type: "thinking" }] }
    }],
    tools: [{ type: "function", function: { name: "noop", parameters: { type: "object" } } }]
  });

  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.messages[0].provider_state, undefined);
  assert.equal(body.tools[0].function.name, "noop");
  assert.equal(result.message.content, "ready");
});

test("Ollama canonicalizes system messages for strict Qwen templates", async () => {
  let body;
  const client = new OpenAICompatibleClient({
    provider: "ollama",
    displayName: "AMOS Local",
    baseUrl: "http://127.0.0.1:11435/v1",
    model: "qwen3:8b",
    requestTimeoutMs: 1_000,
    capabilities: { reasoning: true }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonModelResponse("ready");
  });

  await client.chat({
    messages: [
      { role: "user", content: "Investigate" },
      { role: "system", content: "Primary policy" },
      { role: "assistant", content: "Working" },
      { role: "system", content: "Stop using tools" }
    ]
  });

  assert.deepEqual(body.messages.map((message) => message.role), ["system", "user", "assistant"]);
  assert.equal(body.messages[0].content, "Primary policy\n\nStop using tools");
});

test("AMOS Local translates none into Qwen-compatible thinking controls", async () => {
  let body;
  const client = new OpenAICompatibleClient({
    provider: "ollama",
    displayName: "AMOS Local",
    baseUrl: "http://127.0.0.1:18081/v1",
    model: "amos-local-qwen38-mtplx",
    reasoningEffort: "none",
    requestTimeoutMs: 1_000,
    capabilities: { reasoning: true }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonModelResponse("ready");
  });

  await client.chat({ messages: [{ role: "user", content: "return code" }] });

  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
});

test("AMOS Local preserves the native none effort for non-Qwen models", async () => {
  let body;
  const client = new OpenAICompatibleClient({
    provider: "ollama",
    displayName: "AMOS Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "gpt-oss:20b",
    reasoningEffort: "none",
    requestTimeoutMs: 1_000,
    capabilities: { reasoning: true }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonModelResponse("ready");
  });

  await client.chat({ messages: [{ role: "user", content: "return code" }] });

  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.enable_thinking, undefined);
  assert.equal(body.chat_template_kwargs, undefined);
});

test("MTPLX transport failure retries once through its qualified Ollama fallback", async () => {
  const requests = [];
  const client = new OpenAICompatibleClient({
    provider: "ollama",
    displayName: "AMOS Local",
    baseUrl: "http://127.0.0.1:18081/v1",
    model: "amos-local-qwen38-mtplx",
    reasoningEffort: "none",
    requestTimeoutMs: 1_000,
    capabilities: { reasoning: true },
    localFallback: {
      runtime: "ollama",
      baseUrl: "http://127.0.0.1:11435/v1",
      model: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M"
    }
  }, async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (requests.length === 1) throw new Error("MTPLX connection closed");
    return jsonModelResponse("recovered");
  });

  const result = await client.chat({ messages: [{ role: "user", content: "continue" }] });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "http://127.0.0.1:18081/v1/chat/completions");
  assert.equal(requests[0].body.model, "amos-local-qwen38-mtplx");
  assert.equal(requests[1].url, "http://127.0.0.1:11435/v1/chat/completions");
  assert.equal(requests[1].body.model, "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M");
  assert.equal(result.message.content, "recovered");
});

test("Ollama retries and remembers a Qwen template's advertised reasoning vocabulary", async () => {
  const bodies = [];
  const client = new OpenAICompatibleClient({
    provider: "ollama",
    displayName: "AMOS Local",
    baseUrl: "http://127.0.0.1:11435/v1",
    model: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
    reasoningEffort: "high",
    requestTimeoutMs: 1_000,
    capabilities: { reasoning: true }
  }, async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.reasoning_effort === "high") {
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({
            error: {
              message: "Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low."
            }
          });
        }
      };
    }
    return jsonModelResponse("ready");
  });

  await client.chat({ messages: [{ role: "user", content: "first" }] });
  await client.chat({ messages: [{ role: "user", content: "second" }] });

  assert.deepEqual(bodies.map((body) => body.reasoning_effort), ["high", "xhigh", "xhigh"]);
  assert.equal(client.config.reasoningEffort, "xhigh");
});

test("model client can obtain a short-lived AMOS identity at request time", async () => {
  let authorization;
  const client = createModelClient(
    {
      displayName: "AMOS Intelligence",
      baseUrl: "https://inference.amoslabs.com/v1",
      model: "kimi-k3",
      maxCompletionTokens: 100,
      requestTimeoutMs: 1000,
      capabilities: { tools: true, reasoning: true },
      getAccessToken: async () => "fresh-amos-token"
    },
    async (_url, options) => {
      authorization = options.headers.Authorization;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ choices: [{ message: { role: "assistant", content: "ready" } }] });
        }
      };
    }
  );

  await client.chat({ messages: [{ role: "user", content: "test" }] });
  assert.equal(authorization, "Bearer fresh-amos-token");
});

test("automatic routing sends a local decision in shadow mode without exposing prompt text", async () => {
  let body;
  const events = [];
  const client = new OpenAICompatibleClient({
    provider: "amos-hosted",
    protocol: "openai-chat-completions",
    displayName: "AMOS Intelligence",
    baseUrl: "https://app.amoslabs.com/v1",
    model: "auto",
    usesAmosIdentity: true,
    routingOwner: INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP,
    routingMode: "automatic",
    localRouterMode: "shadow",
    requestTimeoutMs: 1_000,
    capabilities: { tools: true },
    intelligenceRouter: {
      classify: async () => ({
        minimumClass: "deep",
        source: "local",
        model: "amos-router:0.8b-pilot003-v2",
        contract: "amos-router:2026-08-09",
        artifactSha256: "a".repeat(64),
        latencyMs: 42
      })
    }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonModelResponse("ready", {
      routed_tier: "routine",
      local_router_shadow_status: "compared",
      local_router_shadow_class: "deep",
      local_router_shadow_agreement: false
    });
  });

  await client.chat({
    messages: [{ role: "user", content: "private customer task" }],
    tools: [{ type: "function", function: { name: "lookup" } }],
    onRoutingDecision: (decision) => { events.push(decision); }
  });

  assert.equal(body.amos_routing, undefined);
  assert.equal(body.amos_routing_shadow.minimum_class, "deep");
  assert.equal(events[0].minimumClass, "deep");
  assert.equal(events[1].status, "compared");
  assert.equal(events[1].hostedClass, "routine");
  assert.equal(events[1].agreement, false);
  assert.doesNotMatch(JSON.stringify(events), /private customer task/);
});

test("hybrid routing can pass one trusted classifier result into AMOS Hosted", async () => {
  let body;
  let classifierCalls = 0;
  const client = new OpenAICompatibleClient({
    provider: "amos-hosted",
    protocol: "openai-chat-completions",
    baseUrl: "https://app.amoslabs.com/v1",
    model: "auto",
    usesAmosIdentity: true,
    routingOwner: INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP,
    routingMode: "automatic",
    localRouterMode: "active",
    requestTimeoutMs: 1_000,
    capabilities: {},
    intelligenceRouter: {
      classify: async () => {
        classifierCalls += 1;
        return { minimumClass: "routine" };
      }
    }
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonModelResponse("ready");
  });

  await client.chat({
    messages: [{ role: "user", content: "hello" }],
    preclassifiedRouting: { minimumClass: "deep", source: "amos-router" }
  });

  assert.equal(classifierCalls, 0);
  assert.equal(body.amos_routing.minimum_class, "deep");
});

test("provider-controlled clients ignore an attempted preclassified AMOS route", async () => {
  let body;
  const client = createModelClient({
    provider: "openai-compatible",
    protocol: "openai-chat-completions",
    baseUrl: "https://gateway.example/v1",
    model: "controlled-model",
    requestTimeoutMs: 1_000,
    capabilities: {}
  }, async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonModelResponse("ready");
  });

  await client.chat({
    messages: [{ role: "user", content: "hello" }],
    preclassifiedRouting: { minimumClass: "frontier", source: "untrusted" }
  });

  assert.equal(body.amos_routing, undefined);
  assert.equal(body.amos_routing_shadow, undefined);
});

test("local-primary routing controls the envelope and local failures fall back to hosted", async () => {
  const bodies = [];
  const events = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return jsonModelResponse("ready");
  };
  const active = new OpenAICompatibleClient({
    provider: "amos-hosted",
    protocol: "openai-chat-completions",
    baseUrl: "https://app.amoslabs.com/v1",
    model: "auto",
    usesAmosIdentity: true,
    routingOwner: INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP,
    routingMode: "automatic",
    localRouterMode: "active",
    requestTimeoutMs: 1_000,
    capabilities: {},
    intelligenceRouter: { classify: async () => ({ minimumClass: "routine" }) }
  }, fetchImpl);
  await active.chat({
    messages: [{ role: "user", content: "hello" }],
    onRoutingDecision: (event) => events.push(event)
  });

  const fallback = new OpenAICompatibleClient({
    provider: "amos-hosted",
    protocol: "openai-chat-completions",
    baseUrl: "https://app.amoslabs.com/v1",
    model: "auto",
    usesAmosIdentity: true,
    routingOwner: INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP,
    routingMode: "automatic",
    localRouterMode: "active",
    requestTimeoutMs: 1_000,
    capabilities: {},
    intelligenceRouter: { classify: async () => { throw new Error("invalid class"); } }
  }, fetchImpl);
  await fallback.chat({
    messages: [{ role: "user", content: "hello" }],
    onRoutingDecision: (event) => events.push(event)
  });

  assert.equal(bodies[0].amos_routing.minimum_class, "routine");
  assert.equal(bodies[0].amos_routing_shadow, undefined);
  assert.equal(bodies[1].amos_routing, undefined);
  assert.equal(bodies[1].amos_routing_shadow, undefined);
  assert.equal(events[1].reason, "local_router_invalid_output");
});

function jsonModelResponse(content, amos = undefined) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
        ...(amos ? { amos } : {})
      });
    }
  };
}
