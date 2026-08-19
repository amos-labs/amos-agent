import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { cpus, homedir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  MTPLX_QWEN38_MODEL_ID,
  MTPLX_QWEN38_QUALIFICATION,
  MTPLX_RUNTIME_RELEASE,
  MTPLX_SERVED_MODEL_ID,
  mtplxArtifactDirectoryName,
  mtplxModelProfile
} from "./mtplxRuntimeManifest.js";

export const AMOS_MTPLX_HOST = "127.0.0.1:18081";
export const AMOS_MTPLX_CONTEXT_LENGTH = 32_768;
const STARTUP_TIMEOUT_MS = 5 * 60_000;
const RETRY_MS = 500;

export class ManagedMtplxRuntime {
  constructor({
    platform = process.platform,
    arch = process.arch,
    cpuModel = cpus()[0]?.model || "",
    resourcesPath,
    userDataPath,
    homePath = homedir(),
    binaryPath = process.env.AMOS_MTPLX_BINARY || "",
    modelPath = process.env.AMOS_MTPLX_MODEL || "",
    modelRepository = process.env.AMOS_MTPLX_MODEL_REPOSITORY || "",
    host = AMOS_MTPLX_HOST,
    spawnImpl = spawn,
    versionCheckImpl = null,
    fetchImpl = globalThis.fetch,
    existsImpl = existsSync,
    mkdirImpl = mkdir,
    environment = process.env,
    totalMemoryBytes = totalmem(),
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    retryMs = RETRY_MS,
    sleepImpl = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
    emit = () => {}
  } = {}) {
    if (!resourcesPath) throw new Error("MTPLX requires a resources path");
    if (!userDataPath) throw new Error("MTPLX requires a user-data path");
    this.platform = platform;
    this.arch = arch;
    this.cpuModel = String(cpuModel || "");
    this.resourcesPath = resolve(resourcesPath);
    this.userDataPath = resolve(userDataPath);
    this.homePath = resolve(homePath);
    this.host = cleanHost(host);
    this.spawn = spawnImpl;
    this.versionCheck = versionCheckImpl || (() => readRuntimeVersion(this.binaryPath));
    this.fetch = fetchImpl;
    this.exists = existsImpl;
    this.mkdir = mkdirImpl;
    this.environment = environment;
    this.totalMemoryBytes = Math.max(0, Number(totalMemoryBytes) || 0);
    this.startupTimeoutMs = Math.max(0, Number(startupTimeoutMs) || 0);
    this.retryMs = Math.max(10, Number(retryMs) || RETRY_MS);
    this.sleep = sleepImpl;
    this.emit = emit;
    this.overrideBinaryPath = binaryPath ? resolve(binaryPath) : "";
    this.overrideModelPath = modelPath ? resolve(modelPath) : "";
    this.overrideRepository = String(modelRepository || "").trim();
    this.child = null;
    this.startPromise = null;
    this.lifecycleGeneration = 0;
    this.lifecycle = "stopped";
    this.error = null;
    this.lastOutput = "";
    this.activeModelId = null;
    this.startedAt = null;
    this.readyAt = null;
    this.lastRestore = null;
    this.verifiedVersion = null;
  }

  get baseUrl() {
    return `http://${this.host}`;
  }

  get openAiBaseUrl() {
    return `${this.baseUrl}/v1`;
  }

  get cachePath() {
    return join(this.userDataPath, "local-intelligence", "mtplx", "cache");
  }

  get sessionCachePath() {
    return join(this.userDataPath, "local-intelligence", "mtplx", "sessions");
  }

  get profile() {
    const selected = mtplxModelProfile({
      platform: this.platform,
      arch: this.arch,
      cpuModel: this.cpuModel
    });
    if (!selected) return null;
    return this.overrideRepository
      ? { ...selected, repository: this.overrideRepository }
      : selected;
  }

