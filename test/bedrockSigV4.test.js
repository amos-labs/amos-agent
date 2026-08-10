import test from "node:test";
import assert from "node:assert/strict";
import {
  createBedrockSigV4Signer,
  resolveBedrockAuthMode
} from "../src/model/bedrockSigV4.js";
import {
  createModelClient,
  resolveModelConfig,
  validateModelConfig
} from "../src/model/providers.js";

const credentials = async () => ({
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  sessionToken: "session-token"
});

test("Bedrock authentication resolves explicitly and preserves API-key migration", () => {
  assert.equal(resolveBedrockAuthMode("auto", ""), "sigv4");
  assert.equal(resolveBedrockAuthMode("auto", "stored-key"), "api-key");
  assert.equal(resolveBedrockAuthMode("sigv4", "stored-key"), "sigv4");
  assert.throws(() => resolveBedrockAuthMode("password", ""), /Unsupported/);

  const sigv4 = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "bedrock",
    AMOS_MODEL: "openai.gpt-5.6-terra",
    AMOS_BEDROCK_AUTH_MODE: "sigv4",
    AWS_REGION: "us-east-1"
  });
  assert.equal(sigv4.authMode, "sigv4");
  assert.equal(sigv4.apiKeyRequired, false);
  assert.equal(sigv4.awsRegion, "us-east-1");
  assert.deepEqual(validateModelConfig(sigv4), []);

  const apiKey = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "bedrock",
    AMOS_MODEL: "openai.gpt-5.6-terra",
    AMOS_BEDROCK_AUTH_MODE: "api-key",
    AWS_REGION: "us-east-1"
  });
  assert.equal(apiKey.apiKeyRequired, true);
  assert.deepEqual(validateModelConfig(apiKey), ["AWS_BEARER_TOKEN_BEDROCK"]);
});

test("SigV4 signs the exact Mantle target without adding credentials to the body", async () => {
  const body = JSON.stringify({ model: "openai.gpt-5.6-terra", input: "hello" });
  const signer = createBedrockSigV4Signer({ region: "us-east-1", credentials });
  const signed = await signer({
    url: "https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });

  assert.match(signed.headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.match(signed.headers.authorization, /\/us-east-1\/bedrock-mantle\/aws4_request/);
  assert.equal(signed.headers["x-amz-security-token"], "session-token");
  assert.match(signed.headers["x-amz-date"], /^\d{8}T\d{6}Z$/);
  assert.equal(signed.body, body);
  assert.equal(signed.body.includes("AKIDEXAMPLE"), false);

  await assert.rejects(
    signer({
      url: "https://models.attacker.invalid/openai/v1/responses",
      headers: {},
      body
    }),
    /can only sign bedrock-mantle\.us-east-1\.api\.aws/
  );
});

test("Bedrock native clients use SigV4 instead of provider API-key headers", async () => {
  for (const model of ["openai.gpt-5.6-terra", "anthropic.claude-sonnet-5"]) {
    const config = resolveModelConfig({
      AMOS_MODEL_PROVIDER: "bedrock",
      AMOS_MODEL: model,
      AMOS_BEDROCK_AUTH_MODE: "sigv4",
      AWS_REGION: "us-east-1"
    });
    config.awsCredentialProvider = credentials;
    let request;
    const client = createModelClient(config, async (url, options) => {
      request = { url, headers: options.headers, body: options.body };
      return model.startsWith("anthropic.")
        ? Response.json({ content: [{ type: "text", text: "ready" }], usage: { input_tokens: 1, output_tokens: 1 } })
        : Response.json({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ready" }] }], usage: { input_tokens: 1, output_tokens: 1 } });
    });
    await client.chat({ messages: [{ role: "user", content: "hello" }] });

    assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 /);
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(request.headers["x-api-key"], undefined);
    assert.equal(request.body.includes("AKIDEXAMPLE"), false);
  }
});
