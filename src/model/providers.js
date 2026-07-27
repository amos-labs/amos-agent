import { OpenAICompatibleClient } from "./openAiCompatibleClient.js";

const PROVIDERS = {
  kimi: {
    id: "kimi",
    displayName: "Kimi API",
    description: "Moonshot-hosted Kimi for immediate access.",
    deployment: "cloud",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k3",
    apiKeyEnv: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    apiKeyRequired: true,
    supportedReasoningEfforts: ["max"],
    capabilities: { tools: true, vision: true, reasoning: true }
  },
  "amos-hosted": {
    id: "amos-hosted",
    displayName: "AMOS Hosted",
    description: "Ready with your AMOS sign-in. Included credits apply first; additional use is metered.",
    deployment: "amos",
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
    defaultBaseUrl: "",
    defaultModel: "openai.gpt-oss-120b",
    apiKeyEnv: ["AWS_BEARER_TOKEN_BEDROCK", "BEDROCK_API_KEY"],
    apiKeyRequired: true,
    capabilities: { tools: true, vision: false, reasoning: true }
  },
  ollama: {
    id: "ollama",
    displayName: "Local model · Ollama",
    description: "A smaller model running on the customer's computer.",
    deployment: "local",
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
    defaultBaseUrl: "",
    defaultModel: "",
    apiKeyEnv: ["MODEL_API_KEY"],
    apiKeyRequired: false,
    capabilities: { tools: true, vision: false, reasoning: true }
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

  const model = hosted ? "auto" : env.AMOS_MODEL || env.KIMI_MODEL || provider.defaultModel;
  const requestedReasoningEffort =
    env.AMOS_MODEL_REASONING_EFFORT || env.KIMI_REASONING_EFFORT || "max";

  return {
    provider: provider.id,
    displayName: provider.displayName,
    deployment: provider.deployment,
    apiKey,
    // AMOS Hosted is a first-party trust boundary. Never let a stale BYOK
    // endpoint redirect the user's AMOS bearer token away from the connected
    // AMOS origin, and never let a provider-specific model bypass server-side
    // routing.
    baseUrl: hosted
      ? hostedBaseUrl
      : env.AMOS_MODEL_BASE_URL ||
        env.MOONSHOT_BASE_URL ||
        env.KIMI_BASE_URL ||
        (provider.id === "bedrock" ? bedrockBaseUrl : provider.defaultBaseUrl),
    model,
    reasoningEffort: normalizeReasoningEffort(
      provider,
      model,
      requestedReasoningEffort
    ),
    maxCompletionTokens: boundedInt(
      env.AMOS_MODEL_MAX_COMPLETION_TOKENS || env.KIMI_MAX_COMPLETION_TOKENS,
      8192,
      1,
      131_072
    ),
    requestTimeoutMs: boundedInt(
      env.AMOS_MODEL_REQUEST_TIMEOUT_MS || env.KIMI_REQUEST_TIMEOUT_MS,
      120_000,
      1_000,
      600_000
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
  return new OpenAICompatibleClient(config, fetchImpl);
}

function booleanValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function boundedInt(value, defaultValue, min, max) {
  if (value == null || value === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}
