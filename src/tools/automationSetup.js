export function createAutomationSetupTool({ begin }) {
  if (typeof begin !== "function") {
    throw new Error("Automation setup tool requires a begin handler");
  }
  return {
    name: "desktop_begin_automation_setup",
    source: "desktop",
    description:
      "Open the AMOS Automation review surface only after establishing the user's desired outcome, trigger, source system, and destination system conversationally. Pass those facts explicitly. For a source-to-destination integration, prefer the Platform's cross_system_event_sync template. Desktop will match live connections and report any missing typed destination operation so you can resolve that boundary in chat; do not make the user discover requirements by browsing a generic wizard.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["intent"],
      properties: {
        intent: {
          type: "string",
          minLength: 1,
          maxLength: 2_000,
          description: "The user's requested business outcome in their own language."
        },
        template_key: {
          type: "string",
          maxLength: 120,
          description: "Optional exact template key only when already returned by AMOS Platform."
        },
        source_provider: {
          type: "string",
          maxLength: 80,
          description: "Provider key or plain provider name for the system where the event/data originates."
        },
        destination_provider: {
          type: "string",
          maxLength: 80,
          description: "Provider key or plain provider name for the system AMOS should operate."
        },
        trigger_event: {
          type: "string",
          maxLength: 160,
          description: "Exact business or provider event already established in conversation, such as invoice.finalized."
        },
        operation_key: {
          type: "string",
          maxLength: 64,
          description: "Optional typed destination operation key when already established, such as create_invoice."
        }
      }
    },
    handler: async (args) => begin({
      intent: args.intent,
      templateKey: args.template_key || "",
      sourceProvider: args.source_provider || "",
      destinationProvider: args.destination_provider || "",
      triggerEvent: args.trigger_event || "",
      operationKey: args.operation_key || ""
    })
  };
}
