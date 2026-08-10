import test from "node:test";
import assert from "node:assert/strict";
import { DesktopController } from "../src/desktop/controller.js";
import { DEFAULT_DESKTOP_SETTINGS } from "../src/desktop/settingsStore.js";

function controllerHarness() {
  let current = { ...DEFAULT_DESKTOP_SETTINGS, apiKey: "" };
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
    reasoningEffort: "medium"
  });
  assert.equal(harness.writes(), 1);
  assert.equal(harness.current().model, "anthropic.claude-sonnet-5");
  assert.equal(
    harness.current().baseUrl,
    "https://bedrock-mantle.us-east-1.api.aws/anthropic/v1"
  );
});
