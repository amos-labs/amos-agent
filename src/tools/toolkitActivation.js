import { toolkitDefinition } from "./toolkitCatalog.js";

export function createToolkitActivationTool(toolkits = []) {
  const choices = toolkits
    .filter((toolkit) => toolkitDefinition(toolkit)?.selectable !== false)
    .sort();
  const descriptions = choices.map((toolkit) => {
    const definition = toolkitDefinition(toolkit);
    return `${toolkit}: ${definition?.description || "Specialized tools."}`;
  });
  return {
    name: "desktop_activate_toolkit",
    source: "desktop",
    toolkit: "core",
    description: [
      "Activate the smallest specialized Desktop toolkit needed for the current task.",
      "Call this instead of guessing that a specialized tool is unavailable.",
      ...descriptions
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        toolkit: {
          type: "string",
          enum: choices,
          description: "The specialized toolkit to make available on the next model turn."
        },
        mode: {
          type: "string",
          enum: ["add", "replace"],
          description: "Add to the current working set, or replace other selectable toolkits to reclaim context."
        }
      },
      required: ["toolkit"],
      additionalProperties: false
    },
    handler(args, context) {
      return context.registry.activateToolkit(args.toolkit, { mode: args.mode || "add" });
    }
  };
}
