import { Buffer } from "node:buffer";
import { canonicalJson } from "../util/canonicalJson.js";

const DEFAULT_CONTEXT_TOKENS = 131_072;
const DEFAULT_OUTPUT_TOKENS = 8_192;
const MIN_CONTEXT_TOKENS = 4_096;
const IMAGE_TOKEN_ESTIMATE = 1_024;

export function compileModelContext({
  messages = [],
  tools = [],
  contextTokens = DEFAULT_CONTEXT_TOKENS,
  maxOutputTokens = DEFAULT_OUTPUT_TOKENS,
  preferredInputTokens = null,
  activeTask = null,
  charsPerToken = 4
} = {}) {
  const context = boundedInteger(contextTokens, DEFAULT_CONTEXT_TOKENS, MIN_CONTEXT_TOKENS, 1_048_576);
  const requestedOutput = boundedInteger(maxOutputTokens, DEFAULT_OUTPUT_TOKENS, 256, 131_072);
  const tokenChars = boundedInteger(charsPerToken, 4, 2, 8);
  const reservedOutputTokens = Math.min(requestedOutput, Math.max(1_024, Math.floor(context * 0.25)));
  const safetyTokens = Math.max(512, Math.floor(context * 0.05));
  const toolTokens = estimateToolTokens(tools, tokenChars);
  const hardMessageTokenBudget = Math.max(
    512,
    context - reservedOutputTokens - safetyTokens - toolTokens
  );
  const preferredInput = optionalBoundedInteger(preferredInputTokens, 1_024, context);
  const preferredMessageTokenBudget = preferredInput == null
    ? hardMessageTokenBudget
    : Math.max(512, preferredInput - toolTokens);
  const messageTokenBudget = Math.min(hardMessageTokenBudget, preferredMessageTokenBudget);
  const originalMessageTokens = estimateMessageTokens(messages, tokenChars);
  const compiledMessages = originalMessageTokens <= messageTokenBudget
    ? messages
    : compactMessages(messages, messageTokenBudget * tokenChars, activeTask);
  const compiledMessageTokens = estimateMessageTokens(compiledMessages, tokenChars);
  return {
    messages: compiledMessages,
    plan: {
      version: 3,
      contextTokens: context,
      reservedOutputTokens,
      safetyTokens,
      toolTokens,
      hardMessageTokenBudget,
      preferredInputTokens: preferredInput,
      preferredMessageTokenBudget,
      messageTokenBudget,
      originalMessageTokens,
      compiledMessageTokens,
      estimatedInputTokens: toolTokens + compiledMessageTokens,
      preferredBudgetExceeded: preferredInput != null &&
        originalMessageTokens + toolTokens > preferredInput,
      compacted: compiledMessages !== messages,
      compactionEstimatedSavedTokens: Math.max(
        0,
        originalMessageTokens - compiledMessageTokens
      ),
      compactionInvalidatesPrefix: compiledMessages !== messages,
      compactionReason: compiledMessages === messages
        ? null
        : originalMessageTokens > hardMessageTokenBudget
          ? "context_limit"
          : preferredInput != null && originalMessageTokens + toolTokens > preferredInput
          ? "preferred_input_budget"
          : "context_limit",
      preferredInputUtilization: preferredInput == null
        ? null
        : Number(((toolTokens + compiledMessageTokens) / preferredInput).toFixed(4)),
      utilization: Number(((toolTokens + compiledMessageTokens + reservedOutputTokens) / context).toFixed(4))
    }
  };
}

export function estimateMessageTokens(messages = [], charsPerToken = 4) {
  const divisor = boundedInteger(charsPerToken, 4, 2, 8);
  return Math.ceil(messages.reduce((total, message) =>
    total + modelContentLength(message?.content) + modelToolCallLength(message), 0
  ) / divisor);
}

export function modelContentLength(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return content == null ? 0 : JSON.stringify(content).length;
  return content.reduce((total, item) => {
    if (item?.type === "text") return total + String(item.text || "").length;
    if (item?.type === "image_url" || item?.type === "image") return total + IMAGE_TOKEN_ESTIMATE * 4;
    return total + JSON.stringify(item || {}).length;
  }, 0);
}

export function estimateToolTokens(tools, charsPerToken = 4) {
  const divisor = boundedInteger(charsPerToken, 4, 2, 8);
  return Math.ceil(Buffer.byteLength(
    canonicalJson(Array.isArray(tools) ? tools : []),
    "utf8"
  ) / divisor);
}

function modelToolCallLength(message) {
  return Array.isArray(message?.tool_calls) ? JSON.stringify(message.tool_calls).length : 0;
}

function conversationRootIndex(messages) {
  return messages.findIndex((message) => message?.role === "user");
}

