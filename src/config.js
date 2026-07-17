import { homedir } from "node:os";
import { join, resolve } from "node:path";

function boolFromEnv(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function intFromEnv(value, defaultValue, min, max) {
  if (value == null || value === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const workspaceRoot = resolve(env.AMOS_AGENT_WORKSPACE || cwd);

  return {
    kimi: {
      apiKey: env.MOONSHOT_API_KEY || env.KIMI_API_KEY || "",
      baseUrl: env.MOONSHOT_BASE_URL || env.KIMI_BASE_URL || "https://api.moonshot.ai/v1",
      model: env.KIMI_MODEL || "kimi-k3",
      reasoningEffort: env.KIMI_REASONING_EFFORT || "max",
      maxCompletionTokens: intFromEnv(env.KIMI_MAX_COMPLETION_TOKENS, 8192, 1, 131_072),
      requestTimeoutMs: intFromEnv(env.KIMI_REQUEST_TIMEOUT_MS, 120_000, 1_000, 600_000)
    },
    amos: {
      mcpUrl: env.AMOS_MCP_URL || "https://app.amoslabs.com/mcp",
      apiKey: env.AMOS_API_KEY || env.AMOS_TOKEN || "",
      requestTimeoutMs: intFromEnv(env.AMOS_REQUEST_TIMEOUT_MS, 30_000, 1_000, 300_000)
    },
    auth: {
      credentialsPath:
        env.AMOS_AGENT_CREDENTIALS_FILE || join(env.AMOS_AGENT_CONFIG_DIR || join(homedir(), ".config", "amos-agent"), "oauth.json"),
      mode: ["auto", "oauth", "api-key"].includes(env.AMOS_AGENT_AUTH_MODE) ? env.AMOS_AGENT_AUTH_MODE : "auto"
    },
    safety: {
      workspaceRoot,
      allowOutsideWorkspace: boolFromEnv(env.AMOS_AGENT_ALLOW_OUTSIDE_WORKSPACE, false),
      autoApproveBash: boolFromEnv(env.AMOS_AGENT_AUTO_APPROVE_BASH, false),
      autoApproveWrites: boolFromEnv(env.AMOS_AGENT_AUTO_APPROVE_WRITES, false),
      bashPath: env.AMOS_AGENT_BASH || "/bin/bash",
      bashTimeoutMs: intFromEnv(env.AMOS_AGENT_BASH_TIMEOUT_MS, 60_000, 100, 600_000),
      maxOutputBytes: intFromEnv(env.AMOS_AGENT_MAX_OUTPUT_BYTES, 24_000, 1_024, 1_048_576)
    },
    search: {
      braveApiKey: env.BRAVE_SEARCH_API_KEY || ""
    },
    agent: {
      maxToolTurns: intFromEnv(env.AMOS_AGENT_MAX_TOOL_TURNS, 8, 1, 64)
    }
  };
}

export function validateConfig(config) {
  const missing = [];
  if (!config.kimi.apiKey) missing.push("MOONSHOT_API_KEY");
  return missing;
}
