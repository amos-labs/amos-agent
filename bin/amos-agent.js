#!/usr/bin/env node
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, validateConfig } from "../src/config.js";
import { KimiClient } from "../src/model/kimiClient.js";
import { AmosMcpClient } from "../src/mcp/amosMcpClient.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createBashTool } from "../src/tools/bash.js";
import { createFileTools } from "../src/tools/files.js";
import { createWebTools } from "../src/tools/web.js";
import { createAmosTools } from "../src/tools/amos.js";
import { ConsoleApprovals } from "../src/util/approval.js";
import { AgentLoop } from "../src/agentLoop.js";
import { FileTokenStore } from "../src/auth/tokenStore.js";
import { AmosOAuthSession } from "../src/auth/oauth.js";

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

Required env:
  MOONSHOT_API_KEY                    Kimi / Moonshot API key

Optional env:
  AMOS_MCP_URL                        Default: https://app.amoslabs.com/mcp
  AMOS_API_KEY                        API key override for CI/unattended agents
  KIMI_MODEL                          Default: kimi-k3
  BRAVE_SEARCH_API_KEY                Enables native web_search
  AMOS_AGENT_AUTO_APPROVE_BASH=true   Disable bash prompts
`);
}

function createRegistry() {
  const registry = new ToolRegistry();
  registry.register(createBashTool());
  for (const tool of createFileTools()) registry.register(tool);
  for (const tool of createWebTools()) registry.register(tool);
  for (const tool of createAmosTools()) registry.register(tool);
  return registry;
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
    if (config.amos.apiKey) {
      console.log(`Connected to ${config.amos.mcpUrl} with AMOS_API_KEY.`);
      return;
    }
    const credentials = await oauth.status();
    if (!credentials) {
      console.log("Not connected. Run `amos-agent login`.");
      process.exitCode = 1;
      return;
    }
    await oauth.getAccessToken();
    const current = await oauth.status();
    console.log(`Connected to ${config.amos.mcpUrl} with OAuth.`);
    console.log(`Access expires ${new Date(current.expires_at).toLocaleString()}.`);
    return;
  }

  const missing = validateConfig(config);
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    console.error("See .env.example for setup.");
    process.exitCode = 1;
    return;
  }
  if (!config.amos.apiKey && !(await oauth.status())) {
    console.error("AMOS is not connected. Run `amos-agent login` first.");
    process.exitCode = 1;
    return;
  }

  if (args.once) {
    const approvals = new ConsoleApprovals({ enabled: true });
    const { loop } = createRuntime(config, approvals, oauth);
    const answer = await loop.run(args.once, { onEvent: printEvent });
    console.log(`\n${answer}`);
    approvals.close();
    return;
  }

  console.log("AMOS Agent local. Type /help for commands, /quit to exit.");
  console.log(`Workspace: ${config.safety.workspaceRoot}`);

  const rl = readline.createInterface({ input, output });
  const approvals = new ConsoleApprovals({ enabled: true, question: (prompt) => question(rl, prompt) });
  const { registry, loop } = createRuntime(config, approvals, oauth);
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

function createRuntime(config, approvals, oauth) {
  const registry = createRegistry();
  const loop = new AgentLoop({
    config,
    registry,
    approvals,
    kimiClient: new KimiClient(config.kimi),
    amosClient: new AmosMcpClient({
      url: config.amos.mcpUrl,
      apiKey: config.amos.apiKey,
      getAccessToken: config.amos.apiKey ? null : (options) => oauth.getAccessToken(options),
      requestTimeoutMs: config.amos.requestTimeoutMs
    })
  });
  return { registry, loop };
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
