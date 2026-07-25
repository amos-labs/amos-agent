import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("authentication mode defaults to auto and accepts explicit API-key mode", () => {
  assert.equal(loadConfig({}, ".").auth.mode, "auto");
  assert.equal(loadConfig({ AMOS_AGENT_AUTH_MODE: "api-key" }, ".").auth.mode, "api-key");
  assert.equal(loadConfig({ AMOS_AGENT_AUTH_MODE: "unexpected" }, ".").auth.mode, "auto");
});

test("model provider defaults to Kimi while preserving legacy environment names", () => {
  const config = loadConfig(
    {
      MOONSHOT_API_KEY: "moonshot-key",
      KIMI_MODEL: "kimi-k3",
      KIMI_BASE_URL: "https://legacy.moonshot.example/v1"
    },
    "."
  );

  assert.equal(config.model.provider, "kimi");
  assert.equal(config.model.apiKey, "moonshot-key");
  assert.equal(config.model.model, "kimi-k3");
  assert.equal(config.model.baseUrl, "https://legacy.moonshot.example/v1");
  assert.equal(config.kimi, config.model);
});

test("Bedrock resolves to its OpenAI-compatible regional endpoint", () => {
  const config = loadConfig(
    {
      AMOS_MODEL_PROVIDER: "bedrock",
      AWS_REGION: "eu-west-1",
      AWS_BEARER_TOKEN_BEDROCK: "bedrock-key",
      AMOS_MODEL: "moonshot.kimi-k3"
    },
    "."
  );

  assert.equal(config.model.provider, "bedrock");
  assert.equal(config.model.baseUrl, "https://bedrock-mantle.eu-west-1.api.aws/v1");
  assert.equal(config.model.apiKey, "bedrock-key");
  assert.equal(config.model.model, "moonshot.kimi-k3");
  assert.equal(config.model.deployment, "customer-cloud");
});

test("local providers do not require a provider credential", () => {
  const config = loadConfig({ AMOS_MODEL_PROVIDER: "ollama" }, ".");
  assert.equal(config.model.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(config.model.apiKeyRequired, false);
});
