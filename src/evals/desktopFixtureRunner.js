import { createHash } from "node:crypto";
import { AgentLoop } from "../agentLoop.js";
import { createModelClient } from "../model/providers.js";
import { hasManualHostedTier } from "../model/hostedTier.js";
import { SYSTEM_PROMPT } from "../prompts.js";
import { ToolRegistry } from "../tools/registry.js";
import { canonicalJson } from "../util/canonicalJson.js";
import { createAbortError, linkAbortSignal, throwIfAborted } from "../util/abort.js";

// Research-only adapter. No credentials, network implementation or business
// tools are discovered here: the controller supplies each explicitly.
export async function runDesktopFixture({
  fixture, tools = [], verify, modelConfig, fetchImpl, expectedServedModel,
  limits, systemPrompt = SYSTEM_PROMPT, signal = null, transportProfile = "hosted"
}) {
  if (fixture?.synthetic !== true || !fixture.id || typeof fixture.prompt !== "string") {
    throw new Error("Provide a named synthetic fixture and prompt");
  }
  if (!hasManualHostedTier(modelConfig) || typeof fetchImpl !== "function") {
    throw new Error("Provide a manual hosted configuration and explicit transport");
  }
  if (typeof expectedServedModel !== "string" || !expectedServedModel.trim() || typeof verify !== "function") {
    throw new Error("An expected serving identity and independent verifier are required");
  }
  if (!["hosted", "direct-cortex"].includes(transportProfile)) {
    throw new Error("Unsupported fixture transport profile");
  }
  const direct = transportProfile === "direct-cortex";
  const bounds = {
    maxModelTurns: bound(limits?.maxModelTurns, 1, 32),
    maxHttpCalls: bound(limits?.maxHttpCalls, 1, 64),
    maxWallMs: bound(limits?.maxWallMs, 1, 300_000),
    maxCompletionTokens: bound(limits?.maxCompletionTokens, 1, 24_576)
  };
  const abort = new AbortController();
  const startedAt = new Date().toISOString(), started = performance.now();
  const turns = [], requests = [], events = [];
  const redact = value => {
    const message = String(value || "");
    return modelConfig.apiKey ? message.replaceAll(modelConfig.apiKey, "[REDACTED]") : message;
  };
  const stop = reason => { abort.abort(reason); throw createAbortError(reason); };
  const registry = new ToolRegistry();
  const names = new Set();
  for (const tool of tools) {
    if (!tool.name || names.has(tool.name) || typeof tool.handler !== "function") {
      throw new Error("Fixture tools need unique names and trusted handlers");
    }
    names.add(tool.name);
    registry.register({ ...tool, handler: async (args, context) => {
      throwIfAborted(abort.signal);
      return tool.handler(args, context);
    } });
  }
  const config = { ...modelConfig, maxCompletionTokens: bounds.maxCompletionTokens };
  const origin = new URL(config.baseUrl).origin;
  const client = createModelClient(config, async (url, options = {}) => {
    throwIfAborted(abort.signal);
    if (new URL(url).origin !== origin) return stop("unexpected_transport_origin");
    if (requests.length >= bounds.maxHttpCalls) return stop("http_call_limit");
    // The normal client can retry a dropped stream. A research model turn is
    // one HTTP attempt; a rejected hidden retry ends the fixture explicitly.
    if (requests.some(request => request.modelTurn === turns.length)) return stop("transport_retry_disallowed");
    const clientBody = JSON.parse(options.body);
    const body = direct ? directCortexBody(clientBody, expectedServedModel) : clientBody;
    const wireBody = direct ? JSON.stringify(body) : options.body;
    const { model: _model, ...modelIndependentBody } = body;
    const request = {
      index: requests.length, modelTurn: turns.length,
      body, bodyBytesSha256: sha(wireBody),
      ...(direct ? { clientBody, clientBodyBytesSha256: sha(options.body) } : {}),
      modelIndependentBodySha256: sha(canonicalJson(modelIndependentBody)),
      compiledInput: { messages: body.messages, tools: body.tools || [] },
      responseBody: "", responseBytes: 0, responseCaptureTruncated: false
    };
    // This is a Desktop canonical-input diagnostic hash, not a signed Mission
    // treatment. The owning comparator must apply its own canonical contract.
    request.compiledInputSha256 = sha(canonicalJson(request.compiledInput));
    requests.push(request);
    try {
      const response = await fetchImpl(url, {
        ...options,
        body: wireBody,
        ...(direct ? { redirect: "error" } : {}),
        signal: AbortSignal.any([abort.signal, ...(options.signal ? [options.signal] : [])])
      });
      request.httpStatus = response.status;
      return captureResponse(response, request);
    } catch (error) {
      request.error = redact(error.message);
      throw error;
    }
  });
  const measured = {
    config,
    chat: async args => {
      throwIfAborted(abort.signal);
      if (turns.length >= bounds.maxModelTurns) return stop("model_turn_limit");
      const turn = { index: turns.length + 1 };
      turns.push(turn);
      const before = performance.now();
      try {
        const response = await client.chat(args);
        if (direct) {
          // Keep provider identity separate from AMOS routing receipts. The
          // unchanged hosted client also supplies local convenience defaults;
          // these do not attest a route, a fallback or server-side call count.
          response.usage = {
            ...response.usage,
            model: typeof response.raw?.model === "string" ? response.raw.model : null,
            requested_model: expectedServedModel,
            runtime: "direct-cortex", requested_runtime: "direct-cortex",
            served_model: null, frontier_route: null, provider_calls: null,
            correlation_id: null, fallback_used: null, fallback_reason: null
          };
        }
        Object.assign(turn, { message: structuredClone(response.message), usage: structuredClone(response.usage), raw: structuredClone(response.raw) });
        turn.servingEvidence = {
          source: direct ? "provider-response-model" : "amos-serving-metadata",
          expectedModel: expectedServedModel,
          reportedModel: direct ? response.raw?.model ?? null : response.usage.served_model,
          matched: direct
            ? response.raw?.model === expectedServedModel && !response.raw?.amos
            : response.usage.served_model === expectedServedModel && response.usage.fallback_used === false
        };
        if (!turn.servingEvidence.matched) {
          return stop("serving_identity_mismatch");
        }
        return response;
      } catch (error) {
        turn.error = redact(error.message);
        throw error;
      } finally { turn.wallMs = performance.now() - before; }
    }
  };
  const loop = new AgentLoop({
    config: { model: config, agent: { maxToolCycles: bounds.maxModelTurns, maxModelTransientRetries: 0 } },
    modelClient: measured, registry, systemPrompt,
    approvals: { ask: async () => stop("interactive_approval_requested") }, amosClient: {}
  });
  const unlink = linkAbortSignal(signal, abort);
  const timer = setTimeout(() => abort.abort("wall_limit"), bounds.maxWallMs);
  let answer = null, error = null;
  try {
    answer = await abortable(loop.run(fixture.prompt, {
      signal: abort.signal,
      onEvent: event => {
        if (!["assistant_delta", "thinking_delta"].includes(event.type)) {
          events.push({ modelTurn: turns.length, ...structuredClone(event) });
        }
      }
    }), abort.signal);
  } catch (cause) { error = redact(cause.message); }
  const result = {
    schema: "amos.desktop-fixture-execution", version: 1,
    fixtureId: fixture.id, synthetic: true, missionComparisonEligible: false,
    transportProfile, transportOrigin: origin,
    startedAt, wallMs: performance.now() - started, limits: bounds,
    status: abort.signal.aborted ? "aborted" : error ? "error" : "answered",
    stopReason: abort.signal.aborted ? redact(abort.signal.reason) : null,
    systemPromptSha256: sha(systemPrompt), answer, error, turns, requests, events,
    transcript: structuredClone(loop.messages), verification: { verdict: "unknown" }
  };
  try {
    throwIfAborted(abort.signal);
    const verdict = await abortable(Promise.resolve().then(() => verify(structuredClone(result))), abort.signal);
    if (!["pass", "fail", "unknown"].includes(verdict?.verdict)) throw new Error("Verifier must return pass, fail or unknown");
    result.verification = structuredClone(verdict);
  } catch (cause) { result.verification = { verdict: "unknown", error: redact(cause.message) }; }
  finally { clearTimeout(timer); unlink(); }
  if (abort.signal.aborted) {
    result.status = "aborted";
    result.stopReason = redact(abort.signal.reason);
  }
  result.wallMs = performance.now() - started;
  result.verifiedComplete = result.status === "answered" && result.verification.verdict === "pass";
  return structuredClone(result);
}

