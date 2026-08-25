import { fetchCompat } from "../util/fetchCompat.js";
import {
  createAbortError,
  isAbortError,
  linkAbortSignal,
  throwIfAborted
} from "../util/abort.js";
import {
  intelligenceRoutingEnvelope,
  isAmosDesktopRoutingConfig
} from "./intelligenceRouter.js";
import { normalizedUsage } from "./protocol.js";
import { mergeThoughtDelta } from "./thoughtDelta.js";

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

export class OpenAICompatibleClient {
  constructor(config, fetchImpl = fetchCompat) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async chat({
    messages,
    tools = [],
    onDelta = null,
    onRoutingDecision = null,
    signal = null,
    promptSessionId = null,
    promptContractHash = null,
    preclassifiedRouting = null,
    skipLocalRouting = false,
    reasoningEffortOverride = null
  }) {
    throwIfAborted(signal);
    const requestStartedAt = performance.now();
    const outboundMessages = this.config.provider === "ollama"
      ? canonicalizeStrictSystemMessages(messages)
      : messages;
    const body = {
      model: this.config.model,
      messages: outboundMessages.map(({ provider_state: _providerState, ...message }) => message)
    };

    const localRouting = await this.applyLocalRouting({
      body,
      messages,
      tools,
      signal,
      onRoutingDecision,
      preclassifiedRouting,
      skipLocalRouting
    });
    throwIfAborted(signal);

    const reasoningEffort = reasoningEffortOverride || this.config.reasoningEffort;
    if (reasoningEffort && this.config.capabilities?.reasoning !== false) {
      if (
        this.config.provider === "ollama" &&
        reasoningEffort === "none" &&
        /qwen3/i.test(this.config.model)
      ) {
        // Qwen-compatible local servers use the vLLM/SGLang thinking control.
        // Do not send `none` as an effort label: MTPLX correctly rejects it
        // because effort applies only when thinking is enabled.
        body.enable_thinking = false;
        body.chat_template_kwargs = { enable_thinking: false };
      } else {
        body.reasoning_effort = reasoningEffort;
      }
    }
    if (this.config.maxCompletionTokens > 0) {
      body.max_completion_tokens = this.config.maxCompletionTokens;
    }
    if (tools.length > 0 && this.config.capabilities?.tools !== false) {
      body.tools = tools;
    }
    if (typeof onDelta === "function") {
      body.stream = true;
    }

    const controller = new AbortController();
    let timedOut = false;
    let timer = null;
    let lastActivityAt = requestStartedAt;
    const refreshTimeout = () => {
      lastActivityAt = performance.now();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.config.requestTimeoutMs || 120_000);
      timer.unref?.();
    };
    refreshTimeout();
    const unlink = linkAbortSignal(signal, controller);
    let response;
    let sendRequest;
    let requestConfig = this.config;
    let usedLocalFallback = false;
    const activateLocalFallback = () => {
      const fallback = this.config.localFallback;
      if (!fallback?.baseUrl || !fallback?.model || usedLocalFallback) return false;
      usedLocalFallback = true;
      requestConfig = { ...this.config, ...fallback };
      body.model = fallback.model;
      return true;
    };
    try {
      const apiKey = this.config.apiKey || (await this.config.getAccessToken?.());
      throwIfAborted(signal);
      sendRequest = () => this.fetch(`${requestConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: compactObject({
          Authorization: apiKey ? `Bearer ${apiKey}` : null,
          "Content-Type": "application/json",
          ...localPromptCacheHeaders(this.config, {
            promptSessionId,
            promptContractHash
          }),
          ...this.config.headers
        }),
        signal: controller.signal,
        body: JSON.stringify(body)
      });
      try {
        response = await sendRequest();
      } catch (error) {
        if (signal?.aborted || timedOut || isAbortError(error) || !activateLocalFallback()) throw error;
        response = await sendRequest();
      }
      refreshTimeout();
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (timedOut || isAbortError(error)) {
        throw modelTimeoutError(this.config, requestStartedAt, lastActivityAt, "awaiting_response");
      }
      throw error;
    }

    try {
      if (!response.ok && response.status >= 500 && activateLocalFallback()) {
        refreshTimeout();
        response = await sendRequest();
        refreshTimeout();
      }
      if (!response.ok) {
        let failure = await modelFailure(response);
        const fallbackEffort = this.config.provider === "ollama"
          ? reasoningFallbackFromTemplateError(failure.message, body.reasoning_effort)
          : null;
        if (fallbackEffort) {
          // Some GGUF chat templates expose a narrower effort vocabulary than
          // the Ollama OpenAI adapter. Learn that live contract once and retain
          // it for the rest of this Desktop runtime instead of failing every
          // continuation until the app is redeployed.
          body.reasoning_effort = fallbackEffort;
          this.config.reasoningEffort = fallbackEffort;
          refreshTimeout();
          response = await sendRequest();
          refreshTimeout();
          if (!response.ok) failure = await modelFailure(response);
        }
        if (!response.ok) {
          const providerError = new Error(failure.message);
          providerError.status = response.status;
          providerError.code = failure.payload?.error?.code || failure.payload?.code || "";
          providerError.retryAfter = response.headers?.get?.("retry-after") || "";
          throw providerError;
        }
      }

      if (typeof onDelta === "function") {
        const result = await readStreamingResponse(response, {
          onDelta,
          signal,
          displayName: this.config.displayName || "Model",
          requestStartedAt,
          onActivity: refreshTimeout
        });
        result.usage = withRequestMetrics(result.usage, {
          config: requestConfig,
          requestedConfig: this.config,
          fallbackUsed: usedLocalFallback,
          requestStartedAt,
          firstOutputAt: result.timing?.firstOutputAt || null,
          bufferedResponse: result.timing?.buffered === true,
          completedAt: performance.now(),
          raw: result.raw
        });
        this.emitHostedRoutingOutcome({ localRouting, raw: result.raw, onRoutingDecision });
        return result;
      }

      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      const choice = payload.choices?.[0];
      if (!choice?.message) {
        throw new Error(`${this.config.displayName || "Model"} response did not include choices[0].message`);
      }

      const result = {
        message: choice.message,
        usage: withRequestMetrics(normalizedUsage(payload.usage), {
          config: requestConfig,
          requestedConfig: this.config,
          fallbackUsed: usedLocalFallback,
          requestStartedAt,
          firstOutputAt: null,
          bufferedResponse: true,
          completedAt: performance.now(),
          raw: payload
        }),
        raw: payload
      };
      this.emitHostedRoutingOutcome({ localRouting, raw: payload, onRoutingDecision });
      return result;
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (timedOut || isAbortError(error)) {
        throw modelTimeoutError(this.config, requestStartedAt, lastActivityAt, "streaming_response");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async applyLocalRouting({
    body,
    messages,
    tools,
    signal,
    onRoutingDecision,
    preclassifiedRouting,
    skipLocalRouting
  }) {
    const rolloutMode = this.config.localRouterMode || "disabled";
    if (!isAmosDesktopRoutingConfig(this.config) || rolloutMode === "disabled") return null;
    if (skipLocalRouting === true) return null;
    const phase = messages.some((message) => message?.role === "tool") ? "continue" : "plan";
    const publicFacts = {
      rolloutMode,
      phase,
      messageCount: messages.length,
      toolCount: tools.length
    };
    if (preclassifiedRouting?.minimumClass) {
      const envelope = intelligenceRoutingEnvelope({
        minimumClass: preclassifiedRouting.minimumClass,
        workflow: preclassifiedRouting.workflow,
        phase
      });
      if (rolloutMode === "active") body.amos_routing = envelope;
      else body.amos_routing_shadow = envelope;
      const event = {
        ...publicFacts,
        status: "classified",
        source: preclassifiedRouting.source || "amos-router",
        minimumClass: preclassifiedRouting.minimumClass,
        workflow: preclassifiedRouting.workflow || null,
        model: preclassifiedRouting.model || null,
        contract: preclassifiedRouting.contract || null,
        artifactSha256: preclassifiedRouting.artifactSha256 || null,
        latencyMs: Number(preclassifiedRouting.latencyMs || 0)
      };
      onRoutingDecision?.(event);
      return event;
    }
    if (!this.config.intelligenceRouter) {
      const event = {
        ...publicFacts,
        status: "fallback",
        source: "hosted",
        reason: "local_router_unavailable"
      };
      onRoutingDecision?.(event);
      return event;
    }
    try {
      const decision = await this.config.intelligenceRouter.classify({
        messages,
        tools,
        phase,
        signal
      });
      const envelope = intelligenceRoutingEnvelope({
        minimumClass: decision.minimumClass,
        workflow: decision.workflow,
        phase
      });
      if (rolloutMode === "active") body.amos_routing = envelope;
      else body.amos_routing_shadow = envelope;
      const event = {
        ...publicFacts,
        status: "classified",
        source: decision.source,
        minimumClass: decision.minimumClass,
        workflow: decision.workflow || null,
        model: decision.model,
        contract: decision.contract,
        artifactSha256: decision.artifactSha256,
        latencyMs: decision.latencyMs
      };
      onRoutingDecision?.(event);
      return event;
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      const event = {
        ...publicFacts,
        status: "fallback",
        source: "hosted",
        reason: routerFailureCode(error)
      };
      onRoutingDecision?.(event);
      return event;
    }
  }

  emitHostedRoutingOutcome({ localRouting, raw, onRoutingDecision }) {
    const amos = raw?.amos;
    if (
      localRouting?.rolloutMode !== "shadow" ||
      !["compared", "invalid"].includes(amos?.local_router_shadow_status)
    ) {
      return;
    }
    onRoutingDecision?.({
      ...localRouting,
      status: amos.local_router_shadow_status,
      source: "platform",
      hostedClass: typeof amos.routed_tier === "string" ? amos.routed_tier : null,
      agreement: typeof amos.local_router_shadow_agreement === "boolean"
        ? amos.local_router_shadow_agreement
        : null
    });
  }
}

function canonicalizeStrictSystemMessages(messages = []) {
  const systemMessages = messages.filter((message) => message?.role === "system");
  if (systemMessages.length === 0) return messages;
  if (systemMessages.length === 1 && messages[0] === systemMessages[0]) return messages;
  const leadingSystem = {
    ...systemMessages[0],
    content: systemMessages.map((message) => systemContent(message.content)).filter(Boolean).join("\n\n")
  };
  return [leadingSystem, ...messages.filter((message) => message?.role !== "system")];
}

function systemContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((item) => item?.type === "text" ? String(item.text || "") : JSON.stringify(item)).join("\n");
}

async function modelFailure(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return {
    payload,
    message: withCorrelationReference(
      payload?.error?.message || text || `Model request failed with ${response.status}`,
      payload?.error?.correlation_id
    )
  };
}

function reasoningFallbackFromTemplateError(message, current) {
  const text = String(message || "");
  if (!/reasoning effort|reasoning value/i.test(text)) return null;
  const supportedText = text.match(/supported types? (?:are|:)\s*([^.]*)/i)?.[1] ||
    text.match(/must be\s*([^)]*)/i)?.[1] || "";
  const supported = [...new Set(
    supportedText.toLowerCase().match(/\b(?:xhigh|max|high|medium|low|none)\b/g) || []
  )];
  if (supported.length === 0 || supported.includes(current)) return null;
  const preferences = {
    xhigh: ["xhigh", "max", "high", "medium", "low", "none"],
    max: ["max", "xhigh", "high", "medium", "low", "none"],
    high: ["high", "xhigh", "max", "medium", "low", "none"],
    medium: ["medium", "high", "low", "xhigh", "max", "none"],
    low: ["low", "medium", "none", "high", "xhigh", "max"],
    none: ["none", "low", "medium", "high", "xhigh", "max"]
  };
  return (preferences[current] || preferences.medium).find((effort) => supported.includes(effort)) || null;
}

function streamReasoningDelta(delta) {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.reasoning_content === "string") return delta.reasoning_content;
  if (typeof delta.reasoning === "string") return delta.reasoning;
  if (typeof delta.reasoning?.content === "string") return delta.reasoning.content;
  if (typeof delta.thinking === "string") return delta.thinking;
  return "";
}

function routerFailureCode(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("timed out")) return "local_router_timeout";
  if (message.includes("invalid")) return "local_router_invalid_output";
  return "local_router_unavailable";
}

async function readStreamingResponse(response, {
  onDelta,
  signal,
  displayName,
  requestStartedAt = performance.now(),
  onActivity = () => {}
}) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const text = await response.text();
    onActivity();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`${displayName} returned an invalid response`);
    }
    const message = payload?.choices?.[0]?.message;
    if (!message) {
      throw new Error(`${displayName} response did not include choices[0].message`);
    }
    if (typeof message.content === "string" && message.content) {
      onDelta(message.content, message.content);
    }
    const firstOutputAt = performance.now();
    return {
      message,
      usage: normalizedUsage(payload.usage),
      raw: payload,
      timing: {
        buffered: true,
        firstOutputAt,
        timeToFirstOutputMs: Math.max(0, Math.round(firstOutputAt - requestStartedAt))
      }
    };
  }
  const message = { role: "assistant", content: "" };
  const toolCalls = new Map();
  let usage = null;
  let rawText = "";
  let finalPayload = null;
  let firstOutputAt = null;

  const consume = (payload) => {
    if (payload?.error?.message) {
      const error = new Error(withCorrelationReference(
        payload.error.message,
        payload.error.correlation_id
      ));
      error.code = payload.error.code || "AMOS_PROVIDER_STREAM_ERROR";
      throw error;
    }
    finalPayload = payload ? { ...(finalPayload || {}), ...payload } : finalPayload;
    usage = payload?.usage || usage;
    const delta = payload?.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.role === "string") message.role = delta.role;
    if (Array.isArray(delta.amos_bedrock_reasoning)) {
      message.amos_bedrock_reasoning = delta.amos_bedrock_reasoning;
    }
    if (typeof delta.content === "string" && delta.content.length > 0) {
      firstOutputAt ||= performance.now();
      message.content += delta.content;
      onDelta(delta.content, message.content);
    }
    const reasoningDelta = streamReasoningDelta(delta);
    if (reasoningDelta) {
      firstOutputAt ||= performance.now();
      message.reasoning_content = mergeThoughtDelta(message.reasoning_content, reasoningDelta);
      onDelta("", message.content, {
        channel: "thinking",
        thinking: message.reasoning_content
      });
    }
    for (const part of delta.tool_calls || []) {
      firstOutputAt ||= performance.now();
      const index = Number.isInteger(part.index) ? part.index : toolCalls.size;
      const current = toolCalls.get(index) || {
        id: "",
        type: "function",
        function: { name: "", arguments: "" }
      };
      if (part.id) current.id += part.id;
      if (part.type) current.type = part.type;
      if (part.function?.name) {
        current.function.name += part.function.name;
        onDelta("", message.content, {
          channel: "tool",
          toolName: current.function.name
        });
      }
      if (part.function?.arguments) current.function.arguments += part.function.arguments;
      toolCalls.set(index, current);
    }
  };

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        if (done) break;
        onActivity();
        const chunk = decoder.decode(value, { stream: true });
        rawText += chunk;
        buffer += chunk;
        buffer = consumeSseEvents(buffer, consume);
      }
      buffer += decoder.decode();
      consumeSseEvents(`${buffer}\n\n`, consume);
    } finally {
      if (signal?.aborted) await reader.cancel().catch(() => {});
    }
  } else {
    rawText = await response.text();
    onActivity();
    consumeSseEvents(`${rawText}\n\n`, consume);
  }

  throwIfAborted(signal);
  if (toolCalls.size > 0) {
    message.tool_calls = [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value);
  }
  if (!message.content && toolCalls.size === 0) {
    throw new Error(`${displayName} streaming response did not include content or tool calls`);
  }
  return {
    message,
    usage: normalizedUsage(usage),
    raw: finalPayload || rawText,
    timing: {
      buffered: false,
      firstOutputAt,
      timeToFirstOutputMs: firstOutputAt
        ? Math.max(0, Math.round(firstOutputAt - requestStartedAt))
        : null
    }
  };
}

function withCorrelationReference(message, correlationId) {
  const reference = String(correlationId || "").trim();
  return reference ? `${message} Reference: ${reference}.` : message;
}

function modelTimeoutError(config, requestStartedAt, lastActivityAt, phase) {
  const now = performance.now();
  const error = new Error(`${config.displayName || "Model"} request timed out`);
  error.code = "AMOS_MODEL_TIMEOUT";
  error.timeoutMs = Number(config.requestTimeoutMs || 120_000);
  error.elapsedMs = Math.max(0, Math.round(now - requestStartedAt));
  error.inactiveMs = Math.max(0, Math.round(now - lastActivityAt));
  error.phase = phase;
  return error;
}

function withRequestMetrics(usage, {
  config,
  requestedConfig = config,
  fallbackUsed = false,
  requestStartedAt,
  firstOutputAt,
  bufferedResponse = false,
  completedAt,
  raw
}) {
  const normalized = usage || {};
  const stats = raw?.mtplx_stats && typeof raw.mtplx_stats === "object"
    ? raw.mtplx_stats
    : {};
  const totalLatencyMs = Math.max(0, Math.round(completedAt - requestStartedAt));
  const observedGenerationMs = !bufferedResponse && firstOutputAt
    ? Math.max(1, Math.round(completedAt - firstOutputAt))
    : null;
  const nativeGenerationMs = nanosecondsToMilliseconds(raw?.eval_duration);
  const generationMs = nativeGenerationMs ?? observedGenerationMs;
  const outputTokens = Number(normalized.output_tokens || 0);
  const cachedInputTokens = firstFinite(
    normalized.cache_read_input_tokens,
    normalized.input_tokens_details?.cached_tokens,
    normalized.prompt_tokens_details?.cached_tokens,
    stats.cached_tokens
  );
  return {
    ...normalized,
    ...(cachedInputTokens == null ? {} : { cache_read_input_tokens: cachedInputTokens }),
    model: String(config?.model || ""),
    requested_model: String(requestedConfig?.model || ""),
    runtime: localRuntimeName(config),
    requested_runtime: localRuntimeName(requestedConfig),
    fallback_used: fallbackUsed === true,
    fallback_reason: fallbackUsed === true ? "primary_transport_failed" : null,
    response_streamed: !bufferedResponse,
    latency_ms: totalLatencyMs,
    time_to_first_output_ms: firstOutputAt
      ? Math.max(0, Math.round(firstOutputAt - requestStartedAt))
      : null,
    generation_tokens_per_second: generationMs && outputTokens > 0
      ? Number((outputTokens / (generationMs / 1_000)).toFixed(2))
      : null,
    load_ms: nanosecondsToMilliseconds(raw?.load_duration),
    prompt_eval_ms: nanosecondsToMilliseconds(raw?.prompt_eval_duration),
    generation_ms: generationMs,
    session_cache_hit: booleanOrNull(stats.session_cache_hit),
    cache_source: textOrNull(stats.cache_source),
    cache_miss_reason: textOrNull(stats.cache_miss_reason),
    request_session_source: textOrNull(stats.request_session_source),
    new_prefill_tokens: firstFinite(stats.new_prefill_tokens),
    ssd_cache_hit: booleanOrNull(stats.ssd_cache_hit),
    ssd_cached_tokens: firstFinite(stats.ssd_cached_tokens),
    ssd_restore_s: firstFinite(stats.ssd_restore_s),
    session_restore_mode: textOrNull(stats.session_restore_mode)
  };
}

function localRuntimeName(config) {
  const explicit = String(config?.runtime || "").trim().toLowerCase();
  if (explicit) return explicit.slice(0, 32);
  const model = String(config?.model || "").toLowerCase();
  if (model.includes("mtplx")) return "mtplx";
  try {
    if (new URL(config?.baseUrl).port === "18081") return "mtplx";
  } catch {
    // Fall through to the provider label.
  }
  return String(config?.provider || "").trim().toLowerCase().slice(0, 32) || null;
}

function localPromptCacheHeaders(config, { promptSessionId, promptContractHash }) {
  if (!promptSessionId || !isLocalModelEndpoint(config)) return {};
  return {
    "X-MTPLX-Session-ID": String(promptSessionId).slice(0, 128),
    ...(promptContractHash
      ? { "X-AMOS-Prompt-Contract": String(promptContractHash).slice(0, 128) }
      : {})
  };
}

function isLocalModelEndpoint(config) {
  if (config?.deployment === "local") return true;
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(config?.baseUrl).hostname);
  } catch {
    return false;
  }
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 256) : null;
}

function nanosecondsToMilliseconds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed / 1_000_000) : null;
}

function consumeSseEvents(buffer, consume) {
  let remaining = buffer;
  while (true) {
    const boundary = remaining.search(/\r?\n\r?\n/);
    if (boundary < 0) break;
    const event = remaining.slice(0, boundary);
    const separator = remaining.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
    remaining = remaining.slice(boundary + separator.length);
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error("Model returned an invalid streaming response");
    }
    consume(payload);
  }
  return remaining;
}
