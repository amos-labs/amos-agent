import { createHash } from "node:crypto";
import { SYSTEM_PROMPT } from "./prompts.js";
import { throwIfAborted } from "./util/abort.js";
import {
  applyWorkflowToModelContent,
  selectTaskWorkflow
} from "./workflows.js";

const DEFAULT_COMPLETED_HISTORY_LIMIT = 48;
const DEFAULT_MODEL_MESSAGE_LIMIT = 112;
const MAX_MODEL_MESSAGE_LIMIT = 120;

export class AgentLoop {
  constructor({
    config,
    modelClient,
    kimiClient,
    registry,
    approvals,
    amosClient,
    systemPrompt = SYSTEM_PROMPT,
    workflowSelector = selectTaskWorkflow,
    onToolResult = null
  }) {
    this.config = config;
    this.modelClient = modelClient || kimiClient;
    this.registry = registry;
    this.approvals = approvals;
    this.amosClient = amosClient;
    this.systemPrompt = systemPrompt;
    this.workflowSelector = workflowSelector;
    this.onToolResult = onToolResult;
    this.lastWorkflow = null;
    this.activeTaskMessage = null;
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }

  clear() {
    this.lastWorkflow = null;
    this.activeTaskMessage = null;
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }

  restoreContinuity(content) {
    const continuity = String(content || "").trim();
    if (!continuity || this.activeTaskMessage || this.messages.length > 1) return false;
    this.messages.push({ role: "assistant", content: continuity });
    return true;
  }

  async run(
    userContent,
    {
      onEvent = () => {},
      signal = null,
      takeSteering = () => [],
      workflow: selectedWorkflow = null
    } = {}
  ) {
    throwIfAborted(signal);
    this.compactCompletedHistory();
    const workflow = selectedWorkflow || this.workflowSelector({ objective: userContent });
    this.lastWorkflow = workflow;
    onEvent({
      type: "workflow",
      id: workflow.id,
      version: workflow.version,
      source: workflow.source,
      title: workflow.title,
      summary: workflow.summary,
      skills: workflow.skills.map((skill) => skill.name),
      steps: workflow.steps,
      doneWhen: workflow.doneWhen
    });
    const taskMessage = {
      role: "user",
      content: applyWorkflowToModelContent(userContent, workflow)
    };
    this.messages.push(taskMessage);
    this.activeTaskMessage = taskMessage;

    try {
      let turn = 0;
      let previousToolFingerprint = null;
      let repeatedToolCycles = 0;
      let consecutiveToolErrorCycles = 0;

      while (true) {
        throwIfAborted(signal);
        const steeringBeforeThinking = this.applySteering(takeSteering, onEvent, turn);
        if (steeringBeforeThinking > 0) {
          previousToolFingerprint = null;
          repeatedToolCycles = 0;
          consecutiveToolErrorCycles = 0;
        }
        onEvent({
          type: "phase",
          phase: "thinking",
          turn,
          summary: turn === 0 ? "Understanding the task and company context" : "Evaluating the latest results"
        });
        const response = await this.modelClient.chat({
          messages: this.prepareMessagesForModel(),
          tools: this.registry.openAiTools(),
          signal,
          onDelta: (delta, text) => {
            onEvent({ type: "assistant_delta", turn, delta, text });
          }
        });

        throwIfAborted(signal);
        const assistantMessage = response.message;
        this.messages.push(assistantMessage);

        const toolCalls = assistantMessage.tool_calls || [];
        if (toolCalls.length === 0) {
          const steeringAfterResponse = this.applySteering(takeSteering, onEvent, turn);
          if (steeringAfterResponse > 0) {
            previousToolFingerprint = null;
            repeatedToolCycles = 0;
            consecutiveToolErrorCycles = 0;
            turn += 1;
            continue;
          }
          onEvent({ type: "phase", phase: "completed", turn, summary: "Task completed" });
          return assistantMessage.content || "";
        }

        const outcomes = [];
        for (const toolCall of toolCalls) {
          throwIfAborted(signal);
          const name = toolCall.function?.name;
          const rawArgs = toolCall.function?.arguments || "{}";
          let args;
          try {
            args = JSON.parse(rawArgs);
          } catch (error) {
            const message = `Invalid JSON arguments: ${error.message}`;
            onEvent({ type: "tool_error", name, error: message });
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ ok: false, error: message })
            });
            outcomes.push({ name, rawArgs, failed: true, result: { ok: false, error: message } });
            continue;
          }