function bound(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Explicit integer limit required (${min}..${max})`);
  return value;
}
function sha(value) { return createHash("sha256").update(value).digest("hex"); }

function directCortexBody(clientBody, model) {
  const body = structuredClone(clientBody);
  body.model = model;
  delete body.amos_routing;
  delete body.amos_routing_shadow;
  delete body.reasoning_effort;
  body.enable_thinking = false;
  body.chat_template_kwargs = { enable_thinking: false };
  if (body.stream) body.stream_options = { include_usage: true };
  return body;
}

function captureResponse(response, record) {
  if (!response.body) return response;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const hash = createHash("sha256");
  const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
  let saved = 0, finished = false;
  const finish = complete => {
    if (finished) return;
    finished = true;
    record.responseBody += decoder.decode();
    record.responseBytesSha256 = hash.digest("hex");
    record.responseCaptureComplete = complete && !record.responseCaptureTruncated;
  };
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { finish(true); controller.close(); return; }
        record.responseBytes += value.byteLength;
        hash.update(value);
        const keep = Math.min(value.byteLength, MAX_CAPTURE_BYTES - saved);
        if (keep > 0) record.responseBody += decoder.decode(value.subarray(0, keep), { stream: true });
        saved += keep;
        if (keep < value.byteLength) record.responseCaptureTruncated = true;
        controller.enqueue(value);
      } catch (error) { finish(false); controller.error(error); }
    },
    async cancel(reason) { finish(false); await reader.cancel(reason); }
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Trusted asynchronous fixtures/transports should honor the signal. Racing it
// also stops the controller from waiting forever for a non-cooperative promise.
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(createAbortError(String(signal.reason || "aborted")));
    const done = (fn, value) => { signal.removeEventListener("abort", aborted); fn(value); };
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise).then(value => done(resolve, value), error => done(reject, error));
    if (signal.aborted) aborted();
  });
}
