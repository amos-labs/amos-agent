import test from "node:test";
import assert from "node:assert/strict";
import { defaultShellPath, loadConfig } from "../src/config.js";

test("authentication mode defaults to auto and accepts explicit API-key mode", () => {
  assert.equal(loadConfig({}, ".").auth.mode, "auto");
  assert.equal(loadConfig({ AMOS_AGENT_AUTH_MODE: "api-key" }, ".").auth.mode, "api-key");
  assert.equal(loadConfig({ AMOS_AGENT_AUTH_MODE: "unexpected" }, ".").auth.mode, "auto");
});

test("agent work has progress guards instead of a productive-cycle ceiling", () => {
  const defaults = loadConfig({}, ".").agent;
  assert.equal(defaults.maxRepeatedToolCycles, 3);
  assert.equal(defaults.maxConsecutiveToolErrorCycles, 3);
  assert.equal(defaults.maxModelTransientRetries, 2);
  assert.equal(Object.hasOwn(defaults, "maxToolTurns"), false);

  const configured = loadConfig({
    AMOS_AGENT_MAX_REPEATED_TOOL_CYCLES: "5",
    AMOS_AGENT_MAX_CONSECUTIVE_TOOL_ERROR_CYCLES: "4"
  }, ".").agent;
  assert.equal(configured.maxRepeatedToolCycles, 5);
  assert.equal(configured.maxConsecutiveToolErrorCycles, 4);
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

test("Bedrock resolves a qualified model to its native regional endpoint", () => {
  const config = loadConfig(
    {
      AMOS_MODEL_PROVIDER: "bedrock",
      AWS_REGION: "us-west-2",
      AWS_BEARER_TOKEN_BEDROCK: "bedrock-key",
      AMOS_MODEL: "openai.gpt-5.6-terra"
    },
    "."
  );

  assert.equal(config.model.provider, "bedrock");
  assert.equal(config.model.protocol, "openai-responses");
  assert.equal(config.model.baseUrl, "https://bedrock-mantle.us-west-2.api.aws/openai/v1");
  assert.equal(config.model.apiKey, "bedrock-key");
  assert.equal(config.model.model, "openai.gpt-5.6-terra");
  assert.equal(config.model.deployment, "customer-cloud");
});

test("local providers do not require a provider credential", () => {
  const config = loadConfig({ AMOS_MODEL_PROVIDER: "ollama" }, ".");
  assert.equal(config.model.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(config.model.apiKeyRequired, false);
});

test("desktop commands use a native shell by default and accept an explicit override", () => {
  assert.equal(defaultShellPath("win32"), "powershell.exe");
  assert.equal(defaultShellPath("darwin"), "/bin/bash");
  assert.equal(
    loadConfig({ AMOS_AGENT_SHELL: "pwsh.exe", AMOS_AGENT_BASH: "legacy.exe" }, ".").safety.bashPath,
    "pwsh.exe"
  );
});
