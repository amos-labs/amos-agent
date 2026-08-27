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
  workingObjective = "",
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
    : compactMessages(messages, messageTokenBudget * tokenChars, {
      activeTask,
      workingObjective
    });
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

function compactionOptions(value) {
  if (!value) return { activeTask: null, workingObjective: "" };
  if (value.role) return { activeTask: value, workingObjective: "" };
  return {
    activeTask: value.activeTask || null,
    workingObjective: String(value.workingObjective || "")
  };
}

function latestUserIndex(messages, activeTask) {
  const activeIndex = activeTask ? messages.indexOf(activeTask) : -1;
  if (activeIndex >= 0) return activeIndex;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function userIndexesThrough(messages, latestIndex) {
  const indexes = [];
  for (let index = 0; index <= latestIndex; index += 1) {
    if (messages[index]?.role === "user") indexes.push(index);
  }
  return indexes;
}

function pinnedUserIndexes(messages, latestIndex, recentCount = 3) {
  const users = userIndexesThrough(messages, latestIndex);
  if (users.length === 0) return [];
  const recent = users.slice(-recentCount);
  let longest = users[0];
  for (const index of users) {
    if (messageLength(messages[index]) > messageLength(messages[longest])) longest = index;
  }
  return [...new Set([longest, ...recent])].sort((left, right) => left - right);
}

function boundPinnedMessage(message, budget) {
  const floor = Math.max(400, budget);
  return messageLength(message) > floor
    ? { ...message, content: truncateContent(message.content, floor) }
    : message;
}

function prependWorkingState(content, { workingObjective, compacted, vendorSignals = "" }) {
  const vendorText = String(vendorSignals || "").trim();
  const card = [
    "<amos_working_state>",
    "Pinned work for this turn. This is not necessarily the first message in the chat, and a short follow-up does not replace a more specific job.",
    workingObjective ? `Current job:\n${String(workingObjective).slice(0, 1_500)}` : "Current job: (not yet stated)",
    compacted
      ? "Older turns were omitted to fit the model window. Call desktop_inspect_conversation with a search query to recover exact earlier messages. Do not invent a different job."
      : "",
    vendorText && compacted ? vendorText : "",
    "</amos_working_state>"
  ].filter(Boolean).join("\n");
  if (typeof content === "string") return `${card}\n\n${content}`;
  if (!Array.isArray(content)) return `${card}\n\n${String(content || "")}`;
  const textIndex = content.findIndex((item) => item?.type === "text");
  if (textIndex < 0) return [{ type: "text", text: card }, ...content];
  return content.map((item, index) => (
    index === textIndex
      ? { ...item, text: `${card}\n\n${item.text || ""}` }
      : item
  ));
}

function compactMessages(messages, charBudget, options) {
  const { activeTask, workingObjective } = compactionOptions(options);
  const system = messages.find((message) => message?.role === "system") || messages[0];
  const latestIndex = latestUserIndex(messages, activeTask);
  if (!system || latestIndex < 0) return messages.slice(-1);

  const pinIndexes = pinnedUserIndexes(messages, latestIndex);
  const pinSet = new Set(pinIndexes);
  const systemChars = messageLength(system);
  let remaining = Math.max(0, charBudget - systemChars);
  const pinShare = Math.max(900, Math.floor(remaining / Math.max(2, pinIndexes.length + 1)));
  const pinned = new Map();
  for (const index of pinIndexes) {
    const bounded = boundPinnedMessage(messages[index], Math.min(remaining, pinShare));
    pinned.set(index, bounded);
    remaining = Math.max(0, remaining - messageLength(bounded));
  }

  const history = messages.filter((message, index) =>
    index !== messages.indexOf(system) && !pinSet.has(index)
  );
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

  const vendorSignals = willDrop ? droppedVendorSignals(dropped) : "";
  const kept = new Set(selected.flat());
  const firstPin = pinIndexes[0];
  const firstPinned = pinned.get(firstPin);
  if (firstPinned) {
    pinned.set(firstPin, {
      ...firstPinned,
      content: prependWorkingState(firstPinned.content, {
        workingObjective: workingObjective || userMessageText(messages[firstPin]?.content),
        compacted: willDrop,
        vendorSignals
      })
    });
  }

  const ordered = [system];
  for (let index = 0; index < messages.length; index += 1) {
    if (index === messages.indexOf(system)) continue;
    if (pinSet.has(index)) ordered.push(pinned.get(index));
    else if (kept.has(messages[index])) ordered.push(messages[index]);
  }
  return ordered;
}

function userMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map((item) => item?.type === "text" ? String(item.text || "") : "").join("\n");
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

function droppedVendorSignals(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const signals = [];
  for (const block of blocks) {
    for (const message of block) {
      if (message?.role !== "tool") continue;
      const signal = vendorSignal(message.content);
      if (signal) signals.push(`- ${signal}`);
    }
  }
  const unique = [...new Set(signals)].slice(-12);
  return unique.length > 0
    ? `Vendor and tool signals from omitted turns:\n${unique.join("\n")}`
    : "";
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
