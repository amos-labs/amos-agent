import { OpenAICompatibleClient } from "./openAiCompatibleClient.js";
import { OpenAIResponsesClient } from "./openAiResponsesClient.js";
import { AnthropicMessagesClient } from "./anthropicMessagesClient.js";
import { BEDROCK_MANTLE_CATALOG } from "./bedrockMantleCatalog.js";
import {
  BEDROCK_AUTH_MODES,
  createBedrockSigV4Signer,
  resolveBedrockAuthMode
} from "./bedrockSigV4.js";
import { MODEL_PROTOCOLS, normalizeModelProtocol } from "./protocol.js";
import {
  INTELLIGENCE_ROUTING_OWNERS,
  isAmosDesktopRoutingConfig,
  normalizeIntelligenceRouterRolloutMode
} from "./intelligenceRouter.js";

const DEFAULT_MAX_COMPLETION_TOKENS = 8_192;
const HOSTED_MAX_COMPLETION_TOKENS = 32_768;
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 120_000;
// Hosted tasks routinely span many governed tool cycles before a final model
// synthesis. Keep the client outside the platform's 10-minute request window
// so the server can return a precise outcome instead of losing a race with the
// Desktop abort timer.
const HOSTED_MODEL_REQUEST_TIMEOUT_MS = 660_000;
const MAX_MODEL_REQUEST_TIMEOUT_MS = 900_000;

const PROVIDERS = {
  kimi: {
    id: "kimi",
    displayName: "Moonshot / Kimi API",
    description: "Use your own Moonshot API key and choose a Kimi model directly.",
    deployment: "cloud",
    protocol: MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k3",
    models: [
      { id: "kimi-k3", label: "Kimi K3", supportedReasoningEfforts: ["low", "high", "max"], defaultReasoningEffort: "max" },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", supportedReasoningEfforts: ["low", "high", "max"], defaultReasoningEffort: "high" },
      { id: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code HighSpeed", supportedReasoningEfforts: ["low", "high", "max"], defaultReasoningEffort: "high" },
      { id: "kimi-k2.6", label: "Kimi K2.6", supportedReasoningEfforts: ["low", "high", "max"], defaultReasoningEffort: "high" }
    ],
    apiKeyEnv: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    apiKeyRequired: true,
    supportedReasoningEfforts: ["low", "high", "max"],
    defaultReasoningEffort: "max",
    capabilities: { tools: true, vision: true, reasoning: true }
  },
  xai: {
    id: "xai",
    displayName: "xAI / Grok",
    description: "Use your own xAI API key and choose a Grok model directly.",
    deployment: "cloud",
    protocol: MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.6",
    models: [
      { id: "grok-4.6", label: "Grok 4.6", supportedReasoningEfforts: ["low", "medium", "high", "xhigh"], defaultReasoningEffort: "high" },
      { id: "grok-4.5", label: "Grok 4.5", supportedReasoningEfforts: ["low", "medium", "high", "xhigh"], defaultReasoningEffort: "high" },
      { id: "grok-4.3", label: "Grok 4.3", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "high" },
      { id: "grok-build-0.1", label: "Grok Build 0.1", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }
    ],
    apiKeyEnv: ["XAI_API_KEY", "GROK_API_KEY"],
    apiKeyRequired: true,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "high",
    capabilities: { tools: true, vision: true, reasoning: true }
  },
  "amos-hosted": {
    id: "amos-hosted",
    displayName: "AMOS Intelligence",
    description: "AMOS automatically routes every step to the most efficient qualified intelligence without model lock-in.",
    deployment: "amos",
    protocol: MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
    defaultBaseUrl: "",
    defaultModel: "auto",
    apiKeyEnv: ["AMOS_MODEL_API_KEY"],
    apiKeyRequired: false,
    usesAmosIdentity: true,
    capabilities: { tools: true, vision: true, reasoning: true }
  },
  bedrock: {
    id: "bedrock",
    displayName: "Amazon Bedrock",
    description: "Customer or AMOS AWS inference through model-qualified Bedrock Mantle APIs.",
    deployment: "customer-cloud",
    protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
    defaultBaseUrl: "",
    defaultModel: BEDROCK_MANTLE_CATALOG.defaultModel,
    models: BEDROCK_MANTLE_CATALOG.models,
    endpoint: {
      schema: BEDROCK_MANTLE_CATALOG.schema,
      verifiedAt: BEDROCK_MANTLE_CATALOG.verifiedAt,
      defaultRegion: BEDROCK_MANTLE_CATALOG.defaultRegion,
      regions: BEDROCK_MANTLE_CATALOG.regions,
      originTemplate: BEDROCK_MANTLE_CATALOG.originTemplate,
      sources: BEDROCK_MANTLE_CATALOG.sources
    },
    apiKeyEnv: ["AWS_BEARER_TOKEN_BEDROCK", "BEDROCK_API_KEY"],
    apiKeyRequired: false,
    authModes: [BEDROCK_AUTH_MODES.SIGV4, BEDROCK_AUTH_MODES.API_KEY],
    defaultAuthMode: BEDROCK_AUTH_MODES.SIGV4,
    capabilities: { tools: true, vision: false, reasoning: true },
    catalogRequired: true
  },
  ollama: {
    id: "ollama",
    displayName: "AMOS Local",
    description: "Private intelligence on this computer with an AMOS-managed runtime and guided model setup.",
    deployment: "local",
    protocol: MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "gpt-oss:20b",
    defaultApiKey: "ollama",
    apiKeyRequired: false,
    capabilities: { tools: true, vision: true, reasoning: true }
  },
  "llama-cpp": {
    id: "llama-cpp",
    displayName: "Local model · llama.cpp",
    description: "A GGUF model served locally through llama-server.",
    deployment: "local",
    protocol: MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
    defaultBaseUrl: "http://127.0.0.1:8080/v1",
    defaultModel: "local-model",
    defaultApiKey: "local",
    apiKeyRequired: false,
    capabilities: { tools: true, vision: false, reasoning: false }
  },
  "openai-compatible": {
    id: "openai-compatible",
    displayName: "Compatible endpoint",
    description: "Any customer-controlled OpenAI-compatible endpoint.",
    deployment: "custom",
    protocol: MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
    defaultBaseUrl: "",
    defaultModel: "",
    apiKeyEnv: ["MODEL_API_KEY"],
    apiKeyRequired: false,
    capabilities: { tools: true, vision: false, reasoning: true }
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    description: "Direct OpenAI intelligence using the native Responses protocol.",
    deployment: "cloud",
    protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-terra",
    models: [
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" }
    ],
    apiKeyEnv: ["OPENAI_API_KEY"],
    apiKeyRequired: true,
    capabilities: { tools: true, vision: true, reasoning: true }
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    description: "Direct Claude intelligence using the native Messages protocol.",
    deployment: "cloud",
    protocol: MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-opus-5", label: "Claude Opus 5" },
      { id: "claude-fable-5", label: "Claude Fable 5" }
    ],
    apiKeyEnv: ["ANTHROPIC_API_KEY"],
    apiKeyRequired: true,
    defaultApiVersion: "2023-06-01",
    supportedReasoningEfforts: ["low", "medium", "high", "max"],
    defaultReasoningEffort: "medium",
    capabilities: { tools: true, vision: true, reasoning: true }
  }
};

