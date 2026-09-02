import { createRequire } from "node:module";
import { fetchCompat } from "../util/fetchCompat.js";
import {
  createAbortError,
  isAbortError,
  linkAbortSignal,
  throwIfAborted
} from "../util/abort.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const PACKAGE_VERSION = String(createRequire(import.meta.url)("../../package.json").version || "");
const DEFAULT_CLIENT_INFO = Object.freeze({ name: "amos-agent", version: PACKAGE_VERSION });
const NOT_CONNECTED = "AMOS is not connected. Run `amos-agent login` first.";

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
  constructor(
    {
      url,
      mcpUrl,
      apiKey,
      getAccessToken,
      requestTimeoutMs = 30_000,
      clientInfo = null,
      protocolVersion = MCP_PROTOCOL_VERSION
    },
    fetchImpl = fetchCompat
  ) {
    this.url = url || mcpUrl;
    this.apiKey = apiKey;
    this.getAccessToken = getAccessToken;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetch = fetchImpl;
    this.nextId = 1;
    this.clientInfo = { ...DEFAULT_CLIENT_INFO, ...(clientInfo || {}) };
    this.protocolVersion = protocolVersion;
    // Populated by the lazy `initialize` handshake. `negotiated: false` means
    // the server answered JSON-RPC without MCP lifecycle support (the AMOS
    // endpoint historically did), so requests continue without a session.
    this.session = null;
    this.handshake = null;
  }

  async request(method, params = {}, { signal = null } = {}) {
    throwIfAborted(signal);
    if (!this.url) {
      throw new Error("AMOS_MCP_URL is not configured");
    }

    await this.ensureInitialized({ signal });
    let response = await this.exchange(method, params, { signal });
    if (response.status === 404 && this.session?.id) {
      // The server forgot or expired our session. Re-negotiate once and retry.
      throwIfAborted(signal);
      this.session = null;
      await this.ensureInitialized({ signal });
      response = await this.exchange(method, params, { signal });
    }
    return unwrapJsonRpcResult(response);
  }

  async ensureInitialized({ signal = null } = {}) {
    if (this.session) return this.session;
    if (!this.handshake) {
      this.handshake = this.initialize({ signal }).finally(() => {
        this.handshake = null;
      });
    }
    return this.handshake;
  }

  async initialize({ signal = null } = {}) {
    const response = await this.exchange(
      "initialize",
      {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: this.clientInfo
      },
      { signal, session: { id: null, protocolVersion: null } }
    );

    let result;
    try {
      result = unwrapJsonRpcResult(response);
    } catch (error) {
      // A JSON-RPC error or a 4xx means this server does not implement the MCP
      // lifecycle. Keep talking plain JSON-RPC to it rather than failing.
      if (response.status === 401 || response.status === 403 || response.status >= 500) throw error;
      this.session = { id: null, protocolVersion: null, negotiated: false, reason: error.message };
      return this.session;
    }

    this.session = {
      id: response.sessionId || null,
      protocolVersion: cleanProtocolVersion(result?.protocolVersion) || this.protocolVersion,
      negotiated: true,
      serverInfo: plainObject(result?.serverInfo) ? result.serverInfo : null,
      capabilities: plainObject(result?.capabilities) ? result.capabilities : {}
    };

    try {
      await this.exchange("notifications/initialized", {}, { signal, notification: true });
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      // The notification is best-effort; a server may answer it with 4xx.
    }
    return this.session;
  }

  async exchange(method, params, { signal = null, session = this.session, notification = false } = {}) {
    const id = notification ? null : this.nextId++;
    let token = this.apiKey || (await this.getAccessToken?.());
    if (!token) throw new Error(NOT_CONNECTED);

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(session?.id ? { "Mcp-Session-Id": session.id } : {}),
      ...(session?.negotiated && session.protocolVersion
        ? { "MCP-Protocol-Version": session.protocolVersion }
        : {})
    };

    let response = await this.send({ id, method, params, headers, signal, notification });
    if (response.status === 401 && !this.apiKey && this.getAccessToken) {
      throwIfAborted(signal);
      token = await this.getAccessToken({ forceRefresh: true });
      if (!token) throw new Error(NOT_CONNECTED);
      headers.Authorization = `Bearer ${token}`;
      response = await this.send({ id, method, params, headers, signal, notification });
    }
    return response;
  }

  async send({ id, method, params, headers, signal = null, notification = false }) {
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
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(notification ? {} : { id }),
          method,
          params
        })
      });
      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers?.get?.("content-type") || "",
        sessionId: cleanSessionId(response.headers?.get?.("mcp-session-id")),
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

function unwrapJsonRpcResult(response) {
  const { text, contentType } = response;
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

// Session ids are visible ASCII per the MCP transport spec.
function cleanSessionId(value) {
  const text = String(value || "").trim();
  return text && /^[\x21-\x7E]{1,512}$/.test(text) ? text : null;
}

function cleanProtocolVersion(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}
