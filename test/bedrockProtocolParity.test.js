import test from "node:test";
import assert from "node:assert/strict";
import { BEDROCK_MANTLE_CATALOG } from "../src/model/bedrockMantleCatalog.js";
import {
  createModelClient,
  listModelProviders,
  resolveModelConfig
} from "../src/model/providers.js";
import { OpenAIResponsesClient } from "../src/model/openAiResponsesClient.js";
import { AnthropicMessagesClient } from "../src/model/anthropicMessagesClient.js";

test("Bedrock catalog descriptors are complete, unique, and region bounded", () => {
  const provider = listModelProviders().find((item) => item.id === "bedrock");
  const ids = provider.models.map((model) => model.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(provider.endpoint.schema, "amos.bedrock-mantle-catalog:1");
  assert.ok(provider.endpoint.sources.every((source) => source.startsWith("https://docs.aws.amazon.com/")));
  for (const model of provider.models) {
    assert.ok(["openai-responses", "anthropic-messages"].includes(model.protocol));
    assert.ok(["/v1", "/openai/v1", "/anthropic/v1"].includes(model.endpointPath));
    assert.ok(["bearer", "x-api-key"].includes(model.authScheme));
    assert.ok(model.regions.length > 0);
    assert.ok(model.regions.every((region) => BEDROCK_MANTLE_CATALOG.regions.includes(region)));
  }
});

test("Bedrock GPT-5.6 uses Responses on its model-specific Mantle path", async () => {
  const config = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "bedrock",
    AMOS_MODEL: "openai.gpt-5.6-terra",
    AMOS_MODEL_BASE_URL: "https://bedrock-mantle.us-west-2.api.aws/v1",
    AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-key",
    AMOS_MODEL_REASONING_EFFORT: "medium"
  });
  assert.equal(config.protocol, "openai-responses");
  assert.equal(config.baseUrl, "https://bedrock-mantle.us-west-2.api.aws/openai/v1");
  assert.equal(config.capabilities.vision, true);
  assert.equal(config.modelProfile.authScheme, "bearer");

  let request;
  const client = createModelClient(config, async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      output: [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "ready" }]
      }],
      usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.ok(client instanceof OpenAIResponsesClient);
  await client.chat({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(request.url, "https://bedrock-mantle.us-west-2.api.aws/openai/v1/responses");
  assert.equal(request.headers.Authorization, "Bearer bedrock-test-key");
  assert.equal(request.body.store, false);
  assert.equal(request.body.include, undefined);
});

test("Bedrock Claude uses Messages, x-api-key auth, and the Anthropic Mantle path", async () => {
  const config = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "bedrock",
    AMOS_MODEL: "anthropic.claude-sonnet-5",
    AMOS_MODEL_BASE_URL: "https://bedrock-mantle.us-east-1.api.aws/openai/v1",
    AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-key",
    AMOS_MODEL_REASONING_EFFORT: "medium"
  });
  assert.equal(config.protocol, "anthropic-messages");
  assert.equal(config.baseUrl, "https://bedrock-mantle.us-east-1.api.aws/anthropic/v1");
  assert.equal(config.apiVersion, "2023-06-01");
  assert.equal(config.capabilities.vision, true);
  assert.equal(config.modelProfile.authScheme, "x-api-key");

  let request;
  const client = createModelClient(config, async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "ready" }],
      usage: { input_tokens: 3, output_tokens: 1 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.ok(client instanceof AnthropicMessagesClient);
  await client.chat({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(request.url, "https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages");
  assert.equal(request.headers["x-api-key"], "bedrock-test-key");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
});

test("Bedrock fails closed for unqualified models, regions, and credential origins", () => {
  assert.throws(
    () => resolveModelConfig({
      AMOS_MODEL_PROVIDER: "bedrock",
      AMOS_MODEL: "openai.gpt-6-astra",
      AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-key"
    }),
    /not qualified/
  );
  assert.throws(
    () => resolveModelConfig({
      AMOS_MODEL_PROVIDER: "bedrock",
      AMOS_MODEL: "unknown.future-model",
      AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-key"
    }),
    /not qualified/
  );
  assert.throws(
    () => resolveModelConfig({
      AMOS_MODEL_PROVIDER: "bedrock",
      AMOS_MODEL: "openai.gpt-5.6-sol",
      AWS_REGION: "eu-west-1",
      AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-key"
    }),
    /not qualified.*eu-west-1/
  );
  assert.throws(
    () => resolveModelConfig({
      AMOS_MODEL_PROVIDER: "bedrock",
      AMOS_MODEL: "openai.gpt-5.6-terra",
      AMOS_MODEL_BASE_URL: "https://models.attacker.invalid/v1",
      AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-key"
    }),
    /only be sent to a Bedrock Mantle endpoint/
  );
});

test("legacy GPT OSS runtime IDs migrate to the qualified Responses descriptor", () => {
  const config = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "bedrock",
    AMOS_MODEL: "openai.gpt-oss-120b-1:0",
    AWS_REGION: "eu-west-1",
    AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-key"
  });
  assert.equal(config.model, "openai.gpt-oss-120b");
  assert.equal(config.protocol, "openai-responses");
  assert.equal(config.baseUrl, "https://bedrock-mantle.eu-west-1.api.aws/v1");
});
