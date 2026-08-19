import test from "node:test";
import assert from "node:assert/strict";
import { DesktopController } from "../src/desktop/controller.js";
import { DEFAULT_DESKTOP_SETTINGS } from "../src/desktop/settingsStore.js";

function controllerHarness(initial = {}) {
  let current = { ...DEFAULT_DESKTOP_SETTINGS, apiKey: "", ...initial };
  let writes = 0;
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-intelligence-settings",
    settingsStore: {
      read: async () => ({ ...current }),
      write: async (value) => {
        writes += 1;
        current = { ...value };
        return { ...current };
      }
    },
    openBrowser() {},
    emit() {}
  });
  controller.state = async () => ({ settings: current });
  return {
    controller,
    current: () => current,
    writes: () => writes
  };
}

test("Desktop restores the target provider credential when switching models", async () => {
  const harness = controllerHarness({
    provider: "xai",
    model: "grok-4.6",
    baseUrl: "https://api.x.ai/v1",
    apiKey: "xai-key",
    providerCredentials: {
      xai: "xai-key",
      openai: "openai-key"
    }
  });

  await harness.controller.saveSettings({
    provider: "openai",
    model: "gpt-5.6-terra",
    baseUrl: "https://api.openai.com/v1",
    reasoningEffort: "medium"
  });

  assert.equal(harness.current().provider, "openai");
  assert.equal(harness.current().apiKey, "openai-key");
  assert.equal(harness.current().providerCredentials.xai, "xai-key");
  assert.equal(harness.current().providerCredentials.openai, "openai-key");
});

test("Desktop rejects an unqualified Bedrock combination before persisting it", async () => {
  const harness = controllerHarness();
  await assert.rejects(
    harness.controller.saveSettings({
      provider: "bedrock",
      model: "unknown.future-model",
      baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
      apiKey: "bedrock-key",
      reasoningEffort: "medium"
    }),
    /not qualified/
  );
  assert.equal(harness.writes(), 0);
  assert.equal(harness.current().provider, "amos-hosted");
});

test("Desktop persists the canonical endpoint path for the selected Bedrock model", async () => {
  const harness = controllerHarness();
  await harness.controller.saveSettings({
    provider: "bedrock",
    model: "anthropic.claude-sonnet-5",
    baseUrl: "https://bedrock-mantle.us-east-1.api.aws/openai/v1",
    apiKey: "bedrock-key",
    bedrockAuthMode: "api-key",
    reasoningEffort: "medium"
  });
  assert.equal(harness.writes(), 1);
  assert.equal(harness.current().model, "anthropic.claude-sonnet-5");
  assert.equal(harness.current().bedrockAuthMode, "api-key");
  assert.equal(
    harness.current().baseUrl,
    "https://bedrock-mantle.us-east-1.api.aws/anthropic/v1"
  );
});

test("Desktop accepts Bedrock SigV4 without storing a provider credential", async () => {
  const harness = controllerHarness();
  await harness.controller.saveSettings({
    provider: "bedrock",
    model: "openai.gpt-5.6-terra",
    baseUrl: "https://bedrock-mantle.us-east-1.api.aws/openai/v1",
    apiKey: "",
    bedrockAuthMode: "sigv4",
    reasoningEffort: "medium"
  });
  assert.equal(harness.writes(), 1);
  assert.equal(harness.current().bedrockAuthMode, "sigv4");
  assert.equal(harness.current().apiKey, "");
});

test("Desktop warms only the installed local model selected for active intelligence", async () => {
  const calls = [];
  const settings = {
    ...DEFAULT_DESKTOP_SETTINGS,
    provider: "ollama",
    model: "qwen3:8b",
    operatingMode: "offline"
  };
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-local-warmup",
    settingsStore: { read: async () => settings },
    offlineManager: {
      async refresh() {
        calls.push("refresh");
        return { models: [{ id: "qwen3:8b", installed: true }] };
      },
      async preload(modelId) {
        calls.push(`preload:${modelId}`);
        return { model: modelId, keepAlive: "30m", runtime: "ollama" };
      }
    },
    openBrowser() {},
    emit() {}
  });

  const result = await controller.warmLocalIntelligence();

  assert.deepEqual(calls, ["refresh", "preload:qwen3:8b"]);
  assert.equal(result.keepAlive, "30m");
});
