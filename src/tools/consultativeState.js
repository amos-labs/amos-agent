export function createConsultativeProposalTool({ propose }) {
  return {
    name: "desktop_propose_consultative_update",
    source: "desktop",
    description: "Propose consultative operating-state updates for the active Task. Assertions are stored as inferred only. Confirmation requires an explicit user control.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: ["active", "paused", "operating", "completed", "abandoned"]
        },
        objective: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            statement: { type: "string" },
            kind: { type: "string" },
            confidence: { type: "number" }
          }
        },
        assertions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
              statement: { type: "string" },
              confidence: { type: "number" }
            }
          }
        },
        recommendation: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            statement: { type: "string" },
            confidence: { type: "number" }
          }
        }
      }
    },
    async handler(args) {
      const record = await propose(args || {});
      return {
        proposed: true,
        confirmed: false,
        consultativeState: record?.consultativeState || null
      };
    }
  };
}

export function sanitizeModelContinuityCapture(args = {}) {
  const next = { ...(args && typeof args === "object" ? args : {}) };
  delete next.origin;
  delete next.capture_origin;
  if (next.consultative_state && typeof next.consultative_state === "object") {
    next.consultative_state = downgradeConfirmedTree(next.consultative_state);
  }
  if (next.consultativeState && typeof next.consultativeState === "object") {
    next.consultativeState = downgradeConfirmedTree(next.consultativeState);
  }
  return next;
}

function downgradeConfirmedTree(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(downgradeConfirmedTree);
  const next = { ...value };
  if (next.status === "confirmed") {
    next.status = "inferred";
    next.source = "inference";
    delete next.confirmedAt;
    delete next.confirmed_at;
  }
  for (const [key, child] of Object.entries(next)) {
    if (child && typeof child === "object") next[key] = downgradeConfirmedTree(child);
  }
  return next;
}
