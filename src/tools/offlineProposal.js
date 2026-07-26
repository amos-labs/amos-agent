export function createOfflineProposalTool({ stage }) {
  if (typeof stage !== "function") {
    throw new Error("Offline-proposal tool requires a local staging function");
  }
  return {
    name: "desktop_stage_offline_proposal",
    source: "desktop",
    description:
      "Save a company-work draft locally for explicit review after reconnecting. This does not contact AMOS, queue a command, preserve tool arguments, authorize an action, or execute anything. Use it only after drafting a concrete outcome against the available signed company briefing.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "objective", "summary", "proposed_actions"],
      properties: {
        title: {
          type: "string",
          maxLength: 160,
          description: "A short business-readable name for the offline draft."
        },
        objective: {
          type: "string",
          maxLength: 1200,
          description: "The business outcome the user wants, without tool IDs or stale arguments."
        },
        summary: {
          type: "string",
          maxLength: 5000,
          description: "What was reasoned or prepared offline and why."
        },
        proposed_actions: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: { type: "string", maxLength: 600 },
          description:
            "Human-readable proposed outcomes. Never include credentials, opaque record IDs, or replayable tool arguments."
        },
        assumptions: {
          type: "array",
          maxItems: 12,
          items: { type: "string", maxLength: 600 },
          description: "Facts that must be checked against live AMOS before continuing."
        }
      }
    },
    handler: async (input = {}) => {
      const proposal = await stage({
        title: input.title,
        objective: input.objective,
        summary: input.summary,
        proposedActions: input.proposed_actions,
        assumptions: input.assumptions
      });
      return {
        status: "saved_locally",
        proposal_id: proposal.id,
        title: proposal.title,
        tenant_slug: proposal.source.tenantSlug,
        observed_at: proposal.source.observedAt,
        next_step:
          "Reconnect, open Decisions, compare this draft with the live company, then explicitly continue it in Operator. Nothing has been sent to AMOS."
      };
    }
  };
}
