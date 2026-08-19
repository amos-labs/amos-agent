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
  activeTask = null
} = {}) {
  const context = boundedInteger(contextTokens, DEFAULT_CONTEXT_TOKENS, MIN_CONTEXT_TOKENS, 1_048_576);
  const requestedOutput = boundedInteger(maxOutputTokens, DEFAULT_OUTPUT_TOKENS, 256, 131_072);
  const reservedOutputTokens = Math.min(requestedOutput, Math.max(1_024, Math.floor(context * 0.25)));
  const safetyTokens = Math.max(512, Math.floor(context * 0.05));
  const toolTokens = estimateToolTokens(tools);
  const hardMessageTokenBudget = Math.max(
    512,
    context - reservedOutputTokens - safetyTokens - toolTokens
  );
  const preferredInput = optionalBoundedInteger(preferredInputTokens, 1_024, context);
  const preferredMessageTokenBudget = preferredInput == null
    ? hardMessageTokenBudget
    : Math.max(512, preferredInput - toolTokens);
  const messageTokenBudget = Math.min(hardMessageTokenBudget, preferredMessageTokenBudget);
  const originalMessageTokens = estimateMessageTokens(messages);
  const compiledMessages = originalMessageTokens <= messageTokenBudget
    ? messages
    : compactMessages(messages, messageTokenBudget * 4, activeTask);
  const compiledMessageTokens = estimateMessageTokens(compiledMessages);
  return {
    messages: compiledMessages,
    plan: {
      version: 2,
      contextTokens: context,
      reservedOutputTokens,
      safetyTokens,
      toolTokens,
      hardMessageTokenBudget,
      preferredInputTokens: preferredInput,
      messageTokenBudget,
      originalMessageTokens,
      compiledMessageTokens,
      estimatedInputTokens: toolTokens + compiledMessageTokens,
      compacted: compiledMessages !== messages,
      compactionReason: compiledMessages === messages
        ? null
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

export function estimateMessageTokens(messages = []) {
  return Math.ceil(messages.reduce((total, message) =>
    total + modelContentLength(message?.content) + modelToolCallLength(message), 0
  ) / 4);
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

function estimateToolTokens(tools) {
  return Math.ceil(JSON.stringify(Array.isArray(tools) ? tools : []).length / 4);
}

function modelToolCallLength(message) {
  return Array.isArray(message?.tool_calls) ? JSON.stringify(message.tool_calls).length : 0;
}

function compactMessages(messages, charBudget, activeTask) {
  const system = messages.find((message) => message?.role === "system") || messages[0];
  const referencedTaskIndex = activeTask ? messages.indexOf(activeTask) : -1;
  const taskIndex = referencedTaskIndex >= 0
    ? referencedTaskIndex
    : messages.findIndex((message) => message?.role === "user");
  if (!system || taskIndex < 0) return messages.slice(-1);
  const task = messages[taskIndex];
  const systemChars = messageLength(system);
  const taskBudget = Math.max(1_000, charBudget - systemChars - 1_000);
  const boundedTask = messageLength(task) > taskBudget
    ? { ...task, content: truncateContent(task.content, taskBudget) }
    : task;
  let remaining = Math.max(0, charBudget - systemChars - messageLength(boundedTask));
  const selected = [];
  const blocks = historyBlocks(messages.slice(taskIndex + 1));
  for (let index = blocks.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const block = blocks[index];
    const size = block.reduce((total, message) => total + messageLength(message), 0);
    if (size <= remaining) {
      selected.unshift(block);
      remaining -= size;
      continue;
    }
    const summary = compactBlock(block, Math.min(remaining, 4_000));
    if (summary) selected.unshift([summary]);
    break;
  }
  return [system, boundedTask, ...selected.flat()];
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
