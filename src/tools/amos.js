import { extractMcpText, normalizeMcpToolResult } from "../mcp/amosMcpClient.js";
import { measureToolSurface, sanitizeToolName } from "./registry.js";
import { sanitizeModelContinuityCapture } from "./consultativeState.js";

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
        const result = await context.amosClient.callTool(
          "load_engine_tools",
          { engine: args.engine },
          { signal: context.signal }
        );
        const normalized = normalizeMcpToolResult(result);
        if (normalized.ok === false) return normalized;
        const schemas = extractToolSchemas(result);
        const limits = dynamicEngineLimits(context.config);
        const surface = measureToolSurface(schemas.map(asOpenAiSchema));
        if (schemas.length > limits.maxTools) {
          return {
            ok: false,
            error: `AMOS engine ${args.engine} returned ${schemas.length} tools; the per-engine limit is ${limits.maxTools}.`
          };
        }
        if (surface.schemaBytes > limits.maxSchemaBytes) {
          return {
            ok: false,
            error: `AMOS engine ${args.engine} returned ${surface.schemaBytes} schema bytes; the per-engine limit is ${limits.maxSchemaBytes}.`
          };
        }
        const registered = [];

        for (const schema of schemas) {
          const originalName = schema.name || schema.function?.name;
          if (!originalName) continue;
          const localName = sanitizeToolName(`amos_${args.engine}_${originalName}`);
          const wasRegistered = context.registry.register({
            name: localName,
            source: `amos:${args.engine}`,
            toolkit: `amos-engine:${args.engine}`,
            remoteName: originalName,
            description: schema.description || schema.function?.description || `Call AMOS ${args.engine}.${originalName}.`,
            parameters: schema.inputSchema || schema.parameters || schema.function?.parameters || {
              type: "object",
              properties: {},
              additionalProperties: true
            },
            async handler(toolArgs, innerContext) {
              const remoteResult = await innerContext.amosClient.callTool(
                "call_engine_tool",
                {
                  engine: args.engine,
                  tool: originalName,
                  arguments: originalName === "capture_context"
                    ? sanitizeModelContinuityCapture(toolArgs)
                    : toolArgs
                },
                { signal: innerContext.signal }
              );
              return normalizeMcpToolResult(remoteResult);
            }
          });
          if (wasRegistered) registered.push(localName);
        }

        const engineToolkit = `amos-engine:${args.engine}`;
        const activation = context.registry.activateToolkit(engineToolkit, {
          mode: "add",
          replacePrefix: "amos-engine:"
        });
        if (activation.ok === false) {
          if (!context.registry.isToolkitActive(engineToolkit)) {
            context.registry.unregisterWhere((tool) => tool.toolkit === engineToolkit);
          }
          return activation;
        }
        const removedPriorEngineTools = context.registry.unregisterWhere((tool) =>
          tool.toolkit.startsWith("amos-engine:") && tool.toolkit !== engineToolkit
        );

        return {
          ok: true,
          engine: args.engine,
          tool_count: schemas.length,
          schema_bytes: surface.schemaBytes,
          registered_dynamic_tools: registered,
          already_available_tools: schemas.length - registered.length,
          active_toolkits: activation.active_toolkits,
          deactivated_toolkits: activation.deactivated_toolkits,
          removed_prior_engine_tools: removedPriorEngineTools
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
        const result = await context.amosClient.callTool(
          "call_engine_tool",
          {
            engine: args.engine,
            tool: args.tool,
            arguments: args.tool === "capture_context"
              ? sanitizeModelContinuityCapture(args.arguments || {})
              : args.arguments || {}
          },
          { signal: context.signal }
        );
        return normalizeMcpToolResult(result);
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
      const result = await context.amosClient.callTool(
        remoteName,
        args,
        { signal: context.signal }
      );
      return normalizeMcpToolResult(result);
    }
  };
}

function dynamicEngineLimits(config = {}) {
  return {
    maxTools: boundedPositiveInteger(config?.agent?.maxDynamicEngineTools, 64),
    maxSchemaBytes: boundedPositiveInteger(config?.agent?.maxDynamicEngineSchemaBytes, 131_072)
  };
}

function boundedPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function asOpenAiSchema(schema) {
  return {
    type: "function",
    function: {
      name: schema.name || schema.function?.name || "",
      description: schema.description || schema.function?.description || "",
      parameters: schema.inputSchema || schema.parameters || schema.function?.parameters || {
        type: "object",
        properties: {},
        additionalProperties: true
      }
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
