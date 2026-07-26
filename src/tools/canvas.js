export function createCanvasTool({ present }) {
  if (typeof present !== "function") throw new Error("Canvas tool requires a present handler");
  return {
    name: "desktop_present_canvas",
    source: "desktop",
    description:
      "Present a safe typed canvas when business data is materially clearer as metrics, a table, a time series, a brief, evidence, or a governed decision. Never invent data.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["version", "title", "source", "blocks"],
      properties: {
        version: { type: "string", enum: ["1"] },
        title: { type: "string" },
        subtitle: { type: "string" },
        generated_at: { type: "string", description: "ISO-8601 timestamp" },
        source: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "label", "refreshed_at", "references"],
          properties: {
            kind: { type: "string", enum: ["live", "cached", "private", "local"] },
            label: { type: "string" },
            refreshed_at: { type: "string" },
            stale_after: { type: "string" },
            refresh_prompt: { type: "string" },
            references: {
              type: "array",
              maxItems: 100,
              items: referenceSchema()
            }
          }
        },
        blocks: {
          type: "array",
          minItems: 1,
          maxItems: 24,
          items: blockSchema()
        }
      }
    },
    handler: async (args) => {
      const canvas = await present(args);
      return {
        ok: true,
        canvas_id: canvas.id,
        title: canvas.title,
        block_count: canvas.blocks.length
      };
    }
  };
}

function referenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["label"],
    properties: {
      type: { type: "string" },
      id: { type: "string" },
      label: { type: "string" },
      observed_at: { type: "string" }
    }
  };
}

function blockSchema() {
  return {
    type: "object",
    description:
      "Fields depend on type: metric uses label/value; table uses columns/rows; timeseries uses series; markdown uses content; sources uses items; decision uses kind/status/summary.",
    additionalProperties: false,
    required: ["type"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      type: {
        type: "string",
        enum: ["metric", "table", "timeseries", "markdown", "sources", "decision"]
      },
      label: { type: "string" },
      value: {},
      unit: { type: "string" },
      change: { type: "string" },
      trend: { type: "string", enum: ["up", "down", "neutral"] },
      note: { type: "string" },
      searchable: { type: "boolean" },
      columns: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label"],
          properties: {
            key: { type: "string" },
            label: { type: "string" },
            format: {
              type: "string",
              enum: ["text", "number", "currency", "percent", "date", "datetime"]
            }
          }
        }
      },
      rows: {
        type: "array",
        maxItems: 200,
        items: { type: "object" }
      },
      x_label: { type: "string" },
      y_label: { type: "string" },
      series: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "points"],
          properties: {
            name: { type: "string" },
            points: {
              type: "array",
              maxItems: 300,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["x", "y"],
                properties: {
                  x: { type: "string" },
                  y: { type: "number" }
                }
              }
            }
          }
        }
      },
      content: { type: "string" },
      items: {
        type: "array",
        maxItems: 100,
        items: referenceSchema()
      },
      kind: { type: "string", enum: ["approval", "receipt"] },
      status: {
        type: "string",
        enum: ["pending", "approved", "denied", "executed", "failed", "expired", "attention"]
      },
      summary: { type: "string" },
      pending_id: { type: "string" },
      receipt_id: { type: "string" },
      details: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "value"],
          properties: {
            label: { type: "string" },
            value: {}
          }
        }
      }
    }
  };
}
