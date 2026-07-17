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

function parseArgs(argv) {
  const args = { once: "", cwd: process.cwd(), help: false };
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--once") args.once = argv[++i] || "";
    else if (arg === "--cwd") args.cwd = argv[++i] || process.cwd();
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
  amos-agent                         Start interactive local agent
  amos-agent --once "Do a thing"      Run one prompt
  amos-agent "Do a thing"             Run one prompt
  amos-agent --cwd ./repo             Set workspace root

Required env:
  MOONSHOT_API_KEY                    Kimi / Moonshot API key
  AMOS_API_KEY                        AMOS MCP API key

Optional env:
  AMOS_MCP_URL                        Default: https://app.amoslabs.com/mcp
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
  const missing = validateConfig(config);
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    console.error("See .env.example for setup.");
    process.exitCode = 1;
    return;
  }

  const approvals = new ConsoleApprovals({ enabled: true });
  const registry = createRegistry();
  const loop = new AgentLoop({
    config,
    registry,
    approvals,
    kimiClient: new KimiClient(config.kimi),
    amosClient: new AmosMcpClient(config.amos)
  });

  if (args.once) {
    const answer = await loop.run(args.once, { onEvent: printEvent });
    console.log(`\n${answer}`);
    approvals.close();
    return;
  }

  console.log("AMOS Agent local. Type /help for commands, /quit to exit.");
  console.log(`Workspace: ${config.safety.workspaceRoot}`);

  const rl = readline.createInterface({ input, output });
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}
