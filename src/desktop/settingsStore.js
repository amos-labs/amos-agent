import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_INTELLIGENCE_ROLES,
  sanitizeIntelligenceRoles
} from "../model/intelligenceRoles.js";
import {
  DEFAULT_HYBRID_ROUTING,
  sanitizeHybridRouting
} from "../model/hybridRouting.js";
import { clean } from "../util/validate.js";

const VERSION = 1;
const PROVIDER_IDS = new Set([
  "kimi",
  "xai",
  "amos-hosted",
  "bedrock",
  "openai",
  "anthropic",
  "ollama",
  "llama-cpp",
  "openai-compatible"
]);
const CREDENTIAL_PROVIDERS = new Set([
  "kimi",
  "xai",
  "openai",
  "anthropic",
  "bedrock",
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
  bedrockAuthMode: "auto",
  intelligenceProfile: "auto",
  reasoningEffort: "",
  localRuntime: "ollama",
  operatingMode: "online",
  researchCheckpointMinutes: 0,
  autonomousCheckpointMinutes: 0,
  appearance: "system",
  workspace: "",
  localApprovalMode: "ask",
  localApprovalWorkspace: "",
  localApprovalKinds: [],
  amosMcpUrl: "https://app.amoslabs.com/mcp",
  telemetryEnabled: null,
  onboardingCompletedAt: "",
  onboardingBoundary: "",
  notifiedApprovalIds: [],
  notifiedMissionDecisionIds: [],
  deliveredApprovalOutcomeIds: [],
  intelligenceRoles: DEFAULT_INTELLIGENCE_ROLES,
  hybridRouting: DEFAULT_HYBRID_ROUTING,
  providerCredentials: {}
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

    const storedSettings = stored.settings && typeof stored.settings === "object" && !Array.isArray(stored.settings)
      ? stored.settings
      : {};
    const settings = {
      ...DEFAULT_DESKTOP_SETTINGS,
      // Settings fields are sanitized on every write and additive across
      // releases. Do not discard an otherwise valid settings object merely
      // because a newer Desktop release advances the envelope version.
      ...storedSettings
    };
    if (stored.encryptedApiKey) {
      settings.apiKey = this.decrypt(stored.encryptedApiKey);
    } else {
      settings.apiKey = "";
    }
    settings.providerCredentials = decryptProviderCredentials(
      stored.encryptedProviderCredentials,
      this.decrypt
    );
    if (settings.apiKey && settings.provider) {
      settings.providerCredentials = {
        ...settings.providerCredentials,
        [settings.provider]: settings.apiKey
      };
    } else if (!settings.apiKey && settings.providerCredentials[settings.provider]) {
      settings.apiKey = settings.providerCredentials[settings.provider];
    }
    settings.intelligenceRoles = sanitizeIntelligenceRoles(settings.intelligenceRoles);
    settings.hybridRouting = sanitizeHybridRouting(settings.hybridRouting);
    settings.intelligenceProfile = "auto";
    if (settings.provider === "amos-hosted") {
      settings.model = "auto";
      settings.baseUrl = "";
      settings.reasoningEffort = "";
      settings.apiKey = "";
    }
    return settings;
  }

  async write(input) {
    const settings = sanitizeSettings(input);
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const apiKey = settings.apiKey;
    const providerCredentials = {
      ...(settings.providerCredentials || {}),
      ...(apiKey && settings.provider ? { [settings.provider]: apiKey } : {})
    };
    delete settings.apiKey;
    delete settings.providerCredentials;

    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    const payload = {
      version: VERSION,
      settings,
      encryptedApiKey: apiKey ? this.encrypt(apiKey) : "",
      encryptedProviderCredentials: encryptProviderCredentials(providerCredentials, this.encrypt)
    };
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
    return { ...settings, apiKey, providerCredentials };
  }

  async asEnvironment() {
    const settings = await this.read();
    const autoApproveLocal = localAutoApproveEnabled(settings);
    return {
      AMOS_MODEL_PROVIDER: settings.provider,
      AMOS_MODEL: settings.model,
      AMOS_MODEL_BASE_URL: settings.baseUrl,
      AMOS_MODEL_API_KEY: settings.provider === "amos-hosted" ? "" : settings.apiKey,
      AMOS_BEDROCK_AUTH_MODE: settings.bedrockAuthMode,
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
    throw new Error("Local-only mode requires Ollama or llama.cpp infrastructure");
  }
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
    bedrockAuthMode: ["auto", "sigv4", "api-key"].includes(input.bedrockAuthMode)
      ? input.bedrockAuthMode
      : "auto",
    intelligenceProfile: "auto",
    reasoningEffort: managed
      ? ""
      : ["none", "low", "medium", "high", "max", "xhigh"].includes(input.reasoningEffort)
        ? input.reasoningEffort
        : "medium",
    localRuntime: input.localRuntime === "mtplx" ? "mtplx" : "ollama",
    operatingMode,
    researchCheckpointMinutes: checkpointMinutes(input.researchCheckpointMinutes, 0),
    autonomousCheckpointMinutes: checkpointMinutes(input.autonomousCheckpointMinutes, 0),
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
    telemetryEnabled:
      input.telemetryEnabled === true ? true
        : input.telemetryEnabled === false ? false
          : null,
    onboardingCompletedAt: isoOrEmpty(input.onboardingCompletedAt),
    onboardingBoundary: ["personal", "northwind", "company"].includes(input.onboardingBoundary)
      ? input.onboardingBoundary
      : "",
    notifiedApprovalIds: Array.isArray(input.notifiedApprovalIds)
      ? input.notifiedApprovalIds
          .map((value) => clean(value, 64))
          .filter(Boolean)
          .slice(-200)
      : [],
    notifiedMissionDecisionIds: Array.isArray(input.notifiedMissionDecisionIds)
      ? input.notifiedMissionDecisionIds
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
    apiKey: managed ? "" : clean(input.apiKey, 16_384),
    intelligenceRoles: sanitizeIntelligenceRoles(input.intelligenceRoles),
    hybridRouting: sanitizeHybridRouting(input.hybridRouting),
    providerCredentials: sanitizeProviderCredentials(input.providerCredentials)
  };
}