  get binaryPath() {
    const candidates = this.binaryCandidates();
    return candidates.find((candidate) => this.exists(candidate)) || candidates[0];
  }

  get modelPath() {
    if (this.overrideModelPath) return this.overrideModelPath;
    const profile = this.profile;
    if (!profile) return "";
    const artifact = mtplxArtifactDirectoryName(profile.repository);
    const candidates = [
      join(this.userDataPath, "local-intelligence", "mtplx", "models", artifact),
      join(this.homePath, ".mtplx", "models", artifact)
    ];
    return candidates.find((candidate) => this.exists(candidate)) || candidates[0];
  }

  supportsModel(modelId) {
    return String(modelId || "") === MTPLX_QWEN38_MODEL_ID;
  }

  state() {
    const supported = Boolean(this.profile);
    const binaryPath = this.binaryPath;
    const runtimeInstalled = supported && this.exists(binaryPath);
    const modelPath = this.modelPath;
    const artifactInstalled = supported && Boolean(modelPath) && this.exists(modelPath);
    const memoryGb = this.totalMemoryBytes / 1024 ** 3;
    const memoryEligible = memoryGb >= Number(this.profile?.minimumMemoryGb || Infinity);
    const available = runtimeInstalled && artifactInstalled && memoryEligible;
    return {
      id: "mtplx",
      name: "MTPLX Preview",
      supported,
      available,
      runtimeInstalled,
      artifactInstalled,
      memoryEligible,
      source: this.overrideBinaryPath
        ? "override"
        : binaryPath.startsWith(join(this.resourcesPath, "mtplx"))
          ? "bundled"
          : binaryPath.startsWith(join(this.userDataPath, "local-intelligence"))
            ? "managed"
            : runtimeInstalled
              ? "user"
              : "missing",
      status: available ? this.lifecycle : supported ? "unavailable" : "unsupported",
      version: this.verifiedVersion,
      requiredVersion: MTPLX_RUNTIME_RELEASE.version,
      baseUrl: this.baseUrl,
      openAiBaseUrl: this.openAiBaseUrl,
      modelId: MTPLX_SERVED_MODEL_ID,
      sourceModelId: MTPLX_QWEN38_MODEL_ID,
      modelRepository: this.profile?.repository || null,
      modelProfile: this.profile?.id || null,
      precision: this.profile?.precision || null,
      mtpDepth: this.profile?.mtpDepth || null,
      contextLength: AMOS_MTPLX_CONTEXT_LENGTH,
      persistentSessionCache: true,
      qualification: this.profile?.id === MTPLX_QWEN38_QUALIFICATION.modelProfile
        ? structuredClone(MTPLX_QWEN38_QUALIFICATION)
        : null,
      lastRestore: this.lastRestore ? { ...this.lastRestore } : null,
      startedAt: this.startedAt,
      readyAt: this.readyAt,
      error: this.error || unavailableReason({
        supported,
        runtimeInstalled,
        artifactInstalled,
        memoryEligible,
        profile: this.profile,
        platform: this.platform,
        arch: this.arch
      })
    };
  }

  async start(modelId = MTPLX_QWEN38_MODEL_ID) {
    if (!this.supportsModel(modelId)) throw new Error("MTPLX Preview only accelerates AMOS Local · Capable");
    const current = this.state();
    if (!current.available) throw new Error(current.error || "MTPLX Preview is unavailable");
    if (this.lifecycle === "ready" && this.activeModelId === modelId) return this.publish();
    if (this.startPromise) return this.startPromise;
    const startPromise = this.startRuntime(modelId);
    this.startPromise = startPromise;
    return startPromise.finally(() => {
      if (this.startPromise === startPromise) this.startPromise = null;
    });
  }

