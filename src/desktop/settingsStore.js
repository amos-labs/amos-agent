import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;
const PROVIDER_IDS = new Set([
  "kimi",
  "amos-hosted",
  "bedrock",
  "ollama",
  "llama-cpp",
  "openai-compatible"
]);
export const LOCAL_APPROVAL_KINDS = Object.freeze([
  "shell",
  "file-write",
  "code-patch"
]);

export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  provider: "amos-hosted",
  model: "auto",
  baseUrl: "",
  intelligenceProfile: "balanced",
  reasoningEffort: "medium",
  operatingMode: "online",
  appearance: "system",
  workspace: "",
  localApprovalMode: "ask",
  localApprovalWorkspace: "",
  localApprovalKinds: [],
  amosMcpUrl: "https://app.amoslabs.com/mcp",
  notifiedApprovalIds: [],
  deliveredApprovalOutcomeIds: []
});

export class DesktopSettingsStore {
  constructor({ filePath, encrypt, decrypt }) {
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
  }

  async read() {
    let stored = {};
    try {
      stored = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Could not read AMOS Desktop settings: ${error.message}`);
      }
    }

    const settings = {
      ...DEFAULT_DESKTOP_SETTINGS,
      ...(stored.version === VERSION ? stored.settings : {})
    };
    if (stored.encryptedApiKey) {
      settings.apiKey = this.decrypt(stored.encryptedApiKey);
    } else {
      settings.apiKey = "";
    }
    return settings;
  }

  async write(input) {
    const settings = sanitizeSettings(input);
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const apiKey = settings.apiKey;
    delete settings.apiKey;

    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    const payload = {
      version: VERSION,
      settings,
      encryptedApiKey: apiKey ? this.encrypt(apiKey) : ""
    };
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
    return { ...settings, apiKey };
  }

  async asEnvironment() {
    const settings = await this.read();
    const autoApproveLocal = localAutoApproveEnabled(settings);
    return {
      AMOS_MODEL_PROVIDER: settings.provider,
      AMOS_MODEL: settings.model,
      AMOS_MODEL_BASE_URL: settings.baseUrl,
      AMOS_MODEL_API_KEY: settings.provider === "amos-hosted" ? "" : settings.apiKey,
      AMOS_MODEL_REASONING_EFFORT: settings.reasoningEffort,
      AMOS_AGENT_WORKSPACE: settings.workspace || process.cwd(),
      AMOS_AGENT_AUTO_APPROVE_BASH: autoApproveLocal ? "true" : "false",
      AMOS_AGENT_AUTO_APPROVE_WRITES: autoApproveLocal ? "true" : "false",
      AMOS_AGENT_AUTO_APPROVE_KINDS: (settings.localApprovalKinds || []).join(","),
      AMOS_MCP_URL: settings.amosMcpUrl
    };
  }
}

export function sanitizeSettings(input = {}) {
  const provider = clean(input.provider, 64) || DEFAULT_DESKTOP_SETTINGS.provider;
  if (!PROVIDER_IDS.has(provider)) throw new Error(`Unsupported intelligence provider: ${provider}`);
  const operatingMode = ["online", "personal", "offline"].includes(input.operatingMode)
    ? input.operatingMode
    : "online";
  if (operatingMode === "offline" && !["ollama", "llama-cpp"].includes(provider)) {
    throw new Error("Local-only mode requires an Ollama or llama.cpp intelligence profile");
  }
  const intelligenceProfile = ["efficient", "balanced", "deep", "frontier"].includes(
    input.intelligenceProfile
  )
    ? input.intelligenceProfile
    : profileForReasoning(input.reasoningEffort);
  const managed = provider === "amos-hosted";
  const workspace = clean(input.workspace, 4096);
  const requestedApprovalWorkspace = clean(input.localApprovalWorkspace, 4096);
  const requestedApprovalKinds = Array.isArray(input.localApprovalKinds)
    ? [...new Set(input.localApprovalKinds
        .map((value) => clean(value, 32))
        .filter((value) => LOCAL_APPROVAL_KINDS.includes(value)))]
    : [];
  const localApprovalMode =
    input.localApprovalMode === "workspace" &&
    Boolean(workspace) &&
    requestedApprovalWorkspace === workspace
      ? "workspace"
      : "ask";
  const localApprovalWorkspace =
    Boolean(workspace) &&
    requestedApprovalWorkspace === workspace &&
    (localApprovalMode === "workspace" || requestedApprovalKinds.length > 0)
      ? workspace
      : "";
  return {
    provider,
    model: managed ? "auto" : clean(input.model, 256),
    baseUrl: managed ? "" : validateEndpoint(input.baseUrl),
    intelligenceProfile,
    reasoningEffort: managed
      ? reasoningForProfile(intelligenceProfile)
      : ["none", "low", "medium", "high", "max"].includes(input.reasoningEffort)
        ? input.reasoningEffort
        : "medium",
    operatingMode,
    appearance: ["system", "light", "dark"].includes(input.appearance)
      ? input.appearance
      : "system",
    workspace,
    localApprovalMode,
    localApprovalWorkspace,
    localApprovalKinds: localApprovalWorkspace ? requestedApprovalKinds : [],
    amosMcpUrl: validateEndpoint(input.amosMcpUrl || DEFAULT_DESKTOP_SETTINGS.amosMcpUrl, {
      requireHttps: true
    }),
    notifiedApprovalIds: Array.isArray(input.notifiedApprovalIds)
      ? input.notifiedApprovalIds
          .map((value) => clean(value, 64))
          .filter(Boolean)
          .slice(-200)
      : [],
    deliveredApprovalOutcomeIds: Array.isArray(input.deliveredApprovalOutcomeIds)
      ? input.deliveredApprovalOutcomeIds
          .map((value) => clean(value, 64))
          .filter(Boolean)
          .slice(-200)
      : [],
    apiKey: managed ? "" : clean(input.apiKey, 16_384)
  };
}

export function localAutoApproveEnabled(settings = {}) {
  return Boolean(
    settings.workspace &&
    settings.localApprovalMode === "workspace" &&
    settings.localApprovalWorkspace === settings.workspace
  );
}

export function localApprovalKindEnabled(settings = {}, kind) {
  return Boolean(
    settings.workspace &&
    settings.localApprovalWorkspace === settings.workspace &&
    Array.isArray(settings.localApprovalKinds) &&
    settings.localApprovalKinds.includes(kind)
  );
}

function profileForReasoning(reasoningEffort) {
  if (reasoningEffort === "max") return "frontier";
  if (reasoningEffort === "high") return "deep";
  if (["none", "low"].includes(reasoningEffort)) return "efficient";
  return "balanced";
}

function reasoningForProfile(profile) {
  return {
    efficient: "low",
    balanced: "medium",
    deep: "high",
    frontier: "max"
  }[profile] || "medium";
}

function validateEndpoint(value, { requireHttps = false } = {}) {
  const cleaned = clean(value, 4096);
  if (!cleaned) return "";
  let url;
  try {
    url = new URL(cleaned);
  } catch {
    throw new Error(`Invalid endpoint: ${cleaned}`);
  }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && !requireHttps)) {
    throw new Error("Endpoints must use HTTPS; local model endpoints may use localhost HTTP");
  }
  url.username = "";
  url.password = "";
  return url.toString().replace(/\/$/, "");
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
