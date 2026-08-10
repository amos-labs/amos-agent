import { OpenAICompatibleClient } from "./openAiCompatibleClient.js";
import { OpenAIResponsesClient } from "./openAiResponsesClient.js";
import { AnthropicMessagesClient } from "./anthropicMessagesClient.js";
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
      { id: "kimi-k3", label: "Kimi K3" }
    ],
    apiKeyEnv: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    apiKeyRequired: true,
    supportedReasoningEfforts: ["max"],
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
    description: "Customer or AMOS AWS inference through Bedrock's OpenAI-compatible API.",
    deployment: "customer-cloud",
    protocol: MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
    defaultBaseUrl: "",
    defaultModel: "openai.gpt-oss-120b-1:0",
    models: [
      { id: "openai.gpt-oss-20b-1:0", label: "GPT OSS 20B" },
      { id: "openai.gpt-oss-120b-1:0", label: "GPT OSS 120B" }
    ],
    apiKeyEnv: ["AWS_BEARER_TOKEN_BEDROCK", "BEDROCK_API_KEY"],
    apiKeyRequired: true,
    capabilities: { tools: true, vision: false, reasoning: true }
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
    apiKeyEnv: ["ANTHROPIC_API_KEY"],
    apiKeyRequired: true,
    defaultApiVersion: "2023-06-01",
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

  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1";
  const bedrockBaseUrl = `https://bedrock-mantle.${region}.api.aws/v1`;
  const hostedBaseUrl = hostedInferenceBaseUrl(env.AMOS_MCP_URL);
  const hosted = provider.id === "amos-hosted";
  const apiKey = provider.usesAmosIdentity
    ? ""
    : env.AMOS_MODEL_API_KEY ||
      provider.apiKeyEnv?.map((name) => env[name]).find(Boolean) ||
      provider.defaultApiKey ||
      "";

  const model = hosted
    ? "auto"
    : env.AMOS_MODEL || (provider.id === "kimi" ? env.KIMI_MODEL : "") || provider.defaultModel;
  const requestedReasoningEffort = hosted
    ? ""
    : env.AMOS_MODEL_REASONING_EFFORT ||
      (provider.id === "kimi" ? env.KIMI_REASONING_EFFORT : "") ||
      "max";

  return {
    provider: provider.id,
    protocol: normalizeModelProtocol(
      provider.id === "openai-compatible" ? env.AMOS_MODEL_PROTOCOL : "",
      provider.protocol
    ),
    displayName: provider.displayName,
    deployment: provider.deployment,
    apiKey,
    // AMOS Hosted is a first-party trust boundary. Never let a stale BYOK
    // endpoint redirect the user's AMOS bearer token away from the connected
    // AMOS origin, and never let a provider-specific model bypass server-side
    // routing.
    baseUrl: hosted
      ? hostedBaseUrl
      : env.AMOS_MODEL_BASE_URL || providerBaseUrl(provider, env, bedrockBaseUrl),
    model,
    routingOwner: hosted
      ? INTELLIGENCE_ROUTING_OWNERS.AMOS_DESKTOP
      : INTELLIGENCE_ROUTING_OWNERS.SELECTED_PROVIDER,
    routingMode: hosted ? "automatic" : "pinned",
    localRouterMode: hosted
      ? normalizeIntelligenceRouterRolloutMode(env.AMOS_LOCAL_ROUTER_MODE)
      : "disabled",
    apiVersion: env.AMOS_MODEL_API_VERSION ||
      (provider.id === "anthropic" ? env.ANTHROPIC_VERSION : "") ||
      provider.defaultApiVersion,
    reasoningEffort: normalizeReasoningEffort(
      provider,
      model,
      requestedReasoningEffort
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
    apiKeyRequired: provider.apiKeyRequired,
    usesAmosIdentity: Boolean(provider.usesAmosIdentity),
    capabilities: {
      ...provider.capabilities,
      tools: env.AMOS_MODEL_SUPPORTS_TOOLS == null
        ? provider.capabilities.tools
        : booleanValue(env.AMOS_MODEL_SUPPORTS_TOOLS)
    }
  };
}

function normalizeReasoningEffort(provider, model, requested) {
  if (
    provider.id === "kimi" &&
    /^kimi-k3(?:$|[-:])/i.test(model) &&
    !provider.supportedReasoningEfforts.includes(requested)
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
  const clientConfig = isAmosDesktopRoutingConfig(config)
    ? config
    : {
        ...config,
        routingOwner: INTELLIGENCE_ROUTING_OWNERS.SELECTED_PROVIDER,
        routingMode: "pinned",
        localRouterMode: "disabled",
        intelligenceRouter: null
      };
  if (protocol === MODEL_PROTOCOLS.OPENAI_RESPONSES) {
    return new OpenAIResponsesClient(clientConfig, fetchImpl);
  }
  if (protocol === MODEL_PROTOCOLS.ANTHROPIC_MESSAGES) {
    return new AnthropicMessagesClient(clientConfig, fetchImpl);
  }
  return new OpenAICompatibleClient(clientConfig, fetchImpl);
}

function providerBaseUrl(provider, env, bedrockBaseUrl) {
  if (provider.id === "kimi") {
    return env.MOONSHOT_BASE_URL || env.KIMI_BASE_URL || provider.defaultBaseUrl;
  }
  if (provider.id === "bedrock") return bedrockBaseUrl;
  return provider.defaultBaseUrl;
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
