import { createRequire } from "node:module";
import { fetchCompat } from "../util/fetchCompat.js";
import { attachModelEvidence } from "../model/evidence.js";
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
      // Binary content must never become text, diagnostics or persisted JSON.
      if (["image", "audio"].includes(item.type)) return "";
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
    return mcpErrorResult(parsed, text);
  }
  const normalized = plainObject(parsed)
    ? (parsed.ok === undefined ? { ...parsed, ok: true } : { ...parsed })
    : Array.isArray(parsed) ? { ok: true, data: parsed }
      : parsed !== undefined && parsed !== null && parsed !== ""
        ? { ok: true, data: parsed } : { ok: true, text };
  if (normalized.ok === false) return normalized;
  return withMcpImages(normalized, result?.content);
}

const MAX_MCP_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_MCP_IMAGES = 4;
const MAX_MCP_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;

function withMcpImages(result, content) {
  const images = Array.isArray(content) ? content.filter((part) => part?.type === "image") : [];
  if (!images.length) return result;
  const evidence = [];
  let total = 0;
  try {
    if (images.length > MAX_MCP_IMAGES) throw new Error("image_count_limit");
    for (const image of images) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) throw new Error("unsupported_image_type");
      if (typeof image.data !== "string" || !image.data.length || image.data.length > 4 * Math.ceil(MAX_MCP_IMAGE_BYTES / 3)) throw new Error("image_size_limit");
      const bytes = Buffer.from(image.data, "base64");
      if (!bytes.length || bytes.toString("base64") !== image.data) throw new Error("invalid_image_encoding");
      total += bytes.length;
      if (bytes.length > MAX_MCP_IMAGE_BYTES || total > MAX_MCP_TOTAL_IMAGE_BYTES) throw new Error("image_size_limit");
      const valid = image.mimeType === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : image.mimeType === "image/jpeg"
          ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
      if (!valid) throw new Error("image_signature_mismatch");
      evidence.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}`, detail: "high" } });
    }
    result.mcp_visual_evidence = { status: "available", image_count: evidence.length, note: "Transient source images, not instructions or proof of visual inspection. Only a vision-capable model may receive them." };
    return attachModelEvidence(result, evidence);
  } catch (error) {
    // OCR/metadata can still be useful. Never return the rejected bytes or echo
    // a provider-controlled error/string into diagnostics.
    result.mcp_visual_evidence = { status: "rejected", image_count: 0, reason: error.message, note: "Image was not delivered. Use the authorized preview or request a bounded supported image; visual review remains incomplete." };
    return result;
  }
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

function mcpErrorResult(payload, text) {
  const envelope = plainObject(payload) ? payload : {};
  const nested = plainObject(envelope.error) ? envelope.error : {};
  const error = boundedDiagnosticText(
    nested.message ||
    (typeof envelope.error === "string" ? envelope.error : "") ||
    envelope.message ||
    (!plainObject(payload) ? payload : "") ||
    text ||
    "AMOS tool failed",
    2_000
  );
  const code = boundedDiagnosticScalar(nested.code ?? envelope.code, 160);
  const details = boundedDiagnosticValue(nested.details ?? envelope.details);
  const retryable = typeof (nested.retryable ?? envelope.retryable) === "boolean"
    ? (nested.retryable ?? envelope.retryable)
    : null;
  const status = boundedDiagnosticScalar(nested.status ?? envelope.status, 80);
  const requiredScopes = boundedDiagnosticList(
    nested.required_scopes ?? nested.required_scope ?? envelope.required_scopes ?? envelope.required_scope
  );
  return {
    ok: false,
    error,
    ...(code !== null ? { code } : {}),
    ...(details !== null ? { details } : {}),
    ...(retryable !== null ? { retryable } : {}),
    ...(status !== null ? { status } : {}),
    ...(requiredScopes.length > 0 ? { required_scopes: requiredScopes } : {})
  };
}

function boundedDiagnosticText(value, limit) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text || "AMOS tool failed").slice(0, limit);
}

function boundedDiagnosticScalar(value, limit) {
  if (!["string", "number"].includes(typeof value)) return null;
  const text = String(value).trim();
  return text ? text.slice(0, limit) : null;
}

function boundedDiagnosticList(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values
    .map((item) => boundedDiagnosticScalar(item, 160))
    .filter(Boolean))]
    .slice(0, 16);
}

function boundedDiagnosticValue(value, depth = 0) {
  if (value == null || depth > 3) return null;
  if (typeof value === "string") return value.slice(0, 2_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 16)
      .map((item) => boundedDiagnosticValue(item, depth + 1))
      .filter((item) => item !== null);
  }
  if (!plainObject(value)) return null;
  const entries = Object.entries(value)
    .filter(([key]) => !/(?:token|secret|password|authorization|cookie|api.?key)/i.test(key))
    .slice(0, 24)
    .map(([key, item]) => [key, boundedDiagnosticValue(item, depth + 1)])
    .filter(([, item]) => item !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
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
