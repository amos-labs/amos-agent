import { homedir, totalmem, freemem, arch, platform, release } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfig } from "../config.js";
import { AmosOAuthSession } from "../auth/oauth.js";
import { FileTokenStore } from "../auth/tokenStore.js";
import { listModelProviders } from "../model/providers.js";
import { createRuntime, shouldUseOAuth } from "../runtime.js";
import { DesktopApprovalBridge } from "./approvalBridge.js";

export class DesktopController {
  constructor({ userDataPath, settingsStore, openBrowser, emit }) {
    this.userDataPath = userDataPath;
    this.settingsStore = settingsStore;
    this.openBrowser = openBrowser;
    this.emit = emit;
    this.runtime = null;
    this.activity = [];
    this.approvals = new DesktopApprovalBridge({
      onRequest: (request) => this.send("approval:requested", request)
    });
  }

  async state() {
    const settings = await this.settingsStore.read();
    const oauth = this.oauthFor(settings);
    const credentials = await oauth.status();
    const config = this.configFrom(settings);
    return {
      configured: validateConfig(config).length === 0,
      connected: shouldUseOAuth(config, credentials) || Boolean(config.amos.apiKey),
      provider: publicProvider(config.model),
      providers: listModelProviders(),
      settings: redactSettings(settings),
      system: systemProfile(),
      activity: this.activity.slice(-100)
    };
  }

  async saveSettings(settings) {
    const current = await this.settingsStore.read();
    const saved = await this.settingsStore.write({
      ...current,
      ...settings,
      apiKey: settings.apiKey === undefined ? current.apiKey : settings.apiKey
    });
    this.resetRuntime();
    this.record("settings", `Intelligence set to ${saved.provider} · ${saved.model}`);
    return this.state();
  }

  async chooseWorkspace(path) {
    return this.saveSettings({ workspace: path });
  }

  async login() {
    const settings = await this.settingsStore.read();
    const oauth = this.oauthFor(settings);
    await oauth.login({
      openBrowser: true,
      onAuthorize: ({ url }) => this.send("auth:browser", { url })
    });
    this.resetRuntime();
    this.record("auth", "AMOS account connected");
    return this.state();
  }

  async logout() {
    const settings = await this.settingsStore.read();
    await this.oauthFor(settings).logout();
    this.resetRuntime();
    this.record("auth", "AMOS account disconnected");
    return this.state();
  }

  async testModel() {
    const { runtime, config } = await this.getRuntime({ requireAmos: false });
    const result = await runtime.modelClient.chat({
      messages: [
        { role: "system", content: "Return exactly: AMOS intelligence ready" },
        { role: "user", content: "Connection test" }
      ]
    });
    this.record("model", `${config.model.displayName} responded successfully`, result.usage);
    return { ok: true, message: result.message.content || "AMOS intelligence ready", usage: result.usage };
  }

  async run(text) {
    const prompt = String(text || "").trim();
    if (!prompt) throw new Error("Enter a task for AMOS");
    const { runtime } = await this.getRuntime({ requireAmos: true });
    this.record("user", prompt);
    this.send("agent:status", { running: true });
    try {
      const answer = await runtime.loop.run(prompt, {
        onEvent: (event) => {
          const safeEvent = sanitizeAgentEvent(event);
          this.record("tool", toolEventSummary(safeEvent), safeEvent);
          this.send("agent:event", safeEvent);
        }
      });
      this.record("assistant", answer);
      return { answer, activity: this.activity.slice(-100) };
    } finally {
      this.send("agent:status", { running: false });
    }
  }

  resolveApproval(id, approved) {
    return { resolved: this.approvals.resolve(id, approved) };
  }

  async clear() {
    if (this.runtime) this.runtime.loop.clear();
    this.activity = [];
    this.send("activity:changed", []);
    return { ok: true };
  }

  resetRuntime() {
    this.approvals.cancelAll();
    this.runtime = null;
  }

  async getRuntime({ requireAmos }) {
    if (this.runtime) return this.runtime;
    const settings = await this.settingsStore.read();
    const config = this.configFrom(settings);
    const missing = validateConfig(config);
    if (missing.length > 0) {
      throw new Error(`Finish intelligence setup: ${missing.join(", ")}`);
    }
    const oauth = this.oauthFor(settings);
    const credentials = await oauth.status();
    const useOAuth = shouldUseOAuth(config, credentials);
    if (requireAmos && !useOAuth && !config.amos.apiKey) {
      throw new Error("Connect AMOS before running company tasks");
    }
    this.runtime = {
      config,
      oauth,
      runtime: createRuntime({ config, approvals: this.approvals, oauth, useOAuth })
    };
    return this.runtime;
  }

  configFrom(settings) {
    const env = {
      ...process.env,
      AMOS_MODEL_PROVIDER: settings.provider,
      AMOS_MODEL: settings.model,
      AMOS_MODEL_BASE_URL: settings.baseUrl,
      AMOS_MODEL_API_KEY: settings.apiKey,
      AMOS_MODEL_REASONING_EFFORT: settings.reasoningEffort,
      AMOS_AGENT_WORKSPACE: settings.workspace || homedir(),
      AMOS_MCP_URL: settings.amosMcpUrl
    };
    return loadConfig(env, settings.workspace || homedir());
  }

  oauthFor(settings) {
    return new AmosOAuthSession({
      mcpUrl: settings.amosMcpUrl,
      store: new FileTokenStore(join(this.userDataPath, "oauth.json")),
      openBrowser: (url) => {
        this.openBrowser(url);
        return true;
      }
    });
  }

  record(type, summary, detail = null) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      summary: String(summary || ""),
      detail,
      at: new Date().toISOString()
    };
    this.activity.push(item);
    if (this.activity.length > 250) this.activity.shift();
    this.send("activity:changed", this.activity.slice(-100));
  }

  send(channel, payload) {
    this.emit(channel, payload);
  }
}

function redactSettings(settings) {
  return {
    ...settings,
    apiKey: "",
    hasApiKey: Boolean(settings.apiKey)
  };
}

function publicProvider(config) {
  return {
    id: config.provider,
    displayName: config.displayName,
    deployment: config.deployment,
    model: config.model,
    baseUrl: config.baseUrl
  };
}

function systemProfile() {
  const memoryGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    memoryGb,
    freeMemoryGb: Math.round((freemem() / 1024 ** 3) * 10) / 10,
    localRecommendation:
      memoryGb >= 48
        ? "This computer can run capable quantized local models."
        : memoryGb >= 24
          ? "This computer can run smaller local models; managed intelligence is recommended for complex work."
          : "Use AMOS-hosted or Bedrock intelligence for company operations."
  };
}

function sanitizeAgentEvent(event) {
  if (event.type === "tool_start") {
    return { type: event.type, name: event.name, args: event.args };
  }
  if (event.type === "tool_error") {
    return { type: event.type, name: event.name, error: event.error };
  }
  return {
    type: event.type,
    name: event.name,
    result: summarizeResult(event.result)
  };
}

function summarizeResult(result) {
  const encoded = JSON.stringify(result);
  if (encoded.length <= 4000) return result;
  return { truncated: true, preview: encoded.slice(0, 4000) };
}

function toolEventSummary(event) {
  if (event.type === "tool_start") return `Started ${event.name}`;
  if (event.type === "tool_error") return `${event.name} failed: ${event.error}`;
  return `Completed ${event.name}`;
}