export function listModelProviders() {
  return Object.values(PROVIDERS).map((provider) => structuredClone(provider));
}

export function getModelProvider(id) {
  return PROVIDERS[id] || null;
}

export function resolveModelConfig(env = process.env) {
  const providerId = env.AMOS_MODEL_PROVIDER || "kimi";
  const provider = getModelProvider(providerId);
  if (!provider) {
    throw new Error(`Unsupported AMOS_MODEL_PROVIDER: ${providerId}`);
  }

  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || BEDROCK_MANTLE_CATALOG.defaultRegion;
  const hostedBaseUrl = hostedInferenceBaseUrl(env.AMOS_MCP_URL);
  const hosted = provider.id === "amos-hosted";
  const apiKey = provider.usesAmosIdentity
    ? ""
    : env.AMOS_MODEL_API_KEY ||
      provider.apiKeyEnv?.map((name) => env[name]).find(Boolean) ||
      provider.defaultApiKey ||
      "";

  const requestedModel = hosted
    ? "auto"
    : env.AMOS_MODEL ||
      (provider.id === "kimi" ? env.KIMI_MODEL : "") ||
      (provider.id === "xai" ? env.XAI_MODEL || env.GROK_MODEL : "") ||
      provider.defaultModel;
  const modelProfile = resolveProviderModel(provider, requestedModel);
  const model = modelProfile?.id || requestedModel;
  const authMode = provider.id === "bedrock"
    ? resolveBedrockAuthMode(env.AMOS_BEDROCK_AUTH_MODE, apiKey)
    : "api-key";
  const requestedReasoningEffort = hosted
    ? ""
    : env.AMOS_MODEL_REASONING_EFFORT ||
      (provider.id === "kimi" ? env.KIMI_REASONING_EFFORT : "") ||
      modelProfile?.defaultReasoningEffort ||
      provider.defaultReasoningEffort ||
      "max";
  const baseUrl = hosted
    ? hostedBaseUrl
    : providerBaseUrl(provider, env, { modelProfile, region });

  return {
    provider: provider.id,
    protocol: normalizeModelProtocol(
      provider.id === "openai-compatible" ? env.AMOS_MODEL_PROTOCOL : "",
      modelProfile?.protocol || provider.protocol
    ),
    displayName: provider.displayName,
    deployment: provider.deployment,
    authMode,
    apiKey,
    // AMOS Hosted is a first-party trust boundary. Never let a stale BYOK
    // endpoint redirect the user's AMOS bearer token away from the connected
    // AMOS origin, and never let a provider-specific model bypass server-side
    // routing.
    baseUrl,
    model,
    routingOwner: hosted
      ? INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP
      : INTELLIGENCE_ROUTING_OWNERS.SELECTED_PROVIDER,
    routingMode: hosted ? "automatic" : "pinned",
    localRouterMode: hosted
      ? normalizeIntelligenceRouterRolloutMode(env.AMOS_LOCAL_ROUTER_MODE)
      : "disabled",
    apiVersion: env.AMOS_MODEL_API_VERSION || modelProfile?.apiVersion ||
      (provider.id === "anthropic" ? env.ANTHROPIC_VERSION : "") ||
      provider.defaultApiVersion,
    reasoningEffort: normalizeReasoningEffort(
      provider,
      model,
      requestedReasoningEffort,
      modelProfile
    ),
    maxCompletionTokens: boundedInt(
      env.AMOS_MODEL_MAX_COMPLETION_TOKENS ||
        (provider.id === "kimi" ? env.KIMI_MAX_COMPLETION_TOKENS : ""),
      hosted ? HOSTED_MAX_COMPLETION_TOKENS : DEFAULT_MAX_COMPLETION_TOKENS,
      1,
      131_072
    ),
    requestTimeoutMs: boundedInt(
      env.AMOS_MODEL_REQUEST_TIMEOUT_MS ||
        (provider.id === "kimi" ? env.KIMI_REQUEST_TIMEOUT_MS : ""),
      hosted ? HOSTED_MODEL_REQUEST_TIMEOUT_MS : DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
      1_000,
      MAX_MODEL_REQUEST_TIMEOUT_MS
    ),
    apiKeyRequired: provider.id === "bedrock"
      ? authMode === BEDROCK_AUTH_MODES.API_KEY
      : provider.apiKeyRequired,
    awsRegion: provider.id === "bedrock"
      ? bedrockRegionFromBaseUrl(baseUrl, provider.endpoint)
      : null,
    usesAmosIdentity: Boolean(provider.usesAmosIdentity),
    modelProfile: modelProfile ? publicModelProfile(modelProfile) : null,
    capabilities: {
      ...provider.capabilities,
      ...modelProfile?.capabilities,
      tools: env.AMOS_MODEL_SUPPORTS_TOOLS == null
        ? (modelProfile?.capabilities?.tools ?? provider.capabilities.tools)
        : booleanValue(env.AMOS_MODEL_SUPPORTS_TOOLS)
    }
  };
}

