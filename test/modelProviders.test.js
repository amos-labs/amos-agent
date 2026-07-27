import test from "node:test";
import assert from "node:assert/strict";
import {
  createModelClient,
  hostedInferenceBaseUrl,
  listModelProviders,
  resolveModelConfig,
  validateModelConfig
} from "../src/model/providers.js";

test("provider catalog exposes managed, customer-cloud, and local deployment modes", () => {
  const providers = listModelProviders();
  assert.ok(providers.some((provider) => provider.id === "amos-hosted" && provider.deployment === "amos"));
  assert.ok(providers.some((provider) => provider.id === "bedrock" && provider.deployment === "customer-cloud"));
  assert.ok(providers.some((provider) => provider.id === "ollama" && provider.deployment === "local"));
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
  assert.equal(config.apiKey, "");
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
    AMOS_MODEL: "some-provider-model"
  });

  assert.equal(config.baseUrl, "https://platform.custom.amoslabs.com/v1");
  assert.equal(config.model, "auto");
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
    messages: [{ role: "user", content: "test" }],
    tools: [{ type: "function", function: { name: "noop", parameters: { type: "object" } } }]
  });

  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.tools[0].function.name, "noop");
  assert.equal(result.message.content, "ready");
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
