import {
  executeModelRequest,
  normalizedUsage,
  readJsonResponse,
  readSseEvents
} from "./protocol.js";

const PROTOCOL = "openai-responses";

export class OpenAIResponsesClient {
  constructor(config, fetchImpl) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async chat({ messages, tools = [], onDelta = null, signal = null }) {
    const apiKey = this.config.apiKey || (await this.config.getAccessToken?.());
    const body = {
      model: this.config.model,
      input: responsesInput(messages),
      store: false
    };
    if (this.config.reasoningEffort && this.config.capabilities?.reasoning !== false) {
      body.reasoning = { effort: this.config.reasoningEffort };
      if (this.config.capabilities?.encryptedReasoning !== false) {
        body.include = ["reasoning.encrypted_content"];
      }
    }
    if (this.config.maxCompletionTokens > 0) {
      body.max_output_tokens = this.config.maxCompletionTokens;
    }
    if (tools.length > 0 && this.config.capabilities?.tools !== false) {
      body.tools = tools.map(responsesTool);
    }
    if (typeof onDelta === "function") body.stream = true;

    return executeModelRequest({
      config: this.config,
      fetchImpl: this.fetch,
      path: "/responses",
      headers: {
        Authorization: apiKey ? `Bearer ${apiKey}` : null,
        ...this.config.headers
      },
      body,
      signal,
      consume: async (response, context) => {
        if (typeof onDelta !== "function") {
          return normalizeResponsesPayload(await readJsonResponse(response, context.displayName), context.displayName);
        }
        return readResponsesStream(response, { ...context, onDelta });
      }
    });
  }
}

function responsesTool(tool) {
  const definition = tool.function || tool;
  return {
    type: "function",
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters || { type: "object", properties: {} },
    ...(definition.strict == null ? {} : { strict: definition.strict })
  };
}

function responsesInput(messages = []) {
  const input = [];
  for (const message of messages) {
    if (message.role === "assistant" && message.provider_state?.protocol === PROTOCOL) {
      input.push(...structuredClone(message.provider_state.output || []));
      continue;
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: typeof message.content === "string" ? message.content : JSON.stringify(message.content)
      });
      continue;
    }
    const content = responsesMessageContent(message.content);
    if (content != null && !(Array.isArray(content) && content.length === 0)) {
      input.push({ role: message.role, content });
    }
    for (const call of message.tool_calls || []) {
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.function?.name,
        arguments: call.function?.arguments || "{}"
      });
    }
  }
  return input;
}

function responsesMessageContent(content) {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content.flatMap((part) => {
    if (typeof part === "string") return [{ type: "input_text", text: part }];
    if (part?.type === "text" || part?.type === "input_text") {
      return [{ type: "input_text", text: part.text || "" }];
    }
    if (part?.type === "image_url") {
      const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (!imageUrl) return [];
      return [{
        type: "input_image",
        image_url: imageUrl,
        ...(part.image_url?.detail ? { detail: part.image_url.detail } : {})
      }];
    }
    if (part?.type === "input_image") return [part];
    return [];
  });
}

function normalizeResponsesPayload(payload, displayName) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const message = canonicalResponsesMessage(output);
  if (!message.content && !message.tool_calls?.length) {
    throw new Error(`${displayName} response did not include content or tool calls`);
  }
  message.provider_state = { protocol: PROTOCOL, output: structuredClone(output) };
  return { message, usage: normalizedUsage(payload.usage), raw: payload };
}

function canonicalResponsesMessage(output) {
  const text = [];
  const toolCalls = [];
  for (const item of output) {
    if (item?.type === "message") {
      for (const part of item.content || []) {
        if (part?.type === "output_text" && part.text) text.push(part.text);
        if (part?.type === "refusal" && part.refusal) text.push(part.refusal);
      }
    }
    if (item?.type === "function_call") {
      toolCalls.push({
        id: item.call_id || item.id,
        type: "function",
        function: { name: item.name || "", arguments: item.arguments || "{}" }
      });
    }
  }
  return {
    role: "assistant",
    content: text.join(""),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
  };
}

async function readResponsesStream(response, { signal, displayName, onDelta }) {
  let completed = null;
  let failure = null;
  let visibleText = "";
  const items = new Map();
  const result = await readSseEvents(response, {
    signal,
    displayName,
    onEvent: ({ event, data }) => {
      if (!data) return;
      const type = data.type || event;
      if (type === "response.output_text.delta" && typeof data.delta === "string") {
        visibleText += data.delta;
        onDelta(data.delta, visibleText);
      } else if (type === "response.output_item.added" && data.item) {
        items.set(data.output_index ?? items.size, structuredClone(data.item));
      } else if (type === "response.function_call_arguments.delta") {
        const index = data.output_index ?? 0;
        const item = items.get(index) || { type: "function_call", arguments: "" };
        item.arguments = `${item.arguments || ""}${data.delta || ""}`;
        items.set(index, item);
      } else if (type === "response.output_item.done" && data.item) {
        items.set(data.output_index ?? items.size, structuredClone(data.item));
      } else if (type === "response.completed") {
        completed = data.response || data;
      } else if (["response.failed", "response.incomplete", "error"].includes(type)) {
        failure = data.error?.message || data.response?.error?.message ||
          data.response?.incomplete_details?.reason || `${displayName} response was ${type.split(".").pop()}`;
      }
    }
  });

  if (!result.streamed) {
    const normalized = normalizeResponsesPayload(result.payload, displayName);
    if (normalized.message.content) onDelta(normalized.message.content, normalized.message.content);
    return normalized;
  }
  if (failure) throw new Error(failure);
  const payload = completed || { output: [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item) };
  const normalized = normalizeResponsesPayload(payload, displayName);
  normalized.raw = result.raw;
  return normalized;
}
