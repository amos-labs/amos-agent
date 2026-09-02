// Every tool result enters the model transcript inside one delimited block so
// the model can tell tool-returned data (web pages, MCP payloads, command
// output, file contents) apart from instructions. A literal closing tag inside
// the payload is escaped so untrusted content cannot terminate the block early.

export const TOOL_RESULT_TAG = "tool_result";

const CLOSING_TAG = new RegExp(`</${TOOL_RESULT_TAG}`, "gi");
const ESCAPED_CLOSING_TAG = new RegExp(`&lt;/${TOOL_RESULT_TAG}`, "gi");
const ENVELOPE = new RegExp(
  `^<${TOOL_RESULT_TAG}\\b[^>]*>([\\s\\S]*)</${TOOL_RESULT_TAG}>$`
);

export function wrapToolResult(source, content, { trust = "untrusted" } = {}) {
  const body = typeof content === "string" ? content : JSON.stringify(content);
  const attributes = [
    `source="${attribute(source || "tool")}"`,
    `trust="${attribute(trust)}"`
  ].join(" ");
  return `<${TOOL_RESULT_TAG} ${attributes}>${escapeToolResultContent(body ?? "")}</${TOOL_RESULT_TAG}>`;
}

export function escapeToolResultContent(text) {
  return String(text ?? "").replace(CLOSING_TAG, `&lt;/${TOOL_RESULT_TAG}`);
}

export function isWrappedToolResult(content) {
  return typeof content === "string" && ENVELOPE.test(content);
}

// Returns the payload text with the envelope removed and the closing-tag escape
// reversed. Content that was never wrapped is returned unchanged.
export function unwrapToolResult(content) {
  if (typeof content !== "string") return content;
  const match = content.match(ENVELOPE);
  if (!match) return content;
  return match[1].replace(ESCAPED_CLOSING_TAG, `</${TOOL_RESULT_TAG}`);
}

// Parses the JSON payload of a (possibly wrapped) tool message. Returns
// `fallback` when the payload is not JSON.
export function parseToolResult(content, fallback = undefined) {
  try {
    return JSON.parse(unwrapToolResult(content));
  } catch {
    return fallback;
  }
}

function attribute(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .slice(0, 96);
}