function normalizeReasoningEffort(provider, model, requested, modelProfile = null) {
  const supported = modelProfile?.supportedReasoningEfforts?.length
    ? modelProfile.supportedReasoningEfforts
    : provider.supportedReasoningEfforts;
  if (requested === "max" && supported?.includes("xhigh") && !supported.includes("max")) {
    return "xhigh";
  }
  if (supported?.length && !supported.includes(requested)) {
    return modelProfile?.defaultReasoningEffort || provider.defaultReasoningEffort || supported[0];
  }
  if (
    provider.id === "kimi" &&
    /^kimi-k3(?:$|[-:])/i.test(model) &&
    supported?.length &&
    !supported.includes(requested)
  ) {
    return "max";
  }
  return requested;
}

export function hostedInferenceBaseUrl(mcpUrl = "https://app.amoslabs.com/mcp") {
  const url = new URL(mcpUrl);
  url.pathname = "/v1";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function validateModelConfig(config) {
  const missing = [];
  if (!config.baseUrl) missing.push("AMOS_MODEL_BASE_URL");
  if (!config.model) missing.push("AMOS_MODEL");
  if (config.apiKeyRequired && !config.apiKey) {
    const provider = getModelProvider(config.provider);
    missing.push(provider?.apiKeyEnv?.[0] || "AMOS_MODEL_API_KEY");
  }
  return missing;
}

export function createModelClient(config, fetchImpl) {
  const protocol = normalizeModelProtocol(config.protocol);
  let clientConfig = isAmosDesktopRoutingConfig(config)
    ? config
    : {
        ...config,
        routingOwner: INTELLIGENCE_ROUTING_OWNERS.SELECTED_PROVIDER,
        routingMode: "pinned",
        localRouterMode: "disabled",
        intelligenceRouter: null
      };
  if (config.provider === "bedrock" && config.authMode === BEDROCK_AUTH_MODES.SIGV4) {
    clientConfig = {
      ...clientConfig,
      signRequest: createBedrockSigV4Signer({
        region: config.awsRegion,
        credentials: config.awsCredentialProvider
      })
    };
  }
  if (protocol === MODEL_PROTOCOLS.OPENAI_RESPONSES) {
    return new OpenAIResponsesClient(clientConfig, fetchImpl);
  }
  if (protocol === MODEL_PROTOCOLS.ANTHROPIC_MESSAGES) {
    return new AnthropicMessagesClient(clientConfig, fetchImpl);
  }
  return new OpenAICompatibleClient(clientConfig, fetchImpl);
}

function providerBaseUrl(provider, env, { modelProfile, region }) {
  if (provider.id === "kimi") {
    return env.MOONSHOT_BASE_URL || env.KIMI_BASE_URL || provider.defaultBaseUrl;
  }
  if (provider.id === "xai") {
    return env.XAI_BASE_URL || env.GROK_BASE_URL || provider.defaultBaseUrl;
  }
  if (provider.id === "bedrock") {
    return bedrockMantleBaseUrl(provider, modelProfile, env.AMOS_MODEL_BASE_URL, region);
  }
  return env.AMOS_MODEL_BASE_URL || provider.defaultBaseUrl;
}

export function resolveProviderModel(provider, modelId) {
  const requested = String(modelId || "").trim();
  if (!requested || !Array.isArray(provider?.models)) return null;
  const profile = provider.models.find((candidate) =>
    candidate.id === requested || candidate.aliases?.includes(requested)
  );
  if (!profile && provider.catalogRequired) {
    throw new Error(`${provider.displayName} model is not qualified for this Desktop build: ${requested}`);
  }
  return profile || null;
}

function bedrockMantleBaseUrl(provider, modelProfile, configuredBaseUrl, requestedRegion) {
  if (!modelProfile) {
    throw new Error("Choose a qualified Amazon Bedrock model");
  }
  const endpoint = provider.endpoint || BEDROCK_MANTLE_CATALOG;
  const initialRegion = requestedRegion || endpoint.defaultRegion;
  if (!modelProfile.regions?.includes(initialRegion) && !configuredBaseUrl) {
    throw new Error(`${modelProfile.label} is not qualified in Amazon Bedrock region ${initialRegion}`);
  }
  const fallbackOrigin = endpoint.originTemplate.replace("{region}", initialRegion);
  let url;
  try {
    url = new URL(configuredBaseUrl || fallbackOrigin);
  } catch {
    throw new Error("Amazon Bedrock endpoint must be a valid Mantle URL");
  }
  const region = bedrockMantleRegion(url, endpoint);
  if (!modelProfile.regions?.includes(region)) {
    throw new Error(`${modelProfile.label} is not qualified in Amazon Bedrock region ${region}`);
  }
  url.pathname = modelProfile.endpointPath;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function bedrockMantleRegion(url, endpoint) {
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Amazon Bedrock inference must use its canonical HTTPS Mantle endpoint");
  }
  const prefix = "bedrock-mantle.";
  const suffix = ".api.aws";
  if (!url.hostname.startsWith(prefix) || !url.hostname.endsWith(suffix)) {
    throw new Error("Amazon Bedrock credentials can only be sent to a Bedrock Mantle endpoint");
  }
  const region = url.hostname.slice(prefix.length, -suffix.length);
  if (!endpoint.regions.includes(region)) {
    throw new Error(`Amazon Bedrock Mantle is not qualified in region ${region || "unknown"}`);
  }
  return region;
}

function bedrockRegionFromBaseUrl(baseUrl, endpoint) {
  return bedrockMantleRegion(new URL(baseUrl), endpoint || BEDROCK_MANTLE_CATALOG);
}

function publicModelProfile(profile) {
  return {
    id: profile.id,
    label: profile.label,
    family: profile.family,
    protocol: profile.protocol,
    endpointPath: profile.endpointPath,
    authScheme: profile.authScheme,
    supportedReasoningEfforts: [...(profile.supportedReasoningEfforts || [])],
    defaultReasoningEffort: profile.defaultReasoningEffort,
    dataRetention: profile.dataRetention ? { ...profile.dataRetention } : null,
    regions: [...(profile.regions || [])]
  };
}

export const AMOS_INTELLIGENCE_ROUTING = Object.freeze({
  id: "auto",
  label: "Automatic",
  description: "AMOS selects the least expensive qualified intelligence for each task step and escalates only when required."
});

function booleanValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function boundedInt(value, defaultValue, min, max) {
  if (value == null || value === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}
