import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveModelConfig, validateModelConfig } from "./model/providers.js";

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

function localApprovalKindsFromEnv(value) {
  const supported = new Set(["shell", "file-write", "code-patch"]);
  return [...new Set(String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => supported.has(item)))];
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const workspaceRoot = resolve(env.AMOS_AGENT_WORKSPACE || cwd);
  const model = resolveModelConfig(env);

  return {
    model,
    // Compatibility for the 0.1 CLI API. Remove after downstream consumers migrate.
    kimi: model,
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
      autoApproveKinds: localApprovalKindsFromEnv(env.AMOS_AGENT_AUTO_APPROVE_KINDS),
      bashPath:
        env.AMOS_AGENT_SHELL ||
        env.AMOS_AGENT_BASH ||
        defaultShellPath(),
      bashTimeoutMs: intFromEnv(env.AMOS_AGENT_BASH_TIMEOUT_MS, 60_000, 100, 600_000),
      maxOutputBytes: intFromEnv(env.AMOS_AGENT_MAX_OUTPUT_BYTES, 24_000, 1_024, 1_048_576)
    },
    search: {
      braveApiKey: env.BRAVE_SEARCH_API_KEY || ""
    },
    agent: {
      maxRepeatedToolCycles: intFromEnv(
        env.AMOS_AGENT_MAX_REPEATED_TOOL_CYCLES,
        3,
        2,
        12
      ),
      maxConsecutiveToolErrorCycles: intFromEnv(
        env.AMOS_AGENT_MAX_CONSECUTIVE_TOOL_ERROR_CYCLES,
        3,
        1,
        12
      ),
      maxCapabilityDiscoveryCycles: intFromEnv(
        env.AMOS_AGENT_MAX_CAPABILITY_DISCOVERY_CYCLES,
        3,
        2,
        12
      ),
      maxModelTransientRetries: intFromEnv(
        env.AMOS_AGENT_MAX_MODEL_TRANSIENT_RETRIES,
        2,
        0,
        4
      )
    }
  };
}

export function defaultShellPath(platformName = process.platform) {
  return platformName === "win32" ? "powershell.exe" : "/bin/bash";
}

export function validateConfig(config) {
  return validateModelConfig(config.model || config.kimi);
}
