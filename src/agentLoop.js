import { SYSTEM_PROMPT } from "./prompts.js";
import { throwIfAborted } from "./util/abort.js";

export class AgentLoop {
  constructor({ config, modelClient, kimiClient, registry, approvals, amosClient, systemPrompt = SYSTEM_PROMPT }) {
    this.config = config;
    this.modelClient = modelClient || kimiClient;
    this.registry = registry;
    this.approvals = approvals;
    this.amosClient = amosClient;
    this.systemPrompt = systemPrompt;
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }

  clear() {
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }

  async run(userContent, { onEvent = () => {}, signal = null } = {}) {
    throwIfAborted(signal);
    this.messages.push({ role: "user", content: userContent });

    for (let turn = 0; turn < this.config.agent.maxToolTurns; turn += 1) {
      throwIfAborted(signal);
      onEvent({
        type: "phase",
        phase: "thinking",
        turn,
        summary: turn === 0 ? "Understanding the task and company context" : "Evaluating the latest results"
      });
      const response = await this.modelClient.chat({
        messages: this.messages,
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
        onEvent({ type: "phase", phase: "completed", turn, summary: "Task completed" });
        return assistantMessage.content || "";
      }

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
        try {
          result = await this.registry.execute(name, args, this.context({ signal, onEvent }));
          throwIfAborted(signal);
          onEvent({ type: "tool_end", name, result });
        } catch (error) {
          throwIfAborted(signal);
          result = { ok: false, error: error.message };
          onEvent({ type: "tool_error", name, error: error.message });
        }

        this.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }

    return `Stopped after ${this.config.agent.maxToolTurns} tool turns.`;
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

function humanizeToolName(value) {
  return String(value || "tool")
    .replace(/^amos_/, "")
    .replaceAll("_", " ");
}
