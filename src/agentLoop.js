import { SYSTEM_PROMPT } from "./prompts.js";

export class AgentLoop {
  constructor({ config, modelClient, kimiClient, registry, approvals, amosClient }) {
    this.config = config;
    this.modelClient = modelClient || kimiClient;
    this.registry = registry;
    this.approvals = approvals;
    this.amosClient = amosClient;
    this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  clear() {
    this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  async run(userText, { onEvent = () => {} } = {}) {
    this.messages.push({ role: "user", content: userText });

    for (let turn = 0; turn < this.config.agent.maxToolTurns; turn += 1) {
      const response = await this.modelClient.chat({
        messages: this.messages,
        tools: this.registry.openAiTools()
      });

      const assistantMessage = response.message;
      this.messages.push(assistantMessage);

      const toolCalls = assistantMessage.tool_calls || [];
      if (toolCalls.length === 0) {
        return assistantMessage.content || "";
      }

      for (const toolCall of toolCalls) {
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

        onEvent({ type: "tool_start", name, args });
        let result;
        try {
          result = await this.registry.execute(name, args, this.context());
          onEvent({ type: "tool_end", name, result });
        } catch (error) {
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

  context() {
    return {
      config: this.config,
      registry: this.registry,
      approvals: this.approvals,
      amosClient: this.amosClient
    };
  }
}
