import { fetchCompat } from "../util/fetchCompat.js";

export class KimiClient {
  constructor(config, fetchImpl = fetchCompat) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async chat({ messages, tools = [] }) {
    const body = {
      model: this.config.model,
      reasoning_effort: this.config.reasoningEffort,
      messages
    };

    if (this.config.maxCompletionTokens > 0) {
      body.max_completion_tokens = this.config.maxCompletionTokens;
    }

    if (tools.length > 0) {
      body.tools = tools;
    }

    const response = await this.fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const message = payload?.error?.message || text || `Kimi request failed with ${response.status}`;
      throw new Error(message);
    }

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      throw new Error("Kimi response did not include choices[0].message");
    }

    return {
      message: choice.message,
      usage: payload.usage || null,
      raw: payload
    };
  }
}
