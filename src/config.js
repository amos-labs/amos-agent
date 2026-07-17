import { resolve } from "node:path";

function boolFromEnv(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function intFromEnv(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const workspaceRoot = resolve(env.AMOS_AGENT_WORKSPACE || cwd);

  return {
    kimi: {
      apiKey: env.MOONSHOT_API_KEY || env.KIMI_API_KEY || "",
      baseUrl: env.MOONSHOT_BASE_URL || env.KIMI_BASE_URL || "https://api.moonshot.ai/v1",
      model: env.KIMI_MODEL || "kimi-k3",
      reasoningEffort: env.KIMI_REASONING_EFFORT || "max",
      maxCompletionTokens: intFromEnv(env.KIMI_MAX_COMPLETION_TOKENS, 8192)
    },
    amos: {
      mcpUrl: env.AMOS_MCP_URL || "https://app.amoslabs.com/mcp",
      apiKey: env.AMOS_API_KEY || env.AMOS_TOKEN || ""
    },
    safety: {
      workspaceRoot,
      allowOutsideWorkspace: boolFromEnv(env.AMOS_AGENT_ALLOW_OUTSIDE_WORKSPACE, false),
      autoApproveBash: boolFromEnv(env.AMOS_AGENT_AUTO_APPROVE_BASH, false),
      autoApproveWrites: boolFromEnv(env.AMOS_AGENT_AUTO_APPROVE_WRITES, false),
      bashPath: env.AMOS_AGENT_BASH || "/bin/bash",
      bashTimeoutMs: intFromEnv(env.AMOS_AGENT_BASH_TIMEOUT_MS, 60_000),
      maxOutputBytes: intFromEnv(env.AMOS_AGENT_MAX_OUTPUT_BYTES, 24_000)
    },
    search: {
      braveApiKey: env.BRAVE_SEARCH_API_KEY || ""
    },
    agent: {
      maxToolTurns: intFromEnv(env.AMOS_AGENT_MAX_TOOL_TURNS, 8)
    }
  };
}

export function validateConfig(config) {
  const missing = [];
  if (!config.kimi.apiKey) missing.push("MOONSHOT_API_KEY");
  if (!config.amos.apiKey) missing.push("AMOS_API_KEY");
  return missing;
}