function checkpointMinutes(value, fallback) {
  const parsed = Number(value);
  return [0, 2, 5, 10, 15, 30, 60].includes(parsed) ? parsed : fallback;
}

function sanitizeProviderCredentials(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([provider, apiKey]) => CREDENTIAL_PROVIDERS.has(provider) && clean(apiKey, 16_384))
      .map(([provider, apiKey]) => [provider, clean(apiKey, 16_384)])
  );
}

function encryptProviderCredentials(credentials, encrypt) {
  const entries = Object.entries(credentials || {}).filter(([, apiKey]) => apiKey);
  if (entries.length === 0) return "";
  return encrypt(JSON.stringify(Object.fromEntries(entries)));
}

function decryptProviderCredentials(payload, decrypt) {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(decrypt(payload));
    return sanitizeProviderCredentials(parsed);
  } catch {
    return {};
  }
}

export function localAutoApproveEnabled(settings = {}) {
  return Boolean(
    settings.workspace &&
    settings.localApprovalMode === "workspace" &&
    settings.localApprovalWorkspace === settings.workspace
  );
}

export function credentialForProvider(settings = {}, providerId) {
  const provider = String(providerId || settings.provider || "");
  if (!provider || provider === "amos-hosted") return "";
  if (provider === settings.provider && settings.apiKey) return settings.apiKey;
  return settings.providerCredentials?.[provider] || "";
}

export function settingsForProvider(settings = {}, selection = {}) {
  const provider = String(selection.provider || settings.provider || "");
  const model = String(selection.model || (provider === settings.provider ? settings.model : "") || "");
  return {
    ...settings,
    provider,
    model,
    apiKey: credentialForProvider(settings, provider),
    baseUrl: provider === settings.provider ? settings.baseUrl : ""
  };
}

export function localApprovalKindEnabled(settings = {}, kind) {
  return Boolean(
    settings.workspace &&
    settings.localApprovalWorkspace === settings.workspace &&
    Array.isArray(settings.localApprovalKinds) &&
    settings.localApprovalKinds.includes(kind)
  );
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

function isoOrEmpty(value) {
  const cleaned = clean(value, 40);
  if (!cleaned) return "";
  const parsed = Date.parse(cleaned);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}
