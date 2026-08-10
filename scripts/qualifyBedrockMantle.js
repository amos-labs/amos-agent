#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { BEDROCK_MANTLE_CATALOG } from "../src/model/bedrockMantleCatalog.js";
import { createBedrockSigV4Signer } from "../src/model/bedrockSigV4.js";
import { createModelClient, resolveModelConfig } from "../src/model/providers.js";

const options = parseArgs(process.argv.slice(2));
const startedAt = new Date().toISOString();
const signer = createBedrockSigV4Signer({ region: options.region });
const targetModels = requestedModels(options);
const results = [];

for (const model of targetModels) {
  const availability = await modelAvailability(model.id);
  if (availability.status !== "available") {
    results.push({
      model: model.id,
      protocol: model.protocol,
      status: "blocked",
      reason: availability.status_reason || `Model status is ${availability.status}`,
      data_retention: availability.data_retention || null,
      scenarios: []
    });
    continue;
  }
  const record = {
    model: model.id,
    protocol: model.protocol,
    status: "pass",
    reason: null,
    data_retention: availability.data_retention || null,
    scenarios: []
  };
  record.scenarios.push(await scenario("text_usage", () => textAndUsage(model.id)));
  record.scenarios.push(await scenario("tool_round_trip", () => toolRoundTrip(model.id)));
  const failed = record.scenarios.find((item) => item.status !== "pass");
  if (failed) {
    record.status = failed.status;
    record.reason = failed.error;
  }
  results.push(record);
}

const representative = [];
if (results.some((item) => item.model === "anthropic.claude-sonnet-5" && item.status === "pass")) {
  representative.push(await scenario("messages_streaming", () => streaming("anthropic.claude-sonnet-5")));
  representative.push(await scenario("messages_vision", () => vision("anthropic.claude-sonnet-5")));
}
if (results.some((item) => item.model === "openai.gpt-oss-20b" && item.status === "pass")) {
  representative.push(await scenario("responses_cancellation", () => cancellation("openai.gpt-oss-20b")));
}
representative.push(await scenario("signed_error_normalization", invalidRequest));

const report = {
  schema: "amos.bedrock-mantle-qualification:1",
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  region: options.region,
  auth_mode: "sigv4",
  catalog_schema: BEDROCK_MANTLE_CATALOG.schema,
  catalog_verified_at: BEDROCK_MANTLE_CATALOG.verifiedAt,
  models: results,
  representative_scenarios: representative,
  summary: summarize(results, representative)
};

console.log(JSON.stringify(report, null, 2));
if (options.requireAll && report.summary.blocked + report.summary.failed > 0) {
  process.exitCode = 1;
}

async function modelAvailability(modelId) {
  const path = `/v1/models/${encodeURIComponent(modelId)}`;
  const response = await signedFetch(path, { method: "GET", headers: { Accept: "application/json" } });
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(payload?.error?.message || `Model discovery failed with ${response.status}`);
  return payload;
}

async function textAndUsage(modelId) {
  const client = clientFor(modelId, { maxCompletionTokens: 128 });
  const result = await client.chat({
    messages: [{ role: "user", content: "Reply with exactly: AMOS_BEDROCK_OK" }]
  });
  if (!result.message?.content?.includes("AMOS_BEDROCK_OK")) {
    throw new Error("Model did not return the qualification marker");
  }
  if (!Number.isFinite(result.usage?.input_tokens) || !Number.isFinite(result.usage?.output_tokens)) {
    throw new Error("Model did not return normalized token usage");
  }
  return {
    text_marker: true,
    usage: compactUsage(result.usage)
  };
}

async function toolRoundTrip(modelId) {
  const client = clientFor(modelId, { maxCompletionTokens: 256 });
  const tool = {
    type: "function",
    function: {
      name: "qualification_echo",
      description: "Return the supplied qualification marker.",
      parameters: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false
      }
    }
  };
  const messages = [{
    role: "user",
    content: "Call qualification_echo with value AMOS_TOOL_OK. Use the tool before answering."
  }];
  const first = await client.chat({ messages, tools: [tool] });
  const call = first.message?.tool_calls?.[0];
  if (!call || call.function?.name !== "qualification_echo") {
    throw new Error("Model did not produce the expected client-side tool call");
  }
  const args = JSON.parse(call.function.arguments || "{}");
  if (args.value !== "AMOS_TOOL_OK") throw new Error("Model produced incorrect tool arguments");
  const second = await client.chat({
    messages: [
      ...messages,
      first.message,
      { role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: true, value: args.value }) }
    ],
    tools: [tool]
  });
  if (!second.message?.content) throw new Error("Model did not continue after the tool result");
  return { call_id_present: Boolean(call.id), continuation_text: true };
}

