#!/usr/bin/env node
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, validateConfig } from "../src/config.js";
import { ConsoleApprovals } from "../src/util/approval.js";
import { FileTokenStore } from "../src/auth/tokenStore.js";
import { AmosOAuthSession } from "../src/auth/oauth.js";
import { createRuntime as createAgentRuntime, shouldUseOAuth } from "../src/runtime.js";

function parseArgs(argv) {
  const args = { command: "", once: "", cwd: process.cwd(), help: false, openBrowser: true };
  const rest = [];

  if (["login", "logout", "status"].includes(argv[0])) {
    args.command = argv.shift();
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--once") args.once = argv[++i] || "";
    else if (arg === "--cwd") args.cwd = argv[++i] || process.cwd();
    else if (arg === "--no-open") args.openBrowser = false;
    else rest.push(arg);
  }

  if (!args.once && rest.length > 0) {
    args.once = rest.join(" ");
  }

  return args;
}

function printHelp() {
  console.log(`AMOS Agent

Usage:
  amos-agent login                   Connect to AMOS in your browser
  amos-agent status                  Show local AMOS connection status
  amos-agent logout                  Remove the local AMOS OAuth session
  amos-agent                         Start interactive local agent
  amos-agent --once "Do a thing"      Run one prompt
  amos-agent "Do a thing"             Run one prompt
  amos-agent --cwd ./repo             Set workspace root

Model env:
  AMOS_MODEL_PROVIDER                 kimi | amos-hosted | bedrock | ollama | llama-cpp | openai-compatible
  AMOS_MODEL                          Model name for the selected provider
  AMOS_MODEL_BASE_URL                 Required for AMOS-hosted and custom providers
  AMOS_MODEL_API_KEY                  Provider token; aliases remain supported

Optional env:
  AMOS_MCP_URL                        Default: https://app.amoslabs.com/mcp
  AMOS_API_KEY                        API key override for CI/unattended agents
  KIMI_MODEL                          Default: kimi-k3
  BRAVE_SEARCH_API_KEY                Enables native web_search
  AMOS_AGENT_AUTO_APPROVE_BASH=true   Disable bash prompts
`);
}

function printEvent(event) {
  if (event.type === "tool_start") {
    console.log(`\n> tool ${event.name}`);
  } else if (event.type === "tool_error") {
    console.log(`> tool ${event.name} error: ${event.error}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadConfig(process.env, args.cwd);
  const tokenStore = new FileTokenStore(config.auth.credentialsPath);
  const oauth = new AmosOAuthSession({
    mcpUrl: config.amos.mcpUrl,
    store: tokenStore,
    requestTimeoutMs: config.amos.requestTimeoutMs
  });

  if (args.command === "login") {
    const credentials = await oauth.login({
      openBrowser: args.openBrowser,
      onAuthorize({ url, browserOpened }) {
        console.log(browserOpened ? "Opening your browser for AMOS authorization..." : "Open this URL to authorize AMOS Agent:");
        console.log(url);
      }
    });
    console.log(`AMOS Agent connected. Access expires ${new Date(credentials.expires_at).toLocaleString()}.`);
    return;
  }
  if (args.command === "logout") {
    await oauth.logout();
    console.log("AMOS Agent disconnected. Local OAuth credentials removed.");
    return;
  }
  if (args.command === "status") {
    const credentials = await oauth.status();
    const useOAuth = shouldUseOAuth(config, credentials);
    if (useOAuth) {
      await oauth.getAccessToken();
      const current = await oauth.status();
      console.log(`Connected to ${config.amos.mcpUrl} with OAuth.`);
      console.log(`Access expires ${new Date(current.expires_at).toLocaleString()}.`);
      return;
    }
    if (config.amos.apiKey && config.auth.mode !== "oauth") {
      console.log(`Connected to ${config.amos.mcpUrl} with AMOS_API_KEY.`);
      return;
    }
    if (!credentials) {
      console.log("Not connected. Run `amos-agent login`.");
      process.exitCode = 1;
      return;
    }
    console.log("OAuth is required by AMOS_AGENT_AUTH_MODE. Run `amos-agent login`.");
    process.exitCode = 1;
    return;
  }

  const missing = validateConfig(config);
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    console.error("See .env.example for setup.");
    process.exitCode = 1;
    return;
  }
  const oauthCredentials = await oauth.status();
  const useOAuth = shouldUseOAuth(config, oauthCredentials);
  if (!useOAuth && (!config.amos.apiKey || config.auth.mode === "oauth")) {
    console.error("AMOS is not connected. Run `amos-agent login` first.");
    process.exitCode = 1;
    return;
  }

  if (args.once) {
    const approvals = new ConsoleApprovals({ enabled: true });
    const { loop } = createRuntime(config, approvals, oauth, useOAuth);
    const answer = await loop.run(args.once, { onEvent: printEvent });
    console.log(`\n${answer}`);
    approvals.close();
    return;
  }

  console.log("AMOS Agent local. Type /help for commands, /quit to exit.");
  console.log(`Workspace: ${config.safety.workspaceRoot}`);
  console.log(`Intelligence: ${config.model.displayName} · ${config.model.model}`);

  const rl = readline.createInterface({ input, output });
  const approvals = new ConsoleApprovals({ enabled: true, question: (prompt) => question(rl, prompt) });
  const { registry, loop } = createRuntime(config, approvals, oauth, useOAuth);
  try {
    while (true) {
      const prompt = await question(rl, "\namos> ");
      const trimmed = prompt.trim();
      if (!trimmed) continue;
      if (trimmed === "/quit" || trimmed === "/exit") break;
      if (trimmed === "/help") {
        console.log("/tools lists tools, /clear resets context, /quit exits.");
        continue;
      }
      if (trimmed === "/tools") {
        console.table(registry.list());
        continue;
      }
      if (trimmed === "/clear") {
        loop.clear();
        console.log("Context cleared.");
        continue;
      }

      const answer = await loop.run(trimmed, { onEvent: printEvent });
      console.log(`\n${answer}`);
    }
  } finally {
    rl.close();
    approvals.close();
  }
}

function createRuntime(config, approvals, oauth, useOAuth) {
  return createAgentRuntime({ config, approvals, oauth, useOAuth });
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}
