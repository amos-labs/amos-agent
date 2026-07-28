import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { OLLAMA_RUNTIME_RELEASE, ollamaRuntimeAsset } from "./ollamaRuntimeManifest.js";

export const AMOS_LOCAL_HOST = "127.0.0.1:11435";

export class ManagedOllamaRuntime {
  constructor({
    platform = process.platform,
    arch = process.arch,
    resourcesPath,
    userDataPath,
    binaryPath = process.env.AMOS_OLLAMA_BINARY || "",
    host = AMOS_LOCAL_HOST,
    spawnImpl = spawn,
    existsImpl = existsSync,
    mkdirImpl = mkdir,
    environment = process.env,
    emit = () => {}
  } = {}) {
    if (!resourcesPath) throw new Error("AMOS Local requires a resources path");
    if (!userDataPath) throw new Error("AMOS Local requires a user-data path");
    this.platform = platform;
    this.arch = arch;
    this.resourcesPath = resolve(resourcesPath);
    this.userDataPath = resolve(userDataPath);
    this.host = cleanHost(host);
    this.spawn = spawnImpl;
    this.exists = existsImpl;
    this.mkdir = mkdirImpl;
    this.environment = environment;
    this.emit = emit;
    this.overrideBinaryPath = binaryPath ? resolve(binaryPath) : "";
    this.child = null;
    this.lifecycle = "stopped";
    this.error = null;
  }

  get baseUrl() {
    return `http://${this.host}`;
  }

  get openAiBaseUrl() {
    return `${this.baseUrl}/v1`;
  }

  get modelsPath() {
    return join(this.userDataPath, "local-intelligence", "ollama", "models");
  }

  get runtimeHomePath() {
    return join(this.userDataPath, "local-intelligence", "ollama", "home");
  }

  get binaryPath() {
    if (this.overrideBinaryPath) return this.overrideBinaryPath;
    let binary = this.platform === "win32" ? "ollama.exe" : "ollama";
    try {
      binary = ollamaRuntimeAsset(this.platform, this.arch).binary;
    } catch {
      // State will report this platform as unsupported below.
    }
    return join(this.resourcesPath, "ollama", binary);
  }

  state() {
    const supported = Boolean(this.overrideBinaryPath) || supportsRuntime(this.platform, this.arch);
    const installed = supported && this.exists(this.binaryPath);
    return {
      managed: true,
      installed,
      source: this.overrideBinaryPath ? "override" : installed ? "bundled" : "missing",
      status: installed ? this.lifecycle : supported ? "missing" : "unsupported",
      version: installed ? OLLAMA_RUNTIME_RELEASE.version : null,
      baseUrl: this.baseUrl,
      error: this.error || (
        supported
          ? installed
            ? null
            : "This build is missing the AMOS Local runtime component."
          : `AMOS Local is not available for ${this.platform}-${this.arch}.`
      )
    };
  }

  async start() {
    const current = this.state();
    if (!current.installed) return this.publish();
    if (this.child && this.lifecycle !== "failed") return this.publish();

    await Promise.all([
      this.mkdir(this.modelsPath, { recursive: true }),
      this.mkdir(this.runtimeHomePath, { recursive: true })
    ]);
    this.lifecycle = "starting";
    this.error = null;
    const runtimeDirectory = dirname(this.binaryPath);
    const child = this.spawn(this.binaryPath, ["serve"], {
      cwd: runtimeDirectory,
      env: {
        ...this.environment,
        OLLAMA_HOST: this.host,
        OLLAMA_MODELS: this.modelsPath,
        OLLAMA_NO_CLOUD: "1",
        HOME: this.runtimeHomePath,
        ...(this.platform === "win32" ? { USERPROFILE: this.runtimeHomePath } : {})
      },
      stdio: "ignore",
      windowsHide: true
    });
    this.child = child;
    child.once?.("spawn", () => {
      if (this.child !== child) return;
      this.lifecycle = "starting";
      this.publish();
    });
    child.once?.("error", (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.lifecycle = "failed";
      this.error = `AMOS Local could not start: ${safeMessage(error)}`;
      this.publish();
    });
    child.once?.("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.lifecycle === "stopping") {
        this.lifecycle = "stopped";
        this.error = null;
      } else {
        this.lifecycle = "failed";
        this.error = `AMOS Local stopped unexpectedly (${signal || code || "unknown"}).`;
      }
      this.publish();
    });
    return this.publish();
  }

  markReady() {
    if (this.state().installed) {
      this.lifecycle = "ready";
      this.error = null;
    }
    return this.publish();
  }

  async stop() {
    const child = this.child;
    if (!child) {
      this.lifecycle = "stopped";
      return this.publish();
    }
    this.lifecycle = "stopping";
    this.publish();
    child.kill?.();
    return this.state();
  }

  publish() {
    const state = this.state();
    this.emit(state);
    return state;
  }
}

function supportsRuntime(platform, arch) {
  try {
    ollamaRuntimeAsset(platform, arch);
    return true;
  } catch {
    return false;
  }
}

function cleanHost(value) {
  const host = String(value || "").trim();
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(host)) {
    throw new Error("AMOS Local must bind to an explicit IPv4 loopback port");
  }
  const port = Number(host.split(":").at(-1));
  if (port < 1_024 || port > 65_535) {
    throw new Error("AMOS Local requires a non-privileged loopback port");
  }
  return host;
}

function safeMessage(error) {
  return String(error?.message || error || "unknown error").replace(/\s+/g, " ").slice(0, 300);
}
