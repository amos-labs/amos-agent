import { fetchCompat } from "../util/fetchCompat.js";
import {
  createAbortError,
  isAbortError,
  linkAbortSignal,
  throwIfAborted
} from "../util/abort.js";
import { bedrockRetentionActionableError } from "./bedrockDataRetention.js";

export const MODEL_PROTOCOLS = Object.freeze({
  OPENAI_CHAT_COMPLETIONS: "openai-chat-completions",
  OPENAI_RESPONSES: "openai-responses",
  ANTHROPIC_MESSAGES: "anthropic-messages"
});

export const SUPPORTED_MODEL_PROTOCOLS = Object.freeze(Object.values(MODEL_PROTOCOLS));

export function normalizeModelProtocol(value, fallback = MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS) {
  const protocol = value || fallback;
  if (!SUPPORTED_MODEL_PROTOCOLS.includes(protocol)) {
    throw new Error(`Unsupported model protocol: ${protocol}`);
  }
  return protocol;
}

export function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

export function normalizedUsage(usage) {
  if (!usage) return null;
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? null;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? null;
  return compactObject({
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: usage.total_tokens ??
      (Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
        ? inputTokens + outputTokens
        : null),
    input_tokens_details: usage.input_tokens_details,
    output_tokens_details: usage.output_tokens_details,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    raw: usage
  });
}

export async function executeModelRequest({
  config,
  fetchImpl = fetchCompat,
  path,
  headers,
  body,
  signal,
  consume
}) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const requestStartedAt = performance.now();
  let lastActivityAt = requestStartedAt;
  let timedOut = false;
  let timer = null;
  const refreshTimeout = () => {
    lastActivityAt = performance.now();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.requestTimeoutMs || 120_000);
  };
  refreshTimeout();
  const unlink = linkAbortSignal(signal, controller);
  const displayName = config.displayName || "Model";

  try {
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
    let request = {
      method: "POST",
      headers: compactObject({ "Content-Type": "application/json", ...headers }),
      body: JSON.stringify(body)
    };
    if (typeof config.signRequest === "function") {
      request = {
        ...request,
        ...(await config.signRequest({ url, ...request }))
      };
    }
    throwIfAborted(signal);
    const response = await fetchImpl(url, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
      body: request.body
    });
    refreshTimeout();
    if (!response.ok) {
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      const providerMessage = payload?.error?.message || payload?.message || text ||
        `${displayName} request failed with ${response.status}`;
      const failure = new Error(bedrockRetentionActionableError(config, providerMessage));
      failure.status = response.status;
      failure.code = payload?.error?.code || payload?.code || "";
      failure.retryAfter = response.headers?.get?.("retry-after") || "";
      throw failure;
    }
    return await consume(response, {
      displayName,
      signal: controller.signal,
      onActivity: refreshTimeout
    });
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (timedOut || isAbortError(error)) {
      const timeout = new Error(`${displayName} request timed out after becoming inactive`);
      timeout.code = "AMOS_MODEL_TIMEOUT";
      timeout.phase = "streaming_response";
      timeout.timeoutMs = Number(config.requestTimeoutMs || 120_000);
      timeout.elapsedMs = Math.max(0, Math.round(performance.now() - requestStartedAt));
      timeout.inactiveMs = Math.max(0, Math.round(performance.now() - lastActivityAt));
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

export async function readJsonResponse(response, displayName) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${displayName} returned an invalid response`);
  }
}

export async function readSseEvents(response, {
  signal,
  onEvent,
  displayName,
  onActivity = () => {}
}) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    return { streamed: false, payload: await readJsonResponse(response, displayName), raw: null };
  }

  let raw = "";
  const consume = (event) => onEvent(parseSseEvent(event, displayName));
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
        raw += chunk;
        buffer += chunk;
        buffer = consumeSseFrames(buffer, consume);
      }
      buffer += decoder.decode();
      consumeSseFrames(`${buffer}\n\n`, consume);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      if (signal?.aborted) await reader.cancel().catch(() => {});
      reader.releaseLock?.();
    }
  } else {
    raw = await response.text();
    consumeSseFrames(`${raw}\n\n`, consume);
  }
  throwIfAborted(signal);
  return { streamed: true, raw, payload: null };
}

function consumeSseFrames(buffer, consume) {
  let remaining = buffer;
  while (true) {
    const boundary = remaining.search(/\r?\n\r?\n/);
    if (boundary < 0) break;
    const frame = remaining.slice(0, boundary);
    const separator = remaining.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
    remaining = remaining.slice(boundary + separator.length);
    if (frame.trim()) consume(frame);
  }
  return remaining;
}

function parseSseEvent(frame, displayName) {
  let event = "message";
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim() || event;
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  const joined = data.join("\n");
  if (!joined || joined === "[DONE]") return { event, data: null };
  try {
    return { event, data: JSON.parse(joined) };
  } catch {
    throw new Error(`${displayName} returned an invalid streaming response`);
  }
}
