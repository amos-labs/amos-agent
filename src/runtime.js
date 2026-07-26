import { AgentLoop } from "./agentLoop.js";
import { createModelClient } from "./model/providers.js";
import { AmosMcpClient } from "./mcp/amosMcpClient.js";
import { createAmosTools } from "./tools/amos.js";
import { createBashTool } from "./tools/bash.js";
import { createCodingTools } from "./tools/coding.js";
import { createFileTools } from "./tools/files.js";
import { ToolRegistry } from "./tools/registry.js";
import { createWebTools } from "./tools/web.js";

export function createRegistry({
  extraTools = [],
  includeAmos = true,
  includeWeb = true
} = {}) {
  const registry = new ToolRegistry();
  registry.register(createBashTool());
  for (const tool of createCodingTools()) registry.register(tool);
  for (const tool of createFileTools()) registry.register(tool);
  if (includeWeb) {
    for (const tool of createWebTools()) registry.register(tool);
  }
  if (includeAmos) {
    for (const tool of createAmosTools()) registry.register(tool);
  }
  for (const tool of extraTools) registry.register(tool);
  return registry;
}

export function createRuntime({
  config,
  approvals,
  oauth = null,
  useOAuth = false,
  fetchImpl,
  extraTools = [],
  includeAmos = true,
  includeWeb = true,
  systemPrompt
}) {
  const registry = createRegistry({ extraTools, includeAmos, includeWeb });
  const modelConfig = {
    ...config.model,
    getAccessToken: config.model.usesAmosIdentity
      ? useOAuth
        ? (options) => oauth.getAccessToken(options)
        : async () => config.amos.apiKey || config.model.apiKey
      : null
  };
  const modelClient = createModelClient(modelConfig, fetchImpl);
  const amosClient = new AmosMcpClient(
    {
      url: config.amos.mcpUrl,
      apiKey: useOAuth ? "" : config.amos.apiKey,
      getAccessToken: useOAuth ? (options) => oauth.getAccessToken(options) : null,
      requestTimeoutMs: config.amos.requestTimeoutMs
    },
    fetchImpl
  );
  const loop = new AgentLoop({
    config,
    registry,
    approvals,
    modelClient,
    amosClient,
    systemPrompt
  });
  return { registry, loop, modelClient, amosClient };
}

export function shouldUseOAuth(config, credentials) {
  return config.auth.mode !== "api-key" && Boolean(credentials?.access_token);
}
