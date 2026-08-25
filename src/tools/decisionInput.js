export function createDecisionInputTool() {
  return {
    name: "desktop_request_decision",
    source: "desktop",
    description:
      "Do not use this to ask what the user wants, which project they mean, or how to continue. Write those questions in the conversation and wait for the next user message. This tool is not the human-input method for chat.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: {
          type: "string",
          maxLength: 2_000,
          description: "The single highest-value question the user needs to answer."
        },
        title: {
          type: "string",
          maxLength: 160,
          description: "A short Decisions heading. Defaults to a generic input request."
        },
        context: {
          type: "string",
          maxLength: 2_000,
          description: "Why this answer matters and what you already know. No credentials or replayable tool arguments."
        },
        options: {
          type: "array",
          maxItems: 8,
          items: { type: "string", maxLength: 200 },
          description: "Optional suggested answers. The user may still type a free-text answer."
        }
      }
    },
    async handler(args = {}) {
      const question = String(args.question || "").trim();
      if (!question) {
        return { ok: false, parked: false, error: "A question is required." };
      }
      return {
        ok: false,
        parked: false,
        ask_in_conversation: true,
        question,
        error:
          "Ask this question in the conversation and wait for the user's next message. Do not park clarifying questions as a form."
      };
    }
  };
}
