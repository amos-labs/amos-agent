import { digestJson } from "./capabilityContract.js";
import { SYSTEM_PROMPT } from "../prompts.js";
import { createRegistry } from "../runtime.js";
import { createWorkSurfaceRequestTool } from "../tools/canvas.js";

export function createQualificationRegistry() {
  return createRegistry({
    extraTools: [createWorkSurfaceRequestTool()],
    toolSurface: {
      progressive: true,
      maxActiveTools: 96,
      maxActiveSchemaBytes: 131_072,
      maxActiveToolkits: 4
    }
  });
}

export function currentProductionToolSchemaVersion() {
  const registry = createQualificationRegistry();
  return `sha256:${digestJson({
    systemPrompt: SYSTEM_PROMPT,
    bootstrapTools: registry.openAiTools({ activeOnly: true }),
    catalogTools: registry.openAiTools()
  })}`;
}
