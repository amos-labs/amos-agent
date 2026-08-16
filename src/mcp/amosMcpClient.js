import { fetchCompat } from "../util/fetchCompat.js";
import {
  createAbortError,
  isAbortError,
  linkAbortSignal,
  throwIfAborted
} from "../util/abort.js";

function parseMcpHttpBody(text, contentType = "") {
  if (!text) return {};

  if (contentType.includes("text/event-stream")) {
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
    const last = dataLines.at(-1);
    return last ? JSON.parse(last) : {};
  }

  return JSON.parse(text);
}

export function extractMcpText(result) {
  const content = result?.content || result?.result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (item.type === "text") return item.text || "";
      return JSON.stringify(item);
    })
    .filter(Boolean)
    .join("\n");
}

export function normalizeMcpToolResult(result) {
  const isError = result?.isError === true || result?.is_error === true;
  const structured = result?.structuredContent ?? result?.structured_content;
  const text = extractMcpText(result);
  const parsed = structured ?? parseMcpToolText(text);

  if (isError) {
    return {
      ok: false,
      error: mcpErrorMessage(parsed, text)
    };
  }
  if (plainObject(parsed)) {
    return parsed.ok === undefined ? { ...parsed, ok: true } : parsed;
  }
  if (Array.isArray(parsed)) return { ok: true, data: parsed };
  if (parsed !== undefined && parsed !== null && parsed !== "") {
    return { ok: true, data: parsed };
  }
  return { ok: true, text };
}

function parseMcpToolText(text) {
  const value = String(text || "").trim();
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mcpErrorMessage(payload, text) {
  if (plainObject(payload)) {
    return String(payload.error?.message || payload.error || payload.message || text || "AMOS tool failed");
  }
  return String(payload || text || "AMOS tool failed");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class AmosMcpClient {
  constructor({ url, mcpUrl, apiKey, getAccessToken, requestTimeoutMs = 30_000 }, fetchImpl = fetchCompat) {
    this.url = url || mcpUrl;
    this.apiKey = apiKey;
    this.getAccessToken = getAccessToken;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetch = fetchImpl;
    this.nextId = 1;
  }

  async request(method, params = {}, { signal = null } = {}) {
    throwIfAborted(signal);
    if (!this.url) {
      throw new Error("AMOS_MCP_URL is not configured");
    }

    const id = this.nextId++;
    let token = this.apiKey || (await this.getAccessToken?.());
    if (!token) throw new Error("AMOS is not connected. Run `amos-agent login` first.");

    let response = await this.send({ id, method, params, token, signal });
    if (response.status === 401 && !this.apiKey && this.getAccessToken) {
      throwIfAborted(signal);
      token = await this.getAccessToken({ forceRefresh: true });
      response = await this.send({ id, method, params, token, signal });
    }

    const text = response.text;
    const contentType = response.contentType;
    let payload = {};
    try {
      payload = parseMcpHttpBody(text, contentType);
    } catch {
      if (!response.ok) throw new Error(text || `MCP request failed with ${response.status}`);
      throw new Error("AMOS MCP returned an invalid response");
    }

    if (!response.ok) {
      throw new Error(payload?.error?.message || text || `MCP request failed with ${response.status}`);
    }

    if (payload.error) {
      throw new Error(payload.error.message || JSON.stringify(payload.error));
    }

    return payload.result;
  }

  async send({ id, method, params, token, signal = null }) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      const response = await this.fetch(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params
        })
      });
      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers?.get?.("content-type") || "",
        text: await response.text()
      };
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (timedOut || isAbortError(error)) throw new Error("AMOS MCP request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  listTools(options = {}) {
    return this.request("tools/list", {}, options);
  }

  callTool(name, args = {}, options = {}) {
    return this.request("tools/call", {
      name,
      arguments: args
    }, options);
  }
}