  async startRuntime(modelId) {
    if (this.child) await this.stop();
    const generation = ++this.lifecycleGeneration;
    let version;
    try {
      version = await this.versionCheck();
      if (version !== MTPLX_RUNTIME_RELEASE.version) {
        throw new Error(
          `MTPLX Preview requires ${MTPLX_RUNTIME_RELEASE.version}; found ${version || "an unknown version"}`
        );
      }
    } catch (error) {
      this.lifecycle = "failed";
      this.error = safeMessage(error);
      this.publish();
      throw error;
    }
    this.verifiedVersion = version;
    await Promise.all([
      this.mkdir(this.cachePath, { recursive: true }),
      this.mkdir(this.sessionCachePath, { recursive: true })
    ]);
    this.lifecycle = "starting";
    this.error = null;
    this.lastOutput = "";
    this.activeModelId = modelId;
    this.startedAt = new Date().toISOString();
    this.readyAt = null;
    const child = this.spawn(this.binaryPath, this.launchArguments(), {
      cwd: dirname(this.binaryPath),
      env: { ...this.environment },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;
    const capture = (chunk) => {
      this.lastOutput = `${this.lastOutput}${String(chunk || "")}`.slice(-4_000);
    };
    child.stdout?.on?.("data", capture);
    child.stderr?.on?.("data", capture);
    child.once?.("error", (error) => this.handleChildFailure(child, error));
    child.once?.("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.lifecycle === "stopping" || this.lifecycle === "sleeping") return;
      this.lifecycle = "failed";
      this.error = `MTPLX stopped unexpectedly (${signal || code || "unknown"}): ${safeMessage(this.lastOutput)}`;
      this.publish();
    });
    this.publish();
    try {
      await this.waitUntilReady(generation);
      this.lifecycle = "ready";
      this.readyAt = new Date().toISOString();
      this.error = null;
      return this.publish();
    } catch (error) {
      if (generation !== this.lifecycleGeneration || this.lifecycle === "sleeping") {
        throw new Error("MTPLX startup was cancelled for system sleep");
      }
      this.lifecycle = "failed";
      this.error = `MTPLX could not become ready: ${safeMessage(error)}${this.lastOutput ? ` · ${safeMessage(this.lastOutput)}` : ""}`;
      child.kill?.();
      if (this.child === child) this.child = null;
      this.publish();
      throw new Error(this.error);
    }
  }

  async waitUntilReady(generation) {
    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError = null;
    do {
      if (generation !== this.lifecycleGeneration || this.lifecycle === "sleeping") {
        throw new Error("MTPLX startup cancelled");
      }
      if (this.lifecycle === "failed" || !this.child) {
        throw new Error(this.error || "MTPLX stopped during startup");
      }
      try {
        const response = await this.fetch(`${this.openAiBaseUrl}/models`, {
          signal: AbortSignal.timeout(Math.min(5_000, Math.max(100, this.startupTimeoutMs)))
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const models = Array.isArray(payload?.data) ? payload.data : [];
        if (models.some((model) => model?.id === MTPLX_SERVED_MODEL_ID)) return payload;
        lastError = new Error("the expected model is not served");
      } catch (error) {
        lastError = error;
      }
      if (this.lifecycle === "failed" || !this.child) {
        throw new Error(this.error || "MTPLX stopped during startup");
      }
      if (Date.now() >= deadline) break;
      await this.sleep(Math.min(this.retryMs, Math.max(0, deadline - Date.now())));
    } while (Date.now() <= deadline);
    throw lastError || new Error("startup timed out");
  }

  launchArguments() {
    return [
      "quickstart",
      "--model", this.modelPath,
      "--cache-dir", this.cachePath,
      "--profile", "turbo",
      "--host", this.host.split(":")[0],
      "--port", this.host.split(":")[1],
      "--model-id", MTPLX_SERVED_MODEL_ID,
      "--depth", String(this.profile?.mtpDepth || 2),
      "--mtp",
      "--batching-preset", "solo",
      "--ssd-session-cache", "on",
      "--ssd-session-cache-dir", this.sessionCachePath,
      "--ssd-session-cache-max-size", "12GB",
      "--ssd-session-cache-min-prefix-tokens", "256",
      "--paged-kv-quantization", "off",
      "--reasoning", "auto",
      "--reasoning-effort", "medium",
      "--tool-prompt-mode", "native",
      "--stream-interval", "1",
      "--no-stats-footer",
      "--warmup-tokens", "8"
    ];
  }

  recordCacheTelemetry(stats = {}) {
    if (stats.ssd_cache_hit !== true && !Number.isFinite(Number(stats.ssd_restore_s))) return;
    this.lastRestore = {
      hit: stats.ssd_cache_hit === true,
      seconds: Math.max(0, Number(stats.ssd_restore_s) || 0),
      observedAt: new Date().toISOString()
    };
    this.publish();
  }

  async suspend() {
    this.lifecycleGeneration += 1;
    this.startPromise = null;
    if (!this.child) {
      this.lifecycle = "sleeping";
      return this.publish();
    }
    this.lifecycle = "sleeping";
    this.publish();
    const child = this.child;
    this.child = null;
    child.kill?.();
    return this.publish();
  }

  async stop() {
    this.lifecycleGeneration += 1;
    this.startPromise = null;
    const child = this.child;
    this.child = null;
    this.lifecycle = "stopping";
    if (child) child.kill?.();
    this.lifecycle = "stopped";
    this.activeModelId = null;
    return this.publish();
  }

  publish() {
    const state = this.state();
    this.emit(state);
    return state;
  }

  binaryCandidates() {
    return [
      ...(this.overrideBinaryPath ? [this.overrideBinaryPath] : []),
      join(this.resourcesPath, "mtplx", "bin", "mtplx"),
      join(this.userDataPath, "local-intelligence", "mtplx", "runtime", "bin", "mtplx"),
      join(this.homePath, ".local", "bin", "mtplx"),
      "/opt/homebrew/bin/mtplx",
      "/usr/local/bin/mtplx"
    ];
  }

  handleChildFailure(child, error) {
    if (this.child !== child) return;
    this.child = null;
    this.lifecycle = "failed";
    this.error = `MTPLX could not start: ${safeMessage(error)}`;
    this.publish();
  }
}

function unavailableReason({ supported, runtimeInstalled, artifactInstalled, memoryEligible, profile, platform, arch }) {
  if (!supported) return `MTPLX Preview requires Apple Silicon; this computer is ${platform}-${arch}.`;
  if (!runtimeInstalled) return "Install MTPLX 2.8.3 or set AMOS_MTPLX_BINARY to enable the preview.";
  if (!artifactInstalled) return `Download ${profile.repository} with MTPLX to enable the preview.`;
  if (!memoryEligible) return `MTPLX Preview needs at least ${profile.minimumMemoryGb} GB unified memory.`;
  return null;
}

function cleanHost(value) {
  const host = String(value || "").trim();
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(host)) {
    throw new Error("MTPLX must bind to an explicit IPv4 loopback port");
  }
  const port = Number(host.split(":").at(-1));
  if (port < 1_024 || port > 65_535) throw new Error("MTPLX requires a non-privileged loopback port");
  return host;
}

function safeMessage(error) {
  return String(error?.message || error || "unknown error").replace(/\s+/g, " ").trim().slice(0, 500);
}

function readRuntimeVersion(binaryPath) {
  return new Promise((resolveVersion, rejectVersion) => {
    execFile(binaryPath, ["--version"], {
      timeout: 10_000,
      maxBuffer: 16_384,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        rejectVersion(new Error(`MTPLX version check failed: ${safeMessage(stderr || error)}`));
        return;
      }
      const match = `${stdout || ""}\n${stderr || ""}`.match(/\b(\d+\.\d+\.\d+)\b/);
      resolveVersion(match?.[1] || "");
    });
  });
}