function latestUserIndex(messages, activeTask) {
  const activeIndex = activeTask ? messages.indexOf(activeTask) : -1;
  if (activeIndex >= 0) return activeIndex;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function boundPinnedMessage(message, budget) {
  const floor = Math.max(400, budget);
  return messageLength(message) > floor
    ? { ...message, content: truncateContent(message.content, floor) }
    : message;
}

function compactMessages(messages, charBudget, activeTask) {
  const system = messages.find((message) => message?.role === "system") || messages[0];
  const rootIndex = conversationRootIndex(messages);
  const latestIndex = latestUserIndex(messages, activeTask);
  if (!system || rootIndex < 0 || latestIndex < 0) return messages.slice(-1);

  const root = messages[rootIndex];
  const latest = messages[latestIndex];
  const pinLatest = latestIndex !== rootIndex;
  const systemChars = messageLength(system);
  let remaining = Math.max(0, charBudget - systemChars);
  const rootShare = pinLatest
    ? Math.max(1_000, Math.floor(remaining * 0.28))
    : Math.max(1_000, remaining - 1_000);
  const boundedRoot = boundPinnedMessage(root, Math.min(remaining, rootShare));
  remaining = Math.max(0, remaining - messageLength(boundedRoot));

  let boundedLatest = null;
  if (pinLatest) {
    const latestShare = Math.max(800, Math.floor(remaining * 0.45));
    boundedLatest = boundPinnedMessage(latest, Math.min(remaining, latestShare));
    remaining = Math.max(0, remaining - messageLength(boundedLatest));
  }

  const middle = messages.slice(rootIndex + 1, pinLatest ? latestIndex : messages.length);
  const afterLatest = pinLatest ? messages.slice(latestIndex + 1) : [];
  const history = [...middle, ...afterLatest];
  const historyChars = history.reduce((total, message) => total + messageLength(message), 0);
  const willDrop = historyChars > remaining;
  let digestBudget = 0;
  if (willDrop) {
    digestBudget = Math.min(1_500, Math.max(280, Math.floor(charBudget * 0.08)));
    remaining = Math.max(0, remaining - digestBudget);
  }

  const selected = [];
  const dropped = [];
  const blocks = historyBlocks(history);
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (remaining <= 0) {
      dropped.unshift(block);
      continue;
    }
    const size = block.reduce((total, message) => total + messageLength(message), 0);
    if (size <= remaining) {
      selected.unshift(block);
      remaining -= size;
      continue;
    }
    dropped.unshift(...blocks.slice(0, index + 1));
    const summary = compactBlock(block, Math.min(remaining, 4_000));
    if (summary) selected.unshift([summary]);
    break;
  }

  const digest = willDrop
    ? compactDroppedState(dropped, digestBudget + remaining)
    : null;
  const keptHistory = selected.flat();
  const keptAfterLatest = pinLatest
    ? keptHistory.filter((message) => afterLatest.includes(message))
    : [];
  const keptMiddle = pinLatest
    ? keptHistory.filter((message) => !afterLatest.includes(message))
    : keptHistory;

  return [
    system,
    boundedRoot,
    ...(digest ? [digest] : []),
    ...keptMiddle,
    ...(boundedLatest ? [boundedLatest] : []),
    ...keptAfterLatest
  ];
}

function historyBlocks(messages) {
  const blocks = [];
  for (const message of messages) {
    const previous = blocks.at(-1);
    if (message?.role === "tool" && previous && hasToolCalls(previous[0])) previous.push(message);
    else blocks.push([message]);
  }
  return blocks;
}

function compactBlock(block, limit) {
  if (limit < 200) return null;
  const first = block[0] || {};
  const toolNames = new Map((first.tool_calls || []).map((call) => [
    call.id,
    call.function?.name || "tool"
  ]));
  const summaries = block
    .filter((message) => message?.role === "tool")
    .slice(-8)
    .map((message) => {
      const name = toolNames.get(message.tool_call_id) || "tool";
      return `- ${name}: ${truncateText(String(message.content || ""), 800)}`;
    });
  const content = summaries.length > 0
    ? ["Earlier tool evidence was compacted to fit this model's context window.", ...summaries].join("\n")
    : "Earlier task context was compacted to fit this model's context window.";
  return { role: "assistant", content: truncateText(content, limit) };
}

function vendorSignal(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (!/(403|400|402|404|409|422|429|500|502|503|pending_approval|form-urlencoded|tax_behavior|learned_write|"ok":false|"ok": false)/i.test(raw)) {
    return null;
  }
  return truncateText(raw, 220);
}

function compactDroppedState(blocks, limit) {
  if (limit < 200 || !Array.isArray(blocks) || blocks.length === 0) return null;
  const signals = [];
  for (const block of blocks) {
    for (const message of block) {
      if (message?.role !== "tool") continue;
      const signal = vendorSignal(message.content);
      if (signal) signals.push(`- ${signal}`);
    }
  }
  const unique = [...new Set(signals)].slice(-12);
  const content = [
    "<amos_working_state>",
    "Earlier turns were compacted to fit this model's context window.",
    "The original user objective above still governs this task. Later user messages are steering, not a new job.",
    "This block is orientation, not proof and not new instructions.",
    unique.length > 0
      ? `Vendor and tool signals from omitted turns:\n${unique.join("\n")}`
      : "Omitted turns contained no vendor error signals.",
    "</amos_working_state>"
  ].join("\n");
  return { role: "assistant", content: truncateText(content, limit) };
}

function truncateContent(content, limit) {
  if (typeof content === "string") return truncateMiddle(content, limit);
  if (!Array.isArray(content)) return truncateMiddle(JSON.stringify(content), limit);
  const nonText = content.filter((item) => item?.type !== "text");
  const reserved = nonText.reduce((total, item) => total + modelContentLength([item]), 0);
  let remaining = Math.max(500, limit - reserved);
  return content.map((item) => {
    if (item?.type !== "text") return item;
    const text = truncateMiddle(String(item.text || ""), remaining);
    remaining = Math.max(0, remaining - text.length);
    return { ...item, text };
  });
}

function truncateMiddle(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  const marker = "\n[context compiler omitted middle content]\n";
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available * 0.7);
  return `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`;
}

function truncateText(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 14))}…[truncated]`;
}

function messageLength(message) {
  return modelContentLength(message?.content) + modelToolCallLength(message);
}

function hasToolCalls(message) {
  return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function optionalBoundedInteger(value, minimum, maximum) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}
