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
    preclassifiedRouting = null,
    skipLocalRouting = false
  }) {
    throwIfAborted(signal);
    const requestStartedAt = performance.now();
    const body = {
      model: this.config.model,
      messages: messages.map(({ provider_state: _providerState, ...message }) => message)
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

    if (this.config.reasoningEffort && this.config.capabilities?.reasoning !== false) {
      body.reasoning_effort = this.config.reasoningEffort;
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
    const refreshTimeout = () => {
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
    try {
      const apiKey = this.config.apiKey || (await this.config.getAccessToken?.());
      throwIfAborted(signal);
      response = await this.fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: compactObject({
          Authorization: apiKey ? `Bearer ${apiKey}` : null,
          "Content-Type": "application/json",
          ...this.config.headers
        }),
        signal: controller.signal,
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (timedOut || isAbortError(error)) {
        throw new Error(`${this.config.displayName || "Model"} request timed out`);
      }
      throw error;
    }

    try {
      if (!response.ok) {
        const text = await response.text();
        let payload;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          payload = { raw: text };
        }
        const message = payload?.error?.message || text || `Model request failed with ${response.status}`;
        throw new Error(message);
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
          config: this.config,
          requestStartedAt,
          firstOutputAt: result.timing?.firstOutputAt || null,
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
          config: this.config,
          requestStartedAt,
          firstOutputAt: null,
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
        throw new Error(`${this.config.displayName || "Model"} request timed out`);
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
        firstOutputAt,
        timeToFirstOutputMs: Math.max(0, Math.round(firstOutputAt - requestStartedAt))
      }
    };
  }
  const message = { role: "assistant", content: "" };
  const toolCalls = new Map();
  let usage = null;
  let rawText = "";
  let firstOutputAt = null;

  const consume = (payload) => {
    usage = payload?.usage || usage;
    const delta = payload?.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.role === "string") message.role = delta.role;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      firstOutputAt ||= performance.now();
      message.content += delta.content;
      onDelta(delta.content, message.content);
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
      if (part.function?.name) current.function.name += part.function.name;
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
    raw: rawText,
    timing: {
      firstOutputAt,
      timeToFirstOutputMs: firstOutputAt
        ? Math.max(0, Math.round(firstOutputAt - requestStartedAt))
        : null
    }
  };
}

function withRequestMetrics(usage, {
  config,
  requestStartedAt,
  firstOutputAt,
  completedAt,
  raw
}) {
  const normalized = usage || {};
  const totalLatencyMs = Math.max(0, Math.round(completedAt - requestStartedAt));
  const generationMs = firstOutputAt
    ? Math.max(1, Math.round(completedAt - firstOutputAt))
    : null;
  const outputTokens = Number(normalized.output_tokens || 0);
  return {
    ...normalized,
    model: String(config?.model || ""),
    latency_ms: totalLatencyMs,
    time_to_first_output_ms: firstOutputAt
      ? Math.max(0, Math.round(firstOutputAt - requestStartedAt))
      : null,
    generation_tokens_per_second: generationMs && outputTokens > 0
      ? Number((outputTokens / (generationMs / 1_000)).toFixed(2))
      : null,
    load_ms: nanosecondsToMilliseconds(raw?.load_duration),
    prompt_eval_ms: nanosecondsToMilliseconds(raw?.prompt_eval_duration),
    generation_ms: nanosecondsToMilliseconds(raw?.eval_duration) ?? generationMs
  };
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
    try {
      consume(JSON.parse(data));
    } catch {
      throw new Error("Model returned an invalid streaming response");
    }
  }
  return remaining;
}
