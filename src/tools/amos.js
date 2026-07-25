import { extractMcpText } from "../mcp/amosMcpClient.js";
import { sanitizeToolName } from "./registry.js";

export function createAmosTools() {
  return [
    mcpTool("amos_get_started", "Call AMOS get_started for operating instructions and available paths.", "get_started"),
    mcpTool("amos_whoami", "Call AMOS whoami for tenant, role, and scope context.", "whoami"),
    mcpTool(
      "amos_resume_company",
      "Restore the durable company brief, recent decisions, open work, goals, and recommended next actions for this session.",
      "resume_company",
      {
        type: "object",
        properties: {
          since: { type: "string", description: "Optional resume cursor from a prior session." }
        },
        additionalProperties: false
      }
    ),
    mcpTool(
      "amos_company_overview",
      "Call AMOS company_overview for deterministic company-brain session context.",
      "company_overview",
      {
        type: "object",
        properties: {
          since: { type: "string", description: "Optional resume cursor from a prior company_overview." }
        },
        additionalProperties: false
      }
    ),
    mcpTool("amos_list_engines", "List available AMOS engines filtered by scope and plan.", "list_engines"),
    {
      name: "amos_load_engine_tools",
      source: "amos",
      description: "Load one AMOS engine's exact permitted tool schemas, then register local wrappers for them.",
      parameters: {
        type: "object",
        properties: {
          engine: { type: "string", description: "Engine name, such as company, finance, marketing, connections, repo, governance, core." }
        },
        required: ["engine"],
        additionalProperties: false
      },
      async handler(args, context) {
        const result = await context.amosClient.callTool("load_engine_tools", { engine: args.engine });
        const schemas = extractToolSchemas(result);
        const registered = [];

        for (const schema of schemas) {
          const originalName = schema.name || schema.function?.name;
          if (!originalName) continue;
          const localName = sanitizeToolName(`amos_${args.engine}_${originalName}`);
          context.registry.register({
            name: localName,
            source: `amos:${args.engine}`,
            description: schema.description || schema.function?.description || `Call AMOS ${args.engine}.${originalName}.`,
            parameters: schema.inputSchema || schema.parameters || schema.function?.parameters || {
              type: "object",
              properties: {},
              additionalProperties: true
            },
            async handler(toolArgs, innerContext) {
              return innerContext.amosClient.callTool("call_engine_tool", {
                engine: args.engine,
                tool: originalName,
                arguments: toolArgs
              });
            }
          });
          registered.push(localName);
        }

        return {
          result,
          text: extractMcpText(result),
          registered_dynamic_tools: registered
        };
      }
    },
    {
      name: "amos_call_engine_tool",
      source: "amos",
      description: "Call an AMOS engine tool through the managed platform gateway.",
      parameters: {
        type: "object",
        properties: {
          engine: { type: "string", description: "Engine name." },
          tool: { type: "string", description: "Tool name inside the engine." },
          arguments: { type: "object", description: "Tool arguments." }
        },
        required: ["engine", "tool", "arguments"],
        additionalProperties: false
      },
      async handler(args, context) {
        return context.amosClient.callTool("call_engine_tool", {
          engine: args.engine,
          tool: args.tool,
          arguments: args.arguments || {}
        });
      }
    }
  ];
}

function mcpTool(name, description, remoteName, parameters = { type: "object", properties: {}, additionalProperties: false }) {
  return {
    name,
    source: "amos",
    description,
    parameters,
    async handler(args, context) {
      const result = await context.amosClient.callTool(remoteName, args);
      return {
        result,
        text: extractMcpText(result)
      };
    }
  };
}

export function extractToolSchemas(result) {
  const candidates = [];
  candidates.push(result);
  if (result?.tools) candidates.push(result.tools);
  if (result?.schemas) candidates.push(result.schemas);
  if (result?.tool_schemas) candidates.push(result.tool_schemas);

  const text = extractMcpText(result);
  if (text) {
    try {
      candidates.push(JSON.parse(text));
    } catch {
      // Not JSON; nothing to extract.
    }
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.tools)) return candidate.tools;
    if (Array.isArray(candidate?.schemas)) return candidate.schemas;
    if (Array.isArray(candidate?.tool_schemas)) return candidate.tool_schemas;
  }

  return [];
}
