export function sanitizeToolName(name) {
  return String(name)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
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

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool.name || typeof tool.handler !== "function") {
      throw new Error("Tool must include name and handler");
    }
    this.tools.set(tool.name, {
      ...tool,
      definition: tool.definition || asOpenAiTool(tool)
    });
  }

  list() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      source: tool.source || "local"
    }));
  }

  openAiTools() {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async execute(name, args, context) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return tool.handler(args || {}, context);
  }
}
