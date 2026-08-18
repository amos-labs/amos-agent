import { Buffer } from "node:buffer";
import { inferToolToolkit, toolkitDefinition } from "./toolkitCatalog.js";

const MAX_GRAMMAR_ARRAY_BOUND = 100;

export function sanitizeToolName(name) {
  return String(name)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

export function measureToolSurface(definitions = []) {
  const tools = Array.isArray(definitions) ? definitions : [];
  const serialized = JSON.stringify(tools);
  const schemaBytes = Buffer.byteLength(serialized, "utf8");
  return {
    toolCount: tools.length,
    schemaBytes,
    estimatedSchemaTokens: Math.ceil(schemaBytes / 4)
  };
}

function asOpenAiTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.parameters || {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  };
}

function normalizeModelToolDefinition(value) {
  const normalized = normalizeModelSchema(value);
  const parameters = normalized?.type === "function"
    ? normalized.function?.parameters
    : null;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return normalized;
  }
  return {
    ...normalized,
    function: {
      ...normalized.function,
      parameters: normalizeObjectRootUnions(parameters)
    }
  };
}

function normalizeModelSchema(value) {
  if (Array.isArray(value)) return value.map(normalizeModelSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !(
      key === "maxItems" &&
      Number.isInteger(item) &&
      item > MAX_GRAMMAR_ARRAY_BOUND
    ))
    .map(([key, item]) => [key, normalizeModelSchema(item)]));
}

function normalizeObjectRootUnions(parameters) {
  if (parameters.type !== "object") return parameters;
  const normalized = { ...parameters };
  for (const keyword of ["anyOf", "oneOf"]) {
    if (!Array.isArray(normalized[keyword])) continue;
    normalized[keyword] = normalized[keyword].map((branch) => {
      if (!branch || typeof branch !== "object" || Array.isArray(branch) || branch.type) {
        return branch;
      }
      // A branch containing only `required` (or other object constraints) is
      // already intersected with the object root by JSON Schema. Some model
      // runtimes validate union branches independently, though, and reject the
      // entire tool unless every root branch explicitly declares object type.
      return { ...branch, type: "object" };
    });
  }
  return normalized;
}

export class ToolRegistry {
  constructor({
    progressive = false,
    maxActiveTools = 96,
    maxActiveSchemaBytes = 131_072,
    maxActiveToolkits = 4
  } = {}) {
    this.tools = new Map();
    this.progressive = progressive;
    this.activeToolkits = new Set(["core"]);
    this.maxActiveTools = positiveInteger(maxActiveTools, 96);
    this.maxActiveSchemaBytes = positiveInteger(maxActiveSchemaBytes, 131_072);
    this.maxActiveToolkits = positiveInteger(maxActiveToolkits, 4);
  }

  register(tool) {
    if (!tool.name || typeof tool.handler !== "function") {
      throw new Error("Tool must include name and handler");
    }
    const inferredToolkit = tool.toolkit || inferToolToolkit(tool);
    if (this.progressive && !inferredToolkit) {
      throw new Error(`Progressive tool must declare a toolkit: ${tool.name}`);
    }
    const registered = {
      ...tool,
      source: tool.source || "local",
      toolkit: inferredToolkit || "core",
      // Ollama 0.32 expands large maxItems values into grammar repetitions and
      // can fail before inference. Keep exact high-volume ceilings in the
      // deterministic handler/server while giving every model a compilable
      // schema. Small bounds remain useful and are preserved.
      definition: normalizeModelToolDefinition(tool.definition || asOpenAiTool(tool))
    };
    const existing = this.tools.get(tool.name);
    if (existing) {
      if (sameRegistration(existing, registered)) return false;
      throw new Error(
        `Tool name collision for ${tool.name}: ${existing.source} and ${registered.source}`
      );
    }
    this.tools.set(tool.name, registered);
    return true;
  }

  list() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      source: tool.source || "local",
      toolkit: tool.toolkit || "core"
    }));
  }

  openAiTools({ activeOnly = false } = {}) {
    return [...this.tools.values()]
      .filter((tool) => !activeOnly || !this.progressive || this.activeToolkits.has(tool.toolkit))
      .map((tool) => tool.definition);
  }

  availableToolkits() {
    return [...new Set([...this.tools.values()].map((tool) => tool.toolkit))]
      .filter((toolkit) => toolkit !== "core")
      .sort();
  }

  activateToolkit(toolkit, { mode = "add", replacePrefix = "" } = {}) {
    const requested = String(toolkit || "");
    if (!requested || !this.availableToolkits().includes(requested)) {
      return { ok: false, error: `Toolkit is not available in this workspace: ${requested || "unknown"}` };
    }
    const retained = mode === "replace"
      ? ["core"]
      : [...this.activeToolkits].filter((name) => !replacePrefix || !name.startsWith(replacePrefix));
    const next = new Set([...retained, requested]);
    const deactivated = [...this.activeToolkits].filter((name) => !next.has(name));
    const selectableCount = [...next].filter((name) => toolkitDefinition(name)?.selectable !== false && name !== "core").length;
    if (selectableCount > this.maxActiveToolkits) {
      return {
        ok: false,
        error: `The active toolkit limit is ${this.maxActiveToolkits}. Retry with mode replace or choose a smaller working set.`
      };
    }
    const definitions = [...this.tools.values()]
      .filter((tool) => next.has(tool.toolkit))
      .map((tool) => tool.definition);
    const surface = measureToolSurface(definitions);
    if (surface.toolCount > this.maxActiveTools || surface.schemaBytes > this.maxActiveSchemaBytes) {
      return {
        ok: false,
        error: [
          `Activating ${requested} would expose ${surface.toolCount} tools and ${surface.schemaBytes} schema bytes.`,
          `The limits are ${this.maxActiveTools} tools and ${this.maxActiveSchemaBytes} schema bytes.`,
          "Choose a narrower toolkit or retry with mode replace."
        ].join(" ")
      };
    }
    this.activeToolkits = next;
    return {
      ok: true,
      activated: requested,
      mode,
      active_toolkits: [...this.activeToolkits].sort(),
      deactivated_toolkits: deactivated.sort(),
      tool_count: surface.toolCount,
      schema_bytes: surface.schemaBytes
    };
  }

  isToolkitActive(toolkit) {
    return this.activeToolkits.has(toolkit);
  }

  hasActiveToolkitPrefix(prefix) {
    return [...this.activeToolkits].some((toolkit) => toolkit.startsWith(prefix));
  }

  surfaceMetrics(definitions = this.openAiTools()) {
    const metrics = measureToolSurface(definitions);
    const names = new Set(definitions.map((tool) => tool?.function?.name).filter(Boolean));
    const selected = [...this.tools.values()].filter((tool) => names.has(tool.name));
    return {
      ...metrics,
      registeredToolCount: this.tools.size,
      sources: [...new Set(selected.map((tool) => tool.source || "local"))].sort(),
      toolkits: [...new Set(selected.map((tool) => tool.toolkit || "core"))].sort()
    };
  }

  unregisterWhere(predicate) {
    let removed = 0;
    for (const [name, tool] of this.tools.entries()) {
      if (!predicate(tool)) continue;
      this.tools.delete(name);
      removed += 1;
    }
    return removed;
  }

  async execute(name, args, context) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return tool.handler(args || {}, context);
  }
}

function sameRegistration(existing, candidate) {
  return existing.source === candidate.source &&
    existing.toolkit === candidate.toolkit &&
    String(existing.remoteName || "") === String(candidate.remoteName || "") &&
    JSON.stringify(existing.definition) === JSON.stringify(candidate.definition);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
