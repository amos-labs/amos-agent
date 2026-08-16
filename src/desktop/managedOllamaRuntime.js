import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { OLLAMA_RUNTIME_RELEASE, ollamaRuntimeAsset } from "./ollamaRuntimeManifest.js";

export const AMOS_LOCAL_HOST = "127.0.0.1:11435";
export const AMOS_LOCAL_DEFAULT_CONTEXT_LENGTH = 32_768;
export const AMOS_LOCAL_MAX_CONTEXT_LENGTH = 262_144;
export const AMOS_LOCAL_DEFAULT_KEEP_ALIVE = "30m";
const MODEL_CREATE_TIMEOUT_MS = 5 * 60_000;

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
    totalMemoryBytes = totalmem(),
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
    this.totalMemoryBytes = Math.max(0, Number(totalMemoryBytes) || 0);
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
      contextLength: contextLength(
        this.environment.AMOS_LOCAL_CONTEXT_LENGTH,
        this.totalMemoryBytes
      ),
      performance: runtimePerformanceSettings(this.environment),
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
      env: this.runtimeEnvironment(),
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

  async createModel({ model, modelfilePath }) {
    const name = String(model || "").trim();
    const filePath = resolve(String(modelfilePath || ""));
    if (!/^[a-z0-9._/-]+:[a-z0-9._-]+$/i.test(name)) {
      throw new Error("AMOS Local router model name is invalid");
    }
    if (!this.exists(filePath)) {
      throw new Error("AMOS Local router Modelfile is missing from this build");
    }
    if (!this.state().installed) {
      throw new Error("AMOS Local runtime is unavailable");
    }
    await Promise.all([
      this.mkdir(this.modelsPath, { recursive: true }),
      this.mkdir(this.runtimeHomePath, { recursive: true })
    ]);
    return new Promise((resolveCreate, rejectCreate) => {
      let stderr = "";
      let settled = false;
      let timeout = null;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        callback(value);
      };
      const child = this.spawn(this.binaryPath, ["create", name, "-f", filePath], {
        cwd: dirname(filePath),
        env: this.runtimeEnvironment(),
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true
      });
      timeout = setTimeout(() => {
        child.kill?.();
        finish(rejectCreate, new Error("AMOS Local router installation timed out"));
      }, MODEL_CREATE_TIMEOUT_MS);
      timeout.unref?.();
      child.stderr?.on?.("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-2_000);
      });
      child.once?.("error", (error) => {
        finish(
          rejectCreate,
          new Error(`AMOS Local router installation failed: ${safeMessage(error)}`)
        );
      });
      child.once?.("exit", (code) => {
        if (code === 0) finish(resolveCreate, { model: name, installed: true });
        else {
          finish(
            rejectCreate,
            new Error(
              `AMOS Local router installation failed (${code ?? "unknown"}): ${safeMessage(stderr)}`
            )
          );
        }
      });
    });
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

  runtimeEnvironment() {
    return {
      ...this.environment,
      OLLAMA_HOST: this.host,
      OLLAMA_MODELS: this.modelsPath,
      OLLAMA_NO_CLOUD: "1",
      OLLAMA_CONTEXT_LENGTH: String(
        contextLength(this.environment.AMOS_LOCAL_CONTEXT_LENGTH, this.totalMemoryBytes)
      ),
      OLLAMA_KEEP_ALIVE: keepAlive(this.environment.AMOS_LOCAL_KEEP_ALIVE),
      OLLAMA_FLASH_ATTENTION: booleanEnvironment(
        this.environment.AMOS_LOCAL_FLASH_ATTENTION,
        true
      ) ? "1" : "0",
      OLLAMA_KV_CACHE_TYPE: kvCacheType(this.environment.AMOS_LOCAL_KV_CACHE_TYPE),
      OLLAMA_NUM_PARALLEL: String(positiveInteger(
        this.environment.AMOS_LOCAL_NUM_PARALLEL,
        1,
        1,
        8
      )),
      OLLAMA_MAX_LOADED_MODELS: String(positiveInteger(
        this.environment.AMOS_LOCAL_MAX_LOADED_MODELS,
        2,
        1,
        8
      )),
      HOME: this.runtimeHomePath,
      ...(this.platform === "win32" ? { USERPROFILE: this.runtimeHomePath } : {})
    };
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

export function contextLength(value, totalMemoryBytes = 0) {
  const parsed = Number(value);
  if (
    Number.isInteger(parsed) &&
    parsed >= 4_096 &&
    parsed <= AMOS_LOCAL_MAX_CONTEXT_LENGTH
  ) {
    return parsed;
  }
  const memoryGb = Math.max(0, Number(totalMemoryBytes) || 0) / 1024 ** 3;
  if (memoryGb >= 96) return 65_536;
  if (memoryGb >= 24) return AMOS_LOCAL_DEFAULT_CONTEXT_LENGTH;
  if (memoryGb >= 16) return AMOS_LOCAL_DEFAULT_CONTEXT_LENGTH;
  return 16_384;
}

function runtimePerformanceSettings(environment = {}) {
  return {
    keepAlive: keepAlive(environment.AMOS_LOCAL_KEEP_ALIVE),
    flashAttention: booleanEnvironment(environment.AMOS_LOCAL_FLASH_ATTENTION, true),
    kvCacheType: kvCacheType(environment.AMOS_LOCAL_KV_CACHE_TYPE),
    parallelRequests: positiveInteger(environment.AMOS_LOCAL_NUM_PARALLEL, 1, 1, 8),
    maxLoadedModels: positiveInteger(environment.AMOS_LOCAL_MAX_LOADED_MODELS, 2, 1, 8)
  };
}

function keepAlive(value) {
  const requested = String(value || "").trim().toLowerCase();
  return /^(?:-1|0|\d+(?:ms|s|m|h))$/.test(requested)
    ? requested
    : AMOS_LOCAL_DEFAULT_KEEP_ALIVE;
}

function kvCacheType(value) {
  const requested = String(value || "").trim().toLowerCase();
  return ["f16", "q8_0", "q4_0"].includes(requested) ? requested : "q8_0";
}

function booleanEnvironment(value, fallback) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
