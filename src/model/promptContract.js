import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { canonicalizeJson, canonicalJson } from "../util/canonicalJson.js";

export const PROMPT_CONTRACT_VERSION = 1;

export function canonicalizePromptTools(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .map((tool) => Object.isFrozen(tool) ? tool : canonicalizeJson(tool));
}

export function buildPromptContract({
  provider = "compatible",
  protocol = "openai-chat-completions",
  model = "",
  tokenizer = "",
  chatTemplate = "",
  reasoningEffort = "",
  systemPrompt = "",
  tools = [],
  activeToolkits = [],
  authorityBoundary = null,
  tenantBoundary = null
} = {}) {
  const canonicalTools = canonicalizePromptTools(tools);
  const toolSchema = canonicalJson(canonicalTools);
  const payload = {
    version: PROMPT_CONTRACT_VERSION,
    provider: String(provider || "compatible"),
    protocol: String(protocol || "openai-chat-completions"),
    model: String(model || ""),
    tokenizer: String(tokenizer || model || ""),
    chatTemplate: String(chatTemplate || protocol || ""),
    reasoningEffort: String(reasoningEffort || ""),
    systemPromptSha256: digest(String(systemPrompt || "")),
    toolSchemaSha256: digest(toolSchema),
    toolSchemaBytes: Buffer.byteLength(toolSchema, "utf8"),
    activeToolkits: [...new Set((activeToolkits || []).map(String))].sort(),
    authorityBoundarySha256: boundaryDigest(authorityBoundary),
    tenantBoundarySha256: boundaryDigest(tenantBoundary)
  };
  const serialized = canonicalJson(payload);
  return Object.freeze({
    ...payload,
    sha256: digest(serialized)
  });
}

export function derivePromptSessionId({
  sessionKey,
  tenantBoundary = null,
  authorityBoundary = null
} = {}) {
  const key = String(sessionKey || "").trim();
  if (!key) return null;
  const serialized = canonicalJson({
    namespace: "amos.prompt-session.v1",
    sessionKey: key,
    tenantBoundarySha256: boundaryDigest(tenantBoundary),
    authorityBoundarySha256: boundaryDigest(authorityBoundary)
  });
  return `amos-${digest(serialized).slice(0, 48)}`;
}

export function promptContractConfig(model = {}) {
  const profile = model?.modelProfile || {};
  const protocol = model?.protocol || profile?.protocol || "openai-chat-completions";
  return {
    provider: model?.provider || model?.displayName || "compatible",
    protocol,
    model: model?.model || "",
    tokenizer: model?.tokenizer || profile?.tokenizer || model?.model || "",
    chatTemplate: model?.chatTemplate || profile?.chatTemplate || protocol,
    reasoningEffort: model?.reasoningEffort || ""
  };
}

function boundaryDigest(value) {
  return digest(canonicalJson(value == null || value === "" ? "unbound" : value));
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
