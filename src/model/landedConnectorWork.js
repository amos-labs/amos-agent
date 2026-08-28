import { normalizeScratchpad } from "./conversationScratchpad.js";

const MAX_LANDED_LINES = 12;
const MAX_LINE = 220;
const MAX_NOTES = 1_500;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isConnectorCall(name) {
  return /(^|_)connection_call$/.test(String(name || ""));
}

export function connectorWriteFingerprint(name, args = {}) {
  if (!isConnectorCall(name)) return "";
  const method = String(args.method || "GET").toUpperCase();
  if (!WRITE_METHODS.has(method)) return "";
  const path = normalizeVendorPath(String(args.path || ""));
  if (!path) return "";
  const connection = String(args.connection || "").trim().toLowerCase();
  return `${connection}|${method}|${path}|${normalizeWriteBody(args.body)}`;
}

export function summarizeConnectorCall({ name, args = {}, result = {} } = {}) {
  if (!isConnectorCall(name)) return null;
  const method = String(args.method || "GET").toUpperCase();
  if (!WRITE_METHODS.has(method)) return null;
  const path = normalizeVendorPath(String(args.path || result.path || ""));
  const status = Number(result.status);
  const ok = result.already_landed === true
    || result.ok === true
    || (Number.isFinite(status) && status >= 200 && status < 300);
  const id = scalar(result.body?.id, 80);
  const tax = scalar(
    result.body?.tax_behavior || bodyField(args.body, "tax_behavior") || bodyField(args.body, "taxbehavior"),
    24
  );
  const error = connectorErrorMessage(result);
  const extras = [
    id && `id=${id}`,
    tax && `tax_behavior=${tax}`,
    result.already_landed && "already_landed",
    !ok && error
  ].filter(Boolean);
  const line = [
    `${ok ? "LANDED" : "FAILED"} ${method} ${path || "(no path)"} → ${Number.isFinite(status) ? status : "?"}`,
    extras.join(" ")
  ].filter(Boolean).join(" ").slice(0, MAX_LINE);
  return {
    line,
    ok,
    fingerprint: connectorWriteFingerprint(name, args)
  };
}

export function recordConnectorCallOnScratchpad(pad, event, { now = () => new Date() } = {}) {
  const summary = summarizeConnectorCall(event);
  if (!summary) return pad;
  const next = normalizeScratchpad(pad);
  const lines = String(next.notes || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  if (lines.includes(summary.line)) {
    next.updatedAt = now().toISOString();
    return next;
  }
  next.notes = [summary.line, ...lines].slice(0, MAX_LANDED_LINES).join("\n").slice(0, MAX_NOTES);
  next.updatedAt = now().toISOString();
  return next;
}

export function alreadyLandedResult(fingerprint) {
  return {
    ok: true,
    already_landed: true,
    status: 200,
    fingerprint,
    note: "This exact write already succeeded in this conversation. Do not recreate it. Continue only unfinished work."
  };
}

export function scratchpadHasLandedWrite(pad, name, args = {}) {
  const method = String(args.method || "GET").toUpperCase();
  if (!WRITE_METHODS.has(method)) return false;
  const path = normalizeVendorPath(String(args.path || ""));
  if (!path) return false;
  return String(pad?.notes || "").includes(`LANDED ${method} ${path} →`);
}

function normalizeVendorPath(path) {
  return String(path || "")
    .replace(/\/(price|prod|cus|sub|si|in|ch|pi|pm|acct|evt)1/g, "/$1_1")
    .replace(/\/{2,}/g, "/")
    .slice(0, 180);
}

function normalizeWriteBody(body) {
  const value = coerceBody(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return String(value || "").slice(0, 240);
  }
  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    const alias = key === "taxbehavior" ? "tax_behavior" : key;
    if (item == null) continue;
    if (typeof item === "object") {
      normalized[alias] = item;
      continue;
    }
    normalized[alias] = item;
  }
  try {
    return JSON.stringify(normalized).slice(0, 240);
  } catch {
    return "";
  }
}

function coerceBody(body) {
  if (typeof body === "string") {
    const text = body.trim();
    if (!text) return "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return body;
}

function bodyField(body, key) {
  const value = coerceBody(body);
  if (!value || typeof value !== "object") return "";
  return value[key];
}

function connectorErrorMessage(result) {
  const body = result?.body;
  if (typeof body === "string" && body.trim()) return body.replace(/\s+/g, " ").trim().slice(0, 120);
  const message = body?.error?.message || body?.Fault?.Error?.[0]?.Message || result?.error;
  return scalar(message, 120);
}

function scalar(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
