import { attachModelEvidence } from "../model/evidence.js";

const SESSION_ID = { type: "string", minLength: 8, maxLength: 128 };
const FRAME_ID = { type: "string", minLength: 8, maxLength: 128 };

export function createBrowserVisualTools({ browser, scope, present = null } = {}) {
  if (!browser || typeof scope !== "function") {
    throw new Error("Visual browser tools require a task-bound browser runtime");
  }
  return [
    {
      name: "browser_visual_observe",
      source: "desktop-local",
      description:
        "Use only when current semantic browser references cannot express the authorized target. Capture one editable-value-masked image of the isolated task browser for a vision-capable model. Authentication and sensitive fields are blocked. The returned frame ID, hash, geometry, and coordinates expire on any change.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["session_id", "target_description"],
        properties: {
          session_id: SESSION_ID,
          target_description: { type: "string", minLength: 1, maxLength: 300 }
        }
      },
      handler: async (args, context) => {
        if (context.config?.model?.capabilities?.vision !== true) {
          throw new Error("The selected intelligence provider is not qualified for visual browser fallback");
        }
        const result = await browser.visualObserve(scope(), {
          sessionId: args.session_id,
          targetDescription: args.target_description,
          signal: context.signal
        });
        const canvas = typeof present === "function"
          ? await present({ operation: "visual_observe", ...result })
          : null;
        return withFrameEvidence(browser, {
          ...result,
          ...(canvas?.id ? { canvas_id: canvas.id } : {})
        });
      }
    },
    {
      name: "browser_visual_act",
      source: "desktop-local",
      description:
        "Perform one bounded click, type, key, or scroll against an exact masked visual browser frame. Use only after browser_visual_observe and only when semantic references cannot express the target. Every non-scroll action pauses for exact human approval. Changed pixels, page revision, coordinates, target, or authentication state stop safely.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["session_id", "frame_id", "action", "target_description"],
        properties: {
          session_id: SESSION_ID,
          frame_id: FRAME_ID,
          action: { type: "string", enum: ["click", "type", "key", "scroll"] },
          target_description: { type: "string", minLength: 1, maxLength: 300 },
          x: { type: "integer", minimum: 0, maximum: 3_999 },
          y: { type: "integer", minimum: 0, maximum: 3_999 },
          text: { type: "string", minLength: 1, maxLength: 5_000 },
          replace: { type: "boolean" },
          key: {
            type: "string",
            enum: [
              "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape", "Tab",
              "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "Space"
            ]
          },
          delta_y: { type: "integer", minimum: -2_000, maximum: 2_000 },
          wait_ms: { type: "integer", minimum: 250, maximum: 5_000 }
        }
      },
      handler: async (args, context) => {
        if (context.config?.model?.capabilities?.vision !== true) {
          throw new Error("The selected intelligence provider is not qualified for visual browser fallback");
        }
        const currentScope = scope();
        const prepared = await browser.prepareVisualAction(currentScope, {
          sessionId: args.session_id,
          frameId: args.frame_id,
          action: args.action,
          targetDescription: args.target_description,
          x: args.x,
          y: args.y,
          text: args.text,
          replace: args.replace,
          key: args.key,
          deltaY: args.delta_y,
          signal: context.signal
        });
        const reviewCanvas = typeof present === "function"
          ? await present({ operation: "visual_action_review", ...prepared.observation })
          : null;
        if (prepared.takeover_required) {
          return {
            ok: false,
            status: "blocked",
            takeover_required: true,
            session_id: args.session_id,
            public_action: prepared.public_action,
            message: "This visual target is an authentication or sensitive surface. Ask the user to Take control.",
            ...(reviewCanvas?.id ? { canvas_id: reviewCanvas.id } : {})
          };
        }
        let approved = false;
        if (prepared.requires_approval) {
          approved = await context.approvals.confirm(
            visualApprovalMessage(prepared.public_action, args),
            { kind: "browser-action" }
          );
          if (!approved) {
            return {
              ok: false,
              status: "denied",
              denied: true,
              session_id: args.session_id,
              public_action: prepared.public_action,
              message: "User denied the exact frame-bound visual browser action.",
              ...(reviewCanvas?.id ? { canvas_id: reviewCanvas.id } : {})
            };
          }
        }
        const result = await browser.performVisualAction(currentScope, {
          plan: prepared.plan,
          approved,
          waitMs: args.wait_ms,
          signal: context.signal
        });
        const canvas = typeof present === "function"
          ? await present({ operation: `visual_${args.action}`, ...result })
          : null;
        return withFrameEvidence(browser, {
          ...result,
          ...(canvas?.id ? { canvas_id: canvas.id } : {})
        });
      }
    }
  ];
}

function withFrameEvidence(browser, result) {
  const frame = result?.frame;
  if (!frame?.frame_id) return result;
  const image = browser.readFrame(result.session_id, frame.frame_id);
  return attachModelEvidence(result, [{
    type: "image_url",
    image_url: {
      url: `data:${image.mime};base64,${image.base64}`,
      detail: "high"
    }
  }]);
}

function visualApprovalMessage(action, args) {
  const lines = [
    "AMOS proposes one visual browser action against an exact masked frame:",
    "",
    `Origin: ${action.origin}`,
    `Page revision: ${action.page_revision}`,
    `Frame: ${action.frame_id}`,
    `Frame SHA-256: ${action.frame_sha256}`,
    `Action: ${action.action}`,
    `Intended target: ${action.target_description}`,
    action.point ? `Coordinates: (${action.point.x}, ${action.point.y})` : "Coordinates: current focused control"
  ];
  if (args.action === "type") lines.push(`Text: ${JSON.stringify(String(args.text || "").slice(0, 500))}${String(args.text || "").length > 500 ? "…" : ""}`);
  if (args.action === "key") lines.push(`Key: ${args.key}`);
  lines.push(
    "",
    "Approval applies only to this page revision, exact frame hash, coordinates, target description, and payload. Any changed pixel stops execution."
  );
  return lines.join("\n");
}
