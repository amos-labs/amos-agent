import { fetchCompat } from "../util/fetchCompat.js";

function parseMcpHttpBody(text, contentType = "") {
  if (!text) return {};

  if (contentType.includes("text/event-stream")) {
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
    const last = dataLines.at(-1);
    return last ? JSON.parse(last) : {};
  }

  return JSON.parse(text);
}

export function extractMcpText(result) {
  const content = result?.content || result?.result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (item.type === "text") return item.text || "";
      return JSON.stringify(item);
    })
    .filter(Boolean)
    .join("\n");
}

export class AmosMcpClient {
  constructor({ url, apiKey }, fetchImpl = fetchCompat) {
    this.url = url;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.nextId = 1;
  }

  async request(method, params = {}) {
    if (!this.apiKey) {
      throw new Error("AMOS_API_KEY is not configured");
    }

    const id = this.nextId++;
    const response = await this.fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params
      })
    });

    const text = await response.text();
    const contentType = response.headers?.get?.("content-type") || "";
    const payload = parseMcpHttpBody(text, contentType);

    if (!response.ok) {
      throw new Error(payload?.error?.message || text || `MCP request failed with ${response.status}`);
    }

    if (payload.error) {
      throw new Error(payload.error.message || JSON.stringify(payload.error));
    }

    return payload.result;
  }

  listTools() {
    return this.request("tools/list");
  }

  callTool(name, args = {}) {
    return this.request("tools/call", {
      name,
      arguments: args
    });
  }
}
