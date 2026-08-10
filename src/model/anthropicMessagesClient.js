import {
  executeModelRequest,
  normalizedUsage,
  readJsonResponse,
  readSseEvents
} from "./protocol.js";

const PROTOCOL = "anthropic-messages";

export class AnthropicMessagesClient {
  constructor(config, fetchImpl) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async chat({ messages, tools = [], onDelta = null, signal = null }) {
    const apiKey = this.config.apiKey || (await this.config.getAccessToken?.());
    const translated = anthropicTranscript(messages);
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxCompletionTokens || 8_192,
      messages: translated.messages
    };
    if (translated.system) body.system = translated.system;
    if (
      this.config.reasoningEffort === "none" &&
      this.config.capabilities?.reasoning !== false
    ) {
      body.thinking = { type: "disabled" };
    } else if (this.config.reasoningEffort && this.config.capabilities?.reasoning !== false) {
      body.output_config = { effort: this.config.reasoningEffort };
    }
    if (tools.length > 0 && this.config.capabilities?.tools !== false) {
      body.tools = tools.map(anthropicTool);
    }
    if (typeof onDelta === "function") body.stream = true;

    return executeModelRequest({
      config: this.config,
      fetchImpl: this.fetch,
      path: "/messages",
      headers: {
        "x-api-key": this.config.authMode === "sigv4" ? null : apiKey,
        "anthropic-version": this.config.apiVersion || "2023-06-01",
        ...this.config.headers
      },
      body,
      signal,
      consume: async (response, context) => {
        if (typeof onDelta !== "function") {
          return normalizeAnthropicPayload(await readJsonResponse(response, context.displayName), context.displayName);
        }
        return readAnthropicStream(response, { ...context, onDelta });
      }
    });
  }
}

function anthropicTool(tool) {
  const definition = tool.function || tool;
  return {
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters || { type: "object", properties: {} },
    ...(definition.strict == null ? {} : { strict: definition.strict })
  };
}

function anthropicTranscript(messages = []) {
  const system = [];
  const translated = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = plainText(message.content);
      if (text) system.push(text);
      continue;
    }
    if (message.role === "tool") {
      appendAnthropicMessage(translated, "user", [{
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        ...(toolResultFailed(message.content) ? { is_error: true } : {})
      }]);
      continue;
    }
    if (message.role === "assistant" && message.provider_state?.protocol === PROTOCOL) {
      appendAnthropicMessage(
        translated,
        "assistant",
        structuredClone(message.provider_state.content || [])
      );
      continue;
    }
    const content = anthropicContent(message.content);
    if (message.role === "assistant") {
      for (const call of message.tool_calls || []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.function?.name || "",
          input: parseArguments(call.function?.arguments)
        });
      }
    }
    if (content.length > 0) appendAnthropicMessage(translated, message.role, content);
  }
  return { system: system.join("\n\n"), messages: translated };
}

function appendAnthropicMessage(messages, role, content) {
  const last = messages.at(-1);
  if (last?.role === role) {
    last.content.push(...content);
  } else {
    messages.push({ role, content });
  }
}

function anthropicContent(content) {
  if (content == null || content === "") return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: JSON.stringify(content) }];
  return content.flatMap((part) => {
    if (typeof part === "string") return [{ type: "text", text: part }];
    if (part?.type === "text") return [{ type: "text", text: part.text || "" }];
    if (part?.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (!url) return [];
      const match = url.match(/^data:([^;,]+);base64,(.+)$/s);
      return match
        ? [{ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }]
        : [{ type: "image", source: { type: "url", url } }];
    }
    if (["text", "image", "document"].includes(part?.type)) return [part];
    return [];
  });
}

function plainText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
}

function parseArguments(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return { _raw: value || "" };
  }
}

function toolResultFailed(content) {
  try {
    const payload = typeof content === "string" ? JSON.parse(content) : content;
    return payload?.ok === false || Boolean(payload?.error);
  } catch {
    return false;
  }
}

function normalizeAnthropicPayload(payload, displayName) {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const message = canonicalAnthropicMessage(content);
  if (!message.content && !message.tool_calls?.length) {
    throw new Error(`${displayName} response did not include content or tool calls`);
  }
  message.provider_state = { protocol: PROTOCOL, content: structuredClone(content) };
  return { message, usage: normalizedUsage(payload.usage), raw: payload };
}

function canonicalAnthropicMessage(content) {
  const text = [];
  const toolCalls = [];
  for (const block of content) {
    if (block?.type === "text" && block.text) text.push(block.text);
    if (block?.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name || "", arguments: JSON.stringify(block.input || {}) }
      });
    }
  }
  return {
    role: "assistant",
    content: text.join(""),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
  };
}

async function readAnthropicStream(response, { signal, displayName, onDelta }) {
  const blocks = new Map();
  let visibleText = "";
  let usage = null;
  let failure = null;
  const result = await readSseEvents(response, {
    signal,
    displayName,
    onEvent: ({ event, data }) => {
      if (!data) return;
      const type = data.type || event;
      if (type === "error") {
        failure = data.error?.message || `${displayName} streaming request failed`;
      } else if (type === "message_start") {
        usage = { ...(usage || {}), ...(data.message?.usage || {}) };
        for (const [index, block] of (data.message?.content || []).entries()) {
          blocks.set(index, structuredClone(block));
        }
      } else if (type === "content_block_start") {
        blocks.set(data.index, structuredClone(data.content_block || {}));
      } else if (type === "content_block_delta") {
        applyAnthropicDelta(blocks, data.index, data.delta || {}, (delta) => {
          visibleText += delta;
          onDelta(delta, visibleText);
        });
      } else if (type === "content_block_stop") {
        finishAnthropicBlock(blocks.get(data.index));
      } else if (type === "message_delta") {
        usage = { ...(usage || {}), ...(data.usage || {}) };
      }
    }
  });

  if (!result.streamed) {
    const normalized = normalizeAnthropicPayload(result.payload, displayName);
    if (normalized.message.content) onDelta(normalized.message.content, normalized.message.content);
    return normalized;
  }
  if (failure) throw new Error(failure);
  const content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => {
    finishAnthropicBlock(block);
    return block;
  });
  const normalized = normalizeAnthropicPayload({ content, usage }, displayName);
  normalized.raw = result.raw;
  return normalized;
}

function applyAnthropicDelta(blocks, index, delta, emitText) {
  const block = blocks.get(index) || {};
  if (delta.type === "text_delta") {
    block.type ||= "text";
    block.text = `${block.text || ""}${delta.text || ""}`;
    if (delta.text) emitText(delta.text);
  } else if (delta.type === "input_json_delta") {
    block.type ||= "tool_use";
    block._partialJson = `${block._partialJson || ""}${delta.partial_json || ""}`;
  } else if (delta.type === "thinking_delta") {
    block.type ||= "thinking";
    block.thinking = `${block.thinking || ""}${delta.thinking || ""}`;
  } else if (delta.type === "signature_delta") {
    block.signature = `${block.signature || ""}${delta.signature || ""}`;
  }
  blocks.set(index, block);
}

function finishAnthropicBlock(block) {
  if (!block || block._partialJson == null) return;
  try {
    block.input = JSON.parse(block._partialJson || "{}");
  } catch {
    throw new Error("Anthropic returned invalid streamed tool arguments");
  }
  delete block._partialJson;
}
