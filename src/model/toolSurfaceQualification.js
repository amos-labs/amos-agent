import { digestJson } from "./capabilityContract.js";
import { SYSTEM_PROMPT } from "../prompts.js";
import { createRegistry } from "../runtime.js";

export function createQualificationRegistry() {
  return createRegistry({
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
    tools: registry.openAiTools()
  })}`;
}
