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
    {
      name: "amos_resolve_capabilities",
      source: "amos",
      toolkit: "core",
      description: "Resolve a concrete business outcome once into a small, exact, expiring AMOS capability manifest. Prefer this over listing and loading engine catalogs; discovery grants no authority.",
      parameters: {
        type: "object",
        properties: {
          outcome: { type: "string", description: "What the user wants accomplished, in ordinary business language." },
          limit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
          ttl_seconds: { type: "integer", minimum: 60, maximum: 86400, default: 3600 }
        },
        required: ["outcome"],
        additionalProperties: false
      },
      async handler(args, context) {
        const result = await context.amosClient.callTool(
          "resolve_capabilities",
          {
            outcome: args.outcome,
            limit: args.limit,
            ttl_seconds: args.ttl_seconds,
            include_input_schemas: true
          },
          { signal: context.signal }
        );
        const normalized = normalizeMcpToolResult(result);
        if (normalized.ok === false) return normalized;
        const operations = Array.isArray(normalized.operations) ? normalized.operations : [];
        const manifestId = String(normalized.manifest_id || "");
        if (!manifestId || operations.length === 0) {
          return {
            ok: true,
            manifest_id: manifestId || null,
            operation_count: operations.length,
            available_capabilities: [],
            next_step: normalized.next_step || "No matching caller-available capability was found."
          };
        }
        const schemas = operations.map((operation) => ({
          name: sanitizeToolName(`amos_capability_${operation.operation}`),
          description: operation.description || `Execute AMOS ${operation.operation} from the pinned capability manifest.`,
          inputSchema: operation.input_schema || {
            type: "object",
            properties: {},
            additionalProperties: true
          }
        }));
        const limits = dynamicEngineLimits(context.config);
        const surface = measureToolSurface(schemas.map(asOpenAiSchema));
        if (schemas.length > limits.maxTools || surface.schemaBytes > limits.maxSchemaBytes) {
          return {
            ok: false,
            error: `The resolved capability manifest exceeds Desktop's active tool budget (${schemas.length} tools, ${surface.schemaBytes} schema bytes). Resolve a narrower outcome.`
          };
        }
        context.registry.unregisterWhere((tool) => tool.toolkit?.startsWith("amos-capability:"));
        const toolkit = `amos-capability:${manifestId}`;
        const registered = [];
        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index];
          const schema = schemas[index];
          const localName = schema.name;
          const wasRegistered = context.registry.register({
            name: localName,
            source: "amos:capability",
            toolkit,
            remoteName: operation.operation,
            description: schema.description,
            parameters: schema.inputSchema,
            readOnly: operation.effect === "read",
            parallelSafe: operation.effect === "read",
            async handler(toolArgs, innerContext) {
              const remoteResult = await innerContext.amosClient.callTool(
                "execute_capability",
                {
                  manifest_id: manifestId,
                  operation: operation.operation,
                  arguments: toolArgs || {}
                },
                { signal: innerContext.signal }
              );
              return normalizeMcpToolResult(remoteResult);
            }
          });
          if (wasRegistered) registered.push(localName);
        }
        const activation = context.registry.activateToolkit(toolkit, {
          mode: "add",
          replacePrefix: "amos-capability:",
          evictPrefix: "amos-engine:"
        });
        if (activation.ok === false) {
          context.registry.unregisterWhere((tool) => tool.toolkit === toolkit);
          return activation;
        }
        return {
          ok: true,
          manifest_id: manifestId,
          manifest_sha256: normalized.manifest_sha256,
          expires_at: normalized.expires_at,
          operation_count: operations.length,
          registered_dynamic_tools: registered,
          available_capabilities: operations.map((operation, index) => ({
            tool: schemas[index].name,
            operation: operation.operation,
            effect: operation.effect,
            description: operation.description
          })),
          authority: normalized.authority,
          next_step: "Use the single best matching registered capability. Do not resolve or reload catalogs again unless the outcome changes or this manifest expires."
        };
      }
    },
    {
      ...mcpTool(
        "amos_execute_capability",
        "Compatibility gateway for executing one exact operation from a manifest returned by amos_resolve_capabilities. Prefer the dynamically registered typed capability tool when available.",
        "execute_capability",
        {
          type: "object",
          properties: {
            manifest_id: { type: "string", description: "Manifest UUID returned by amos_resolve_capabilities." },
            operation: { type: "string", description: "Exact operation from that manifest." },
            arguments: { type: "object", description: "Arguments matching the pinned operation schema." }
          },
          required: ["manifest_id", "operation", "arguments"],
          additionalProperties: false
        }
      ),
      toolkit: "core"
    },
    mcpTool("amos_list_engines", "List available AMOS engines filtered by scope and plan.", "list_engines"),
    {
      name: "amos_load_engine_tools",
      source: "amos",
      description: "Load one AMOS engine's exact permitted tool schemas. If list_engines advertises multiple toolkits, pass the smallest relevant toolkit; Desktop then registers only those wrappers.",
      parameters: {
        type: "object",
        properties: {
          engine: { type: "string", description: "Engine name, such as company, finance, marketing, connections, repo, governance, core." },
          toolkit: { type: "string", description: "Optional toolkit name advertised by amos_list_engines. Required when that engine says requires_toolkit=true." }
        },
        required: ["engine"],
        additionalProperties: false
      },
      async handler(args, context) {
        const loadArgs = { engine: args.engine };
        if (typeof args.toolkit === "string" && args.toolkit.trim()) {
          loadArgs.toolkit = args.toolkit.trim();
        }
        const result = await context.amosClient.callTool(
          "load_engine_tools",
          loadArgs,
          { signal: context.signal }
        );
        const normalized = normalizeMcpToolResult(result);
        if (normalized.ok === false) return normalized;
        const schemas = extractToolSchemas(normalized);
        if (normalized.requires_toolkit === true) {
          return {
            ok: true,
            engine: args.engine,
            requires_toolkit: true,
            available_toolkits: compactToolkitMenu(normalized.toolkits),
            engine_tool_count: normalized.engine_tool_count,
            note: normalized.note || "Choose the smallest relevant toolkit and load this engine again."
          };
        }
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
        const toolkitSuffix = loadArgs.toolkit ? `:${loadArgs.toolkit}` : "";
        const engineToolkit = `amos-engine:${args.engine}${toolkitSuffix}`;

        for (const schema of schemas) {
          const originalName = schema.name || schema.function?.name;
          if (!originalName) continue;
          const localName = sanitizeToolName(`amos_${args.engine}_${originalName}`);
          const wasRegistered = context.registry.register({
            name: localName,
            source: `amos:${args.engine}`,
            toolkit: engineToolkit,
            remoteName: originalName,
            description: schema.description || schema.function?.description || `Call AMOS ${args.engine}.${originalName}.`,
            parameters: schema.inputSchema || schema.parameters || schema.function?.parameters || {
              type: "object",
              properties: {},
              additionalProperties: true
            },
            readOnly: schema.annotations?.readOnlyHint === true || schema.readOnlyHint === true,
            parallelSafe: schema.annotations?.readOnlyHint === true || schema.readOnlyHint === true,
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

        const activation = context.registry.activateToolkit(engineToolkit, {
          mode: "add",
          evictPrefix: "amos-engine:"
        });
        if (activation.ok === false) {
          if (!context.registry.isToolkitActive(engineToolkit)) {
            context.registry.unregisterWhere((tool) => tool.toolkit === engineToolkit);
          }
          return activation;
        }
        const deactivatedEngineToolkits = new Set(
          activation.deactivated_toolkits.filter((toolkit) => toolkit.startsWith("amos-engine:"))
        );
        const removedPriorEngineTools = context.registry.unregisterWhere((tool) =>
          deactivatedEngineToolkits.has(tool.toolkit)
        );

        return {
          ok: true,
          engine: args.engine,
          toolkit: loadArgs.toolkit || null,
          requires_toolkit: false,
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

function compactToolkitMenu(toolkits) {
  if (!Array.isArray(toolkits)) return [];
  return toolkits
    .filter((toolkit) => toolkit?.unlocked !== false && typeof toolkit?.name === "string")
    .map((toolkit) => ({
      name: toolkit.name,
      available_tools: Number(toolkit.available_tools || 0)
    }));
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
