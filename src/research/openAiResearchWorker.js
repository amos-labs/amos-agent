import { performance } from "node:perf_hooks";
import { digestResearchValue } from "./experimentProtocol.js";

export const OPENAI_RESEARCH_OBSERVATION_SCHEMA = "amos.openai-research-observation";
export const OPENAI_RESEARCH_OBSERVATION_VERSION = 1;

export class OpenAiResearchWorker {
  constructor({
    controlId,
    model,
    baseUrl,
    apiKey = null,
    dialect = "generic",
    reasoningEffort = null,
    temperature = 0,
    seed = 0,
    requestTimeoutMs = 10 * 60_000,
    allowRemote = false,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    monotonicNow = () => performance.now()
  }) {
    this.controlId = requiredText(controlId, "controlId", 200);
    this.model = requiredText(model, "model", 500);
    this.baseUrl = normalizedBaseUrl(baseUrl, allowRemote);
    this.apiKey = apiKey ? requiredText(apiKey, "apiKey", 2_000) : null;
    if (!["generic", "qwen"].includes(dialect)) {
      throw new Error("OpenAI research dialect must be generic or qwen");
    }
    this.dialect = dialect;
    this.reasoningEffort = reasoningEffort;
    if (typeof temperature !== "number" || temperature < 0 || temperature > 2) {
      throw new Error("temperature must be between zero and two");
    }
    this.temperature = temperature;
    this.seed = boundedInteger(seed, 0, 2_147_483_647, "seed");
    this.requestTimeoutMs = boundedInteger(
      requestTimeoutMs,
      1_000,
      7_200_000,
      "requestTimeoutMs"
    );
    if (typeof fetchImpl !== "function") throw new Error("OpenAI research worker requires fetch");
    this.fetch = fetchImpl;
    this.now = now;
    this.monotonicNow = monotonicNow;
  }

  async probe({ signal = null } = {}) {
    const payload = await this.request("/v1/models", { method: "GET", signal });
    const models = (payload.data || []).map((item) => String(item?.id || ""));
    if (!models.includes(this.model)) {
      throw new Error(`Research model ${this.model} is not available from ${this.baseUrl}`);
    }
    return { ready: true, controlId: this.controlId, model: this.model };
  }

  async runCase({
    caseId,
    messages,
    tools = [],
    dataManifestDigest,
    repetition = 1,
    maxOutputTokens,
    reasoningEffortOverride = null,
    responseFormat = null,
    promptSessionId = null,
    signal = null
  }) {
    requiredText(caseId, "caseId", 500);
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages must be a non-empty array");
    }
    if (!Array.isArray(tools)) throw new Error("tools must be an array");
    if (!/^[a-f0-9]{64}$/.test(String(dataManifestDigest || ""))) {
      throw new Error("dataManifestDigest must be a lowercase SHA-256 digest");
    }
    boundedInteger(repetition, 1, 10_000, "repetition");
    boundedInteger(maxOutputTokens, 1, 131_072, "maxOutputTokens");
    const body = {
      model: this.model,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(tools.length > 1 ? { parallel_tool_calls: false } : {}),
      stream: false,
      temperature: this.temperature,
      seed: this.seed,
      max_tokens: maxOutputTokens,
      ...(responseFormat ? {
        response_format: jsonObject(responseFormat, "responseFormat")
      } : {})
    };
    const reasoningEffort = reasoningEffortOverride || this.reasoningEffort;
    if (this.dialect === "qwen") {
      if (reasoningEffort === "none") {
        body.enable_thinking = false;
        body.chat_template_kwargs = { enable_thinking: false };
      } else if (reasoningEffort) {
        body.reasoning_effort = reasoningEffort;
        body.chat_template_kwargs = { reasoning_effort: reasoningEffort };
      }
    } else if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }
    const requestDigest = digestResearchValue({
      controlId: this.controlId,
      caseId,
      dataManifestDigest,
      repetition,
      promptSessionId,
      body
    });
    const startedAt = this.now().toISOString();
    const started = this.monotonicNow();
    const providerResponse = await this.request("/v1/chat/completions", {
      method: "POST",
      body,
      signal,
      headers: promptSessionId ? { "X-MTPLX-Session-ID": promptSessionId } : {}
    });
    const completedAt = this.now().toISOString();
    const wallMilliseconds = Math.max(0, Math.round(this.monotonicNow() - started));
    const message = providerResponse?.choices?.[0]?.message;
    if (!message || typeof message !== "object") {
      throw new Error("Research endpoint response did not include a message");
    }
    return {
      schema: OPENAI_RESEARCH_OBSERVATION_SCHEMA,
      version: OPENAI_RESEARCH_OBSERVATION_VERSION,
      controlId: this.controlId,
      caseId,
      repetition,
      dataManifestDigest,
      requestDigest,
      responseDigest: digestResearchValue(providerResponse),
      messageDigest: digestResearchValue(message),
      startedAt,
      completedAt,
      message,
      metrics: inferenceMetrics(providerResponse, wallMilliseconds),
      providerResponse
    };
  }

  async request(path, { method, body = null, headers = {}, signal = null }) {
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...headers
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: combinedSignal
      });
    } catch (error) {
      if (combinedSignal.aborted) {
        throw new Error(`Research request timed out or was aborted after ${this.requestTimeoutMs}ms`);
      }
      throw error;
    }
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("Research endpoint returned invalid JSON");
    }
    if (!response.ok) {
      const detail = String(payload?.error?.message || payload?.error || text || response.status)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      throw new Error(`Research endpoint returned ${response.status}: ${detail}`);
    }
    return payload;
  }
}

function inferenceMetrics(payload, wallMilliseconds) {
  const usage = payload?.usage || {};
  const timings = payload?.timings || {};
  const promptTokens = nonNegativeNumber(timings.prompt_n ?? usage.prompt_tokens);
  const outputTokens = nonNegativeNumber(timings.predicted_n ?? usage.completion_tokens);
  const promptMilliseconds = nonNegativeNumber(timings.prompt_ms);
  const generationMilliseconds = nonNegativeNumber(timings.predicted_ms) || wallMilliseconds;
  const cachedInputTokens = nonNegativeNumber(usage?.prompt_tokens_details?.cached_tokens);
  return {
    wallMilliseconds,
    promptTokens,
    outputTokens,
    cachedInputTokens,
    promptMilliseconds,
    generationMilliseconds,
    promptTokensPerSecond: rate(promptTokens, promptMilliseconds),
    generationTokensPerSecond: rate(outputTokens, generationMilliseconds),
    sessionCacheHit: null
  };
}

function normalizedBaseUrl(value, allowRemote) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Research baseUrl must be a valid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Research baseUrl must use HTTP or HTTPS");
  }
  if (!allowRemote && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Research endpoints are loopback-only unless allowRemote is explicit");
  }
  return url.toString().replace(/\/$/, "");
}

function nonNegativeNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function rate(tokens, milliseconds) {
  return milliseconds > 0 && tokens > 0
    ? Number((tokens / (milliseconds / 1_000)).toFixed(3))
    : null;
}

function requiredText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} must be a non-empty string`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  try {
    return structuredClone(value);
  } catch {
    throw new Error(`${label} must be serializable`);
  }
}