async function streaming(modelId) {
  const client = clientFor(modelId, { maxCompletionTokens: 128 });
  const deltas = [];
  const result = await client.chat({
    messages: [{ role: "user", content: "Reply with exactly: AMOS_STREAM_OK" }],
    onDelta: (delta) => deltas.push(delta)
  });
  if (deltas.length === 0 || !result.message?.content?.includes("AMOS_STREAM_OK")) {
    throw new Error("Live stream did not produce visible deltas and the expected marker");
  }
  return { delta_count: deltas.length, usage: compactUsage(result.usage) };
}

async function vision(modelId) {
  const bytes = await readFile(new URL("../desktop/assets/amos-mark.png", import.meta.url));
  const client = clientFor(modelId, { maxCompletionTokens: 128 });
  const result = await client.chat({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Briefly describe the visible logo mark." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${bytes.toString("base64")}` } }
      ]
    }]
  });
  if (!result.message?.content) throw new Error("Vision request returned no description");
  return { response_text: true, usage: compactUsage(result.usage) };
}

async function cancellation(modelId) {
  const client = clientFor(modelId, { maxCompletionTokens: 2_048, requestTimeoutMs: 30_000 });
  const controller = new AbortController();
  const pending = client.chat({
    messages: [{ role: "user", content: "Write a long detailed report with at least 100 sections." }],
    onDelta() {},
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 75);
  try {
    await pending;
  } catch (error) {
    if (error?.code === "AMOS_TASK_CANCELED" && error?.name === "AbortError") {
      return { canonical_abort: true };
    }
    throw error;
  }
  throw new Error("Request completed before cancellation reached the transport");
}

async function invalidRequest() {
  const response = await signedFetch("/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "amos.invalid-model", input: "qualification" })
  });
  const payload = await safeJson(response);
  if (response.ok || response.status < 400 || !payload?.error) {
    throw new Error("Invalid signed request did not return a structured provider error");
  }
  return { status: response.status, provider_error: true };
}

function clientFor(modelId, overrides = {}) {
  const config = resolveModelConfig({
    AMOS_MODEL_PROVIDER: "bedrock",
    AMOS_MODEL: modelId,
    AMOS_BEDROCK_AUTH_MODE: "sigv4",
    AWS_REGION: options.region,
    AMOS_MODEL_REASONING_EFFORT: "low",
    AMOS_MODEL_MAX_COMPLETION_TOKENS: String(overrides.maxCompletionTokens || 128),
    AMOS_MODEL_REQUEST_TIMEOUT_MS: String(overrides.requestTimeoutMs || options.timeoutMs)
  });
  return createModelClient(config);
}

async function signedFetch(path, { method, headers = {}, body = "" }) {
  const url = `https://bedrock-mantle.${options.region}.api.aws${path}`;
  const signed = await signer({ url, method, headers, body });
  return fetch(url, { method, headers: signed.headers, body: body || undefined });
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

async function scenario(name, work) {
  process.stderr.write(`Qualifying ${name}...\n`);
  const started = Date.now();
  try {
    const detail = await work();
    return { name, status: "pass", duration_ms: Date.now() - started, detail };
  } catch (error) {
    const message = String(error?.message || error);
    return {
      name,
      status: blockedError(message) ? "blocked" : "fail",
      duration_ms: Date.now() - started,
      error: message.slice(0, 1_000)
    };
  }
}

function blockedError(message) {
  return /subscription.*set up|marketplace|data retention mode|access.*model|not available/i.test(message);
}

function compactUsage(usage) {
  if (!usage) return null;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens
  };
}

function summarize(models, representativeScenarios) {
  const statuses = [
    ...models.map((item) => item.status),
    ...representativeScenarios.map((item) => item.status)
  ];
  return {
    passed: statuses.filter((status) => status === "pass").length,
    blocked: statuses.filter((status) => status === "blocked").length,
    failed: statuses.filter((status) => status === "fail").length
  };
}

function requestedModels({ models }) {
  const requested = models ? new Set(models.split(",").map((item) => item.trim()).filter(Boolean)) : null;
  const available = BEDROCK_MANTLE_CATALOG.models.filter((model) => model.regions.includes(options.region));
  if (!requested) return available;
  const selected = available.filter((model) => requested.has(model.id));
  const unknown = [...requested].filter((id) => !selected.some((model) => model.id === id));
  if (unknown.length > 0) throw new Error(`Unqualified model selection: ${unknown.join(", ")}`);
  return selected;
}

function parseArgs(args) {
  const parsed = { region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1", models: "", timeoutMs: 120_000, requireAll: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--region") parsed.region = args[++index];
    else if (args[index] === "--models") parsed.models = args[++index];
    else if (args[index] === "--timeout-ms") parsed.timeoutMs = Number(args[++index]);
    else if (args[index] === "--require-all") parsed.requireAll = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!BEDROCK_MANTLE_CATALOG.regions.includes(parsed.region)) {
    throw new Error(`Unqualified Bedrock Mantle region: ${parsed.region}`);
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 1_000 || parsed.timeoutMs > 900_000) {
    throw new Error("--timeout-ms must be between 1000 and 900000");
  }
  return parsed;
}
