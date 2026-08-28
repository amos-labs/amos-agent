import { Buffer } from "node:buffer";
import { canonicalJson } from "../util/canonicalJson.js";
import { formatScratchpadCard } from "./conversationScratchpad.js";

const DEFAULT_CONTEXT_TOKENS = 131_072;
const DEFAULT_OUTPUT_TOKENS = 8_192;
const MIN_CONTEXT_TOKENS = 4_096;
const IMAGE_TOKEN_ESTIMATE = 1_024;
// Do not let reserved generation steal a quarter of a 64k+ window. Hosted
// still needs a reply, but the product window is for the conversation.
const MAX_RESERVED_OUTPUT_TOKENS = 8_192;

export function compileModelContext({
  messages = [],
  tools = [],
  contextTokens = DEFAULT_CONTEXT_TOKENS,
  maxOutputTokens = DEFAULT_OUTPUT_TOKENS,
  preferredInputTokens = null,
  activeTask = null,
  workingObjective = "",
  recentJobs = [],
  scratchpad = null,
  charsPerToken = 4
} = {}) {
  const context = boundedInteger(contextTokens, DEFAULT_CONTEXT_TOKENS, MIN_CONTEXT_TOKENS, 1_048_576);
  const requestedOutput = boundedInteger(maxOutputTokens, DEFAULT_OUTPUT_TOKENS, 256, 131_072);
  const tokenChars = boundedInteger(charsPerToken, 4, 2, 8);
  const reservedOutputTokens = Math.min(
    requestedOutput,
    Math.max(1_024, Math.min(MAX_RESERVED_OUTPUT_TOKENS, Math.floor(context * 0.25)))
  );
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
  const annotated = injectScratchpadCard(messages, {
    scratchpad,
    workingObjective,
    recentJobs,
    compacted: false
  });
  const annotatedTokens = estimateMessageTokens(annotated, tokenChars);
  const didCompact = annotatedTokens > messageTokenBudget;
  const compiledMessages = didCompact
    ? compactMessages(messages, messageTokenBudget * tokenChars, {
      activeTask,
      workingObjective,
      recentJobs,
      scratchpad
    })
    : annotated;
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
      compacted: didCompact,
      compactionEstimatedSavedTokens: Math.max(
        0,
        originalMessageTokens - compiledMessageTokens
      ),
      compactionInvalidatesPrefix: didCompact,
      compactionReason: !didCompact
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
  if (!value) return { activeTask: null, workingObjective: "", recentJobs: [], scratchpad: null };
  if (value.role) return { activeTask: value, workingObjective: "", recentJobs: [], scratchpad: null };
  return {
    activeTask: value.activeTask || null,
    workingObjective: String(value.workingObjective || ""),
    recentJobs: Array.isArray(value.recentJobs) ? value.recentJobs : [],
    scratchpad: value.scratchpad || null
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

function boundPinnedMessage(message, budget) {
  const cap = Math.max(0, budget);
  return messageLength(message) > cap
    ? { ...message, content: truncateContent(message.content, cap) }
    : message;
}

function injectScratchpadCard(messages, options) {
  const card = formatScratchpadCard(options);
  if (!card) return messages;
  const firstUser = messages.findIndex((message) => message?.role === "user");
  if (firstUser < 0) return messages;
  const target = messages[firstUser];
  if (contentHasScratchpad(target?.content)) return messages;
  return messages.map((message, index) => (
    index === firstUser
      ? { ...message, content: prependCard(message.content, card) }
      : message
  ));
}

function contentHasScratchpad(content) {
  if (typeof content === "string") return content.includes("<amos_scratchpad>");
  if (!Array.isArray(content)) return String(content || "").includes("<amos_scratchpad>");
  return content.some((item) =>
    item?.type === "text" && String(item.text || "").includes("<amos_scratchpad>")
  );
}

function prependCard(content, card) {
  if (!card) return content;
  if (typeof content === "string") {
    return content.includes("<amos_scratchpad>") ? content : `${card}\n\n${content}`;
  }
  if (!Array.isArray(content)) return `${card}\n\n${String(content || "")}`;
  if (contentHasScratchpad(content)) return content;
  const textIndex = content.findIndex((item) => item?.type === "text");
  if (textIndex < 0) return [{ type: "text", text: card }, ...content];
  return content.map((item, index) => (
    index === textIndex
      ? { ...item, text: `${card}\n\n${item.text || ""}` }
      : item
  ));
}

function compactMessages(messages, charBudget, options) {
  const { activeTask, workingObjective, recentJobs, scratchpad } = compactionOptions(options);
  const system = messages.find((message) => message?.role === "system") || messages[0];
  const latestIndex = latestUserIndex(messages, activeTask);
  if (!system || latestIndex < 0) return messages.slice(-1);

  const systemIndex = messages.indexOf(system);
  const turns = conversationTurns(messages, systemIndex, latestIndex);
  const cardReserve = 1_800;
  const digestReserve = 400;
  let remaining = Math.max(0, charBudget - messageLength(system) - cardReserve - digestReserve);
  const selected = [];
  const dropped = [];

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const isLatest = index === turns.length - 1;
    const size = turnSize(turn);
    if (size <= remaining) {
      selected.unshift(turn);
      remaining -= size;
      continue;
    }
    const shrunk = shrinkTurn(turn, remaining, { isLatest });
    if (shrunk.length > 0 && turnSize(shrunk) <= remaining) {
      const kept = new Set(shrunk);
      dropped.unshift(turn.filter((message) => !kept.has(message)));
      selected.unshift(shrunk);
      remaining -= turnSize(shrunk);
      continue;
    }
    if (isLatest) {
      const user = turn.find((message) => message?.role === "user") || turn[0];
      const bounded = boundPinnedMessage(user, remaining);
      selected.unshift([bounded]);
      remaining = Math.max(0, remaining - messageLength(bounded));
      dropped.unshift(turn.filter((message) => message !== user));
      continue;
    }
    dropped.unshift(turn);
  }

  const willDrop = dropped.flat().length > 0 || turnSize(selected.flat()) < turnSize(turns.flat());
  const vendorSignals = willDrop ? droppedVendorSignals(dropped) : "";
  const ordered = injectScratchpadCard([system, ...selected.flat()], {
    scratchpad,
    workingObjective: workingObjective || userMessageText(messages[latestIndex]?.content),
    recentJobs,
    compacted: willDrop,
    vendorSignals
  });
  return ordered;
}

function conversationTurns(messages, systemIndex, latestIndex) {
  const turns = [];
  let current = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (index === systemIndex || index > latestIndex) continue;
    const message = messages[index];
    if (message?.role === "user" && current.length > 0) {
      turns.push(current);
      current = [message];
    } else {
      current.push(message);
    }
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

function turnSize(turn) {
  return (Array.isArray(turn) ? turn : []).reduce((total, message) => total + messageLength(message), 0);
}

function shrinkTurn(turn, budget, { isLatest = false } = {}) {
  if (budget < 120 || !Array.isArray(turn) || turn.length === 0) return [];
  const user = turn.find((message) => message?.role === "user");
  const userCap = Math.min(budget, isLatest ? 6_000 : 1_800);
  const parts = [];
  let remaining = budget;
  if (user) {
    const bounded = boundPinnedMessage(user, userCap);
    parts.push(bounded);
    remaining -= messageLength(bounded);
  }
  if (remaining < 120) return parts;

  const rest = turn.filter((message) => message !== user);
  const blocks = historyBlocks(rest);
  const kept = [];
  for (let index = blocks.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const block = blocks[index];
    const first = block[0] || {};
    if (hasToolCalls(first)) {
      const size = turnSize(block);
      if (size <= remaining) {
        kept.unshift(block);
        remaining -= size;
        continue;
      }
      const summary = compactBlock(block, Math.min(remaining, 4_000));
      if (summary) {
        kept.unshift([summary]);
        remaining -= messageLength(summary);
      }
      continue;
    }
    if (first?.role === "assistant") {
      const truncated = boundPinnedMessage(first, Math.min(remaining, 900));
      const size = messageLength(truncated);
      if (size > 0 && size <= remaining) {
        kept.unshift([truncated]);
        remaining -= size;
      }
    }
  }
  return [...parts, ...kept.flat()];
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
