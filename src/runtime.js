import { AgentLoop } from "./agentLoop.js";
import { createModelClient } from "./model/providers.js";
import { isAmosDesktopRoutingConfig } from "./model/intelligenceRouter.js";
import { HybridRoutingClient } from "./model/hybridRouting.js";
import { AmosMcpClient } from "./mcp/amosMcpClient.js";
import { createAmosTools } from "./tools/amos.js";
import { createBashTool } from "./tools/bash.js";
import { createCodingTools } from "./tools/coding.js";
import { createFileTools } from "./tools/files.js";
import { createWorkspaceFocusTool } from "./util/workspaceFocus.js";
import { createArtifactTools } from "./tools/artifacts.js";
import { createSpreadsheetTools } from "./tools/spreadsheets.js";
import { createPresentationTools } from "./tools/presentations.js";
import { ToolRegistry } from "./tools/registry.js";
import { createToolkitActivationTool } from "./tools/toolkitActivation.js";
import { createWebTools } from "./tools/web.js";

export function createRegistry({
  extraTools = [],
  includeLocal = true,
  includeAmos = true,
  includeWeb = true,
  artifactPresenter = null,
  spreadsheetPresenter = null,
  presentationPresenter = null,
  toolSurface = {}
} = {}) {
  const registry = new ToolRegistry(toolSurface);
  if (includeLocal) {
    registry.register(createBashTool());
    registry.register(createWorkspaceFocusTool());
    for (const tool of createCodingTools()) registry.register(tool);
    for (const tool of createFileTools()) registry.register(tool);
    for (const tool of createArtifactTools({ present: artifactPresenter })) registry.register(tool);
    for (const tool of createSpreadsheetTools({ present: spreadsheetPresenter })) registry.register(tool);
    for (const tool of createPresentationTools({ present: presentationPresenter })) registry.register(tool);
  }
  if (includeWeb) {
    for (const tool of createWebTools()) registry.register(tool);
  }
  if (includeAmos) {
    for (const tool of createAmosTools()) registry.register(tool);
  }
  for (const tool of extraTools) registry.register(tool);
  registry.register(createToolkitActivationTool(registry.availableToolkits()));
  return registry;
}

export function createRuntime({
  config,
  approvals,
  oauth = null,
  useOAuth = false,
  fetchImpl,
  extraTools = [],
  includeLocal = true,
  includeAmos = true,
  includeWeb = true,
  artifactPresenter = null,
  spreadsheetPresenter = null,
  presentationPresenter = null,
  systemPrompt,
  onToolResult = null,
  intelligenceRouter = null,
  hybridRouting = null
}) {
  const registry = createRegistry({
    extraTools,
    includeLocal,
    includeAmos,
    includeWeb,
    artifactPresenter,
    spreadsheetPresenter,
    presentationPresenter,
    toolSurface: {
      progressive: config.agent?.progressiveTools !== false,
      maxActiveTools: config.agent?.maxActiveTools,
      maxActiveSchemaBytes: config.agent?.maxActiveSchemaBytes,
      maxActiveToolkits: config.agent?.maxActiveToolkits
    }
  });
  const modelConfig = {
    ...config.model,
    getAccessToken: config.model.usesAmosIdentity
      ? useOAuth
        ? (options) => oauth.getAccessToken(options)
        : async () => config.amos.apiKey || config.model.apiKey
      : null,
    intelligenceRouter: isAmosDesktopRoutingConfig(config.model)
      ? intelligenceRouter
      : null
  };
  const managedClient = createModelClient(modelConfig, fetchImpl);
  const modelClient = hybridRouting?.enabled
    ? new HybridRoutingClient({
        router: hybridRouting.router,
        policy: hybridRouting.policy,
        managed: {
          client: managedClient,
          provider: modelConfig.provider,
          model: modelConfig.model
        },
        local: hybridRouting.local,
        frontier: hybridRouting.frontier?.provider === modelConfig.provider
          ? {
              client: managedClient,
              provider: modelConfig.provider,
              model: modelConfig.model
            }
          : hybridRouting.frontier
      })
    : managedClient;
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
    systemPrompt,
    onToolResult
  });
  return { registry, loop, modelClient, amosClient };
}

export function shouldUseOAuth(config, credentials) {
  return config.auth.mode !== "api-key" && Boolean(credentials?.access_token);
}