          if (!args || Array.isArray(args) || typeof args !== "object") {
            const message = "Tool arguments must be a JSON object";
            onEvent({ type: "tool_error", name, error: message });
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ ok: false, error: message })
            });
            outcomes.push({ name, rawArgs, failed: true, result: { ok: false, error: message } });
            continue;
          }

          onEvent({
            type: "phase",
            phase: "acting",
            turn,
            summary: `Running ${humanizeToolName(name)}`
          });
          onEvent({ type: "tool_start", name, args });
          let result;
          let failed = false;
          try {
            result = await this.registry.execute(name, args, this.context({ signal, onEvent }));
            throwIfAborted(signal);
            failed = result?.ok === false;
            onEvent({ type: "tool_end", name, result });
          } catch (error) {
            throwIfAborted(signal);
            failed = true;
            result = { ok: false, error: error.message };
            onEvent({ type: "tool_error", name, error: error.message });
          }

          if (!failed && this.onToolResult) {
            try {
              const reference = await this.onToolResult({ name, args, result, failed });
              if (reference?.result_ref) {
                result = result && typeof result === "object" && !Array.isArray(result)
                  ? { ...result, desktop_result_ref: reference.result_ref }
                  : { result, desktop_result_ref: reference.result_ref };
              }
            } catch (error) {
              onEvent({
                type: "tool_context_error",
                name,
                error: error.message
              });
            }
          }

          this.messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
          outcomes.push({ name, rawArgs, failed, result });
        }

        const steeringAfterTools = this.applySteering(takeSteering, onEvent, turn);
        if (steeringAfterTools > 0) {
          previousToolFingerprint = null;
          repeatedToolCycles = 0;
          consecutiveToolErrorCycles = 0;
          turn += 1;
          continue;
        }

        const fingerprint = toolCycleFingerprint(outcomes);
        repeatedToolCycles =
          fingerprint === previousToolFingerprint ? repeatedToolCycles + 1 : 1;
        previousToolFingerprint = fingerprint;
        consecutiveToolErrorCycles = outcomes.every((outcome) => outcome.failed)
          ? consecutiveToolErrorCycles + 1
          : 0;

        const guardReason = this.guardReason({
          repeatedToolCycles,
          consecutiveToolErrorCycles
        });
        if (guardReason) {
          return this.summarizeGuardedStop(guardReason, { onEvent, signal, turn });
        }
        turn += 1;
      }
    } finally {
      this.activeTaskMessage = null;
    }
  }

  applySteering(takeSteering, onEvent, turn) {
    const queued = takeSteering?.();
    const messages = Array.isArray(queued) ? queued : queued ? [queued] : [];
    const steering = messages
      .map((item) => typeof item === "string" ? item : item?.content)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (steering.length === 0) return 0;
    for (const content of steering) {
      this.messages.push({ role: "user", content });
    }
    onEvent({
      type: "phase",
      phase: "steering_applied",
      turn,
      summary:
        steering.length === 1
          ? "Applied the user's new direction to the active task"
          : `Applied ${steering.length} new directions to the active task`
    });
    return steering.length;
  }

  compactCompletedHistory() {
    if (this.activeTaskMessage) return false;
    const limit = boundedInteger(
      this.config.agent?.completedHistoryMessages,
      DEFAULT_COMPLETED_HISTORY_LIMIT,
      8,
      DEFAULT_MODEL_MESSAGE_LIMIT
    );
    if (this.messages.length <= limit) return false;

    const systemMessage = this.messages.find((message) => message.role === "system") || {
      role: "system",
      content: this.systemPrompt
    };
    const milestones = this.messages.slice(1).filter((message) =>
      message.role === "user" ||
      (message.role === "assistant" && !hasToolCalls(message) && message.content)
    );
    this.messages = [systemMessage, ...milestones.slice(-(limit - 1))];
    return true;
  }

  prepareMessagesForModel() {
    const limit = boundedInteger(
      this.config.agent?.maxModelMessages,
      DEFAULT_MODEL_MESSAGE_LIMIT,
      8,
      MAX_MODEL_MESSAGE_LIMIT
    );
    if (this.messages.length <= limit) return this.messages;

    const systemMessage = this.messages.find((message) => message.role === "system") || {
      role: "system",
      content: this.systemPrompt
    };
    const taskIndex = this.messages.indexOf(this.activeTaskMessage);
    if (taskIndex < 0) {
      this.compactCompletedHistory();
      return this.messages.slice(0, limit);
    }

    const selected = [];
    let remaining = limit - 2;
    const blocks = historyBlocks(this.messages.slice(taskIndex + 1));
    for (let index = blocks.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const block = blocks[index];
      if (!isCompleteHistoryBlock(block) || block.length > remaining) {
        selected.unshift([compactHistoryBlock(block)]);
        remaining -= 1;
        break;
      }
      selected.unshift(block);
      remaining -= block.length;
    }

    this.messages = [
      systemMessage,
      this.activeTaskMessage,
      ...selected.flat()
    ];
    return this.messages;
  }

  guardReason({ repeatedToolCycles, consecutiveToolErrorCycles }) {
    const repeatedLimit = this.config.agent?.maxRepeatedToolCycles ?? 5;
    if (repeatedToolCycles >= repeatedLimit) {
      return "the same tool plan and results repeated without producing new evidence";
    }
    const errorLimit = this.config.agent?.maxConsecutiveToolErrorCycles ?? 3;
    if (consecutiveToolErrorCycles >= errorLimit) {
      return "every tool in several consecutive cycles failed";
    }
    return null;
  }

  async summarizeGuardedStop(reason, { onEvent, signal, turn }) {
    throwIfAborted(signal);
    onEvent({
      type: "phase",
      phase: "synthesizing",
      turn,
      summary: "A no-progress safeguard fired; preparing the best supported result"
    });
    const guardInstruction = {
      role: "system",
      content: [
        `AMOS detected that ${reason}.`,
        "Do not call another tool in this response.",
        "Give the user the most useful evidence-backed result available so far.",
        "State what was established, what remains unresolved, and the single best next step.",
        "Do not describe this as a tool-turn limit."
      ].join(" ")
    };
    const response = await this.modelClient.chat({
      messages: [...this.prepareMessagesForModel(), guardInstruction],
      tools: [],
      signal,
      onDelta: (delta, text) => {
        onEvent({ type: "assistant_delta", turn: turn + 1, delta, text });
      }
    });
    throwIfAborted(signal);
    this.messages.push(response.message);
    onEvent({
      type: "phase",
      phase: "completed",
      turn: turn + 1,
      summary: "Task paused with an evidence-backed result"
    });
    return response.message.content ||
      "AMOS could not make further progress. Review the completed evidence and steer the task with any missing context.";
  }

  context({ signal = null, onEvent = () => {} } = {}) {
    return {
      config: this.config,
      registry: this.registry,
      approvals: this.approvals,
      amosClient: this.amosClient,
      signal,
      onEvent
    };
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function hasToolCalls(message) {
  return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
}

function historyBlocks(messages) {
  const blocks = [];
  for (const message of messages) {
    const previous = blocks.at(-1);
    if (message.role === "tool" && previous && hasToolCalls(previous[0])) {
      previous.push(message);
    } else {
      blocks.push([message]);
    }
  }
  return blocks;
}

function isCompleteHistoryBlock(block) {
  if (block.length === 0 || block[0]?.role === "tool") return false;
  const first = block[0];
  if (!hasToolCalls(first)) return block.length === 1;
  if (block.slice(1).some((message) => message.role !== "tool")) return false;
  const expected = new Set(first.tool_calls.map((call) => call.id).filter(Boolean));
  if (expected.size !== first.tool_calls.length) return false;
  const received = new Set(block.slice(1).map((message) => message.tool_call_id).filter(Boolean));
  return [...expected].every((id) => received.has(id));
}

function compactHistoryBlock(block) {
  const first = block[0] || {};
  const names = new Map(
    (first.tool_calls || []).map((call) => [
      call.id,
      call.function?.name || "tool"
    ])
  );
  const results = block
    .filter((message) => message.role === "tool")
    .slice(-8)
    .map((message) => {
      const name = names.get(message.tool_call_id) || "tool";
      return `- ${name}: ${truncateHistoryContent(message.content, 1_000)}`;
    });
  const content = results.length > 0
    ? [
        "Earlier tool activity was compacted to keep this task within the model message limit.",
        ...results
      ].join("\n")
    : "Earlier task activity was compacted to keep this task within the model message limit.";
  return { role: "assistant", content };
}

function truncateHistoryContent(value, limit) {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  const content = encoded == null ? "" : encoded;
  if (content.length <= limit) return content;
  return `${content.slice(0, limit - 1)}…`;
}

function toolCycleFingerprint(outcomes) {
  const encoded = JSON.stringify(
    outcomes.map(({ name, rawArgs, failed, result }) => ({
      name,
      rawArgs,
      failed,
      result
    }))
  );
  return createHash("sha256").update(encoded).digest("hex");
}

function humanizeToolName(value) {
  return String(value || "tool")
    .replace(/^amos_/, "")
    .replaceAll("_", " ");
}
