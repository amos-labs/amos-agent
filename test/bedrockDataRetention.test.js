import test from "node:test";
import assert from "node:assert/strict";
import {
  bedrockRetentionActionableError,
  configureBedrockProviderDataSharing
} from "../src/model/bedrockDataRetention.js";

function fableConfig(overrides = {}) {
  return {
    provider: "bedrock",
    model: "anthropic.claude-fable-5",
    baseUrl: "https://bedrock-mantle.us-east-1.api.aws/anthropic/v1",
    authMode: "api-key",
    apiKey: "secret",
    modelProfile: {
      label: "Claude Fable 5",
      dataRetention: { requiredMode: "provider_data_share" }
    },
    ...overrides
  };
}

test("Bedrock provider data sharing requires an explicit control-plane update", async () => {
  let request;
  const result = await configureBedrockProviderDataSharing(
    fableConfig(),
    async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        mode: "provider_data_share",
        updated_at: 42
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  );

  assert.equal(request.url, "https://bedrock-mantle.us-east-1.api.aws/v1/data_retention");
  assert.equal(request.options.method, "PUT");
  assert.equal(request.options.headers["x-api-key"], "secret");
  assert.deepEqual(JSON.parse(request.options.body), { mode: "provider_data_share" });
  assert.deepEqual(result, { mode: "provider_data_share", updatedAt: 42 });
});

test("Bedrock retention errors explain the required consent instead of suggesting retries", () => {
  assert.match(
    bedrockRetentionActionableError(
      fableConfig(),
      "data retention mode 'default' is not available for this model"
    ),
    /Open Intelligence settings.*Enable provider data sharing/i
  );
  assert.equal(
    bedrockRetentionActionableError(
      fableConfig({ modelProfile: { label: "Claude Sonnet 5", dataRetention: null } }),
      "provider unavailable"
    ),
    "provider unavailable"
  );
});
