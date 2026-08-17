export function createDecisionInputTool() {
  return {
    name: "desktop_request_decision",
    source: "desktop",
    description:
      "Park one consequential question in Decisions so the user can answer it. Use this only when the answer could change the diagnosis, recommendation, authority boundary, execution plan, or success measure, and only after checking company context, documents, and prior decisions. This is the human-input method—do not invent a questionnaire, a second waiting UI, or a new approval type. Never use it for facts you can discover or for surveys.",
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
    async handler(args = {}, context = {}) {
      const question = String(args.question || "").trim();
      if (!question) {
        return { ok: false, parked: false, error: "A question is required." };
      }
      const approvals = context.approvals;
      if (typeof approvals?.ask !== "function") {
        return {
          ok: false,
          parked: false,
          error:
            "Decision input is available in AMOS Desktop Decisions. Ask the question in the conversation instead."
        };
      }
      const result = await approvals.ask(question, {
        title: args.title,
        context: args.context,
        options: args.options
      });
      if (!result?.answered) {
        return {
          ok: false,
          parked: true,
          answered: false,
          error: "The user did not answer this decision."
        };
      }
      return {
        ok: true,
        parked: true,
        answered: true,
        answer: String(result.answer || "").trim().slice(0, 8_000)
      };
    }
  };
}
