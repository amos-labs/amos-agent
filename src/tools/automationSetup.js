export function createAutomationSetupTool({ begin }) {
  if (typeof begin !== "function") {
    throw new Error("Automation setup tool requires a begin handler");
  }
  return {
    name: "desktop_begin_automation_setup",
    source: "desktop",
    description:
      "Open the guided AMOS Automation work surface when the user asks to build an integration, scheduled workflow, event-driven sync, record-change workflow, performance scorecard, or operating automation. Pass the user's exact business intent. Desktop will use the live Platform template, connection, operation, mapping, trigger, preview, and activation contracts; do not replace that guided review with prose or hand-authored credentials.",
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
        }
      }
    },
    handler: async (args) => begin({
      intent: args.intent,
      templateKey: args.template_key || ""
    })
  };
}
