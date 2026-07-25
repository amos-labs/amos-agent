import { fetchCompat } from "../util/fetchCompat.js";

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

export class OpenAICompatibleClient {
  constructor(config, fetchImpl = fetchCompat) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async chat({ messages, tools = [] }) {
    const body = {
      model: this.config.model,
      messages
    };

    if (this.config.reasoningEffort && this.config.capabilities?.reasoning !== false) {
      body.reasoning_effort = this.config.reasoningEffort;
    }
    if (this.config.maxCompletionTokens > 0) {
      body.max_completion_tokens = this.config.maxCompletionTokens;
    }
    if (tools.length > 0 && this.config.capabilities?.tools !== false) {
      body.tools = tools;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs || 120_000);
    let response;
    try {
      const apiKey = this.config.apiKey || (await this.config.getAccessToken?.());
      response = await this.fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: compactObject({
          Authorization: apiKey ? `Bearer ${apiKey}` : null,
          "Content-Type": "application/json",
          ...this.config.headers
        }),
        signal: controller.signal,
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`${this.config.displayName || "Model"} request timed out`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const message = payload?.error?.message || text || `Model request failed with ${response.status}`;
      throw new Error(message);
    }

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      throw new Error(`${this.config.displayName || "Model"} response did not include choices[0].message`);
    }

    return {
      message: choice.message,
      usage: payload.usage || null,
      raw: payload
    };
  }
}
