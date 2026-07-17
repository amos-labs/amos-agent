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
  constructor({ url, mcpUrl, apiKey, getAccessToken, requestTimeoutMs = 30_000 }, fetchImpl = fetchCompat) {
    this.url = url || mcpUrl;
    this.apiKey = apiKey;
    this.getAccessToken = getAccessToken;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetch = fetchImpl;
    this.nextId = 1;
  }

  async request(method, params = {}) {
    if (!this.url) {
      throw new Error("AMOS_MCP_URL is not configured");
    }

    const id = this.nextId++;
    let token = this.apiKey || (await this.getAccessToken?.());
    if (!token) throw new Error("AMOS is not connected. Run `amos-agent login` first.");

    let response = await this.send({ id, method, params, token });
    if (response.status === 401 && !this.apiKey && this.getAccessToken) {
      token = await this.getAccessToken({ forceRefresh: true });
      response = await this.send({ id, method, params, token });
    }

    const text = await response.text();
    const contentType = response.headers?.get?.("content-type") || "";
    let payload = {};
    try {
      payload = parseMcpHttpBody(text, contentType);
    } catch {
      if (!response.ok) throw new Error(text || `MCP request failed with ${response.status}`);
      throw new Error("AMOS MCP returned an invalid response");
    }

    if (!response.ok) {
      throw new Error(payload?.error?.message || text || `MCP request failed with ${response.status}`);
    }

    if (payload.error) {
      throw new Error(payload.error.message || JSON.stringify(payload.error));
    }

    return payload.result;
  }

  async send({ id, method, params, token }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params
      })
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("AMOS MCP request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
