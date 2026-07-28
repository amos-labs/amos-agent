import { createHash } from "node:crypto";

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const REQUEST_TIMEOUT_MS = 5_000;
const RUNTIME_STARTUP_TIMEOUT_MS = 10_000;
const RUNTIME_RETRY_MS = 250;

// This catalog ships inside the signed AMOS Desktop application bundle. Its
// integrity is therefore covered by the same Developer ID signature and
// notarization gate as the executable that consumes it.
export const OFFLINE_MODEL_MANIFEST = Object.freeze({
  version: 1,
  trust: "release-signed",
  runtime: "ollama",
  updatedAt: "2026-07-26T00:00:00.000Z",
  models: Object.freeze([
    Object.freeze({
      id: "qwen3:4b",
      name: "AMOS Local · Compact",
      description: "Fast private drafting, summarization, and lightweight workspace tasks.",
      approximateSizeBytes: 2_600_000_000,
      minimumMemoryGb: 8,
      recommendedMemoryGb: 12,
      capabilities: Object.freeze(["text", "tools", "code", "reasoning"])
    }),
    Object.freeze({
      id: "qwen3:8b",
      name: "AMOS Local · Balanced",
      description: "Stronger local reasoning and coding for modern laptops with more memory.",
      approximateSizeBytes: 5_200_000_000,
      minimumMemoryGb: 12,
      recommendedMemoryGb: 16,
      capabilities: Object.freeze(["text", "tools", "code", "reasoning"])
    }),
    Object.freeze({
      id: "gpt-oss:20b",
      name: "AMOS Local · Capable",
      description: "Agentic local work for higher-memory systems; managed intelligence still handles the hardest tasks.",
      approximateSizeBytes: 14_000_000_000,
      minimumMemoryGb: 16,
      recommendedMemoryGb: 24,
      capabilities: Object.freeze(["text", "tools", "code", "reasoning"])
    })
  ])
});

export function assessHardware({
  platform,
  release,
  arch,
  memoryGb,
  freeMemoryGb
}) {
  const total = finiteNumber(memoryGb);
  const free = finiteNumber(freeMemoryGb);
  const candidates = OFFLINE_MODEL_MANIFEST.models
    .filter((model) => total >= model.minimumMemoryGb)
    .sort((left, right) => right.recommendedMemoryGb - left.recommendedMemoryGb);
  const recommended = candidates.find((model) => total >= model.recommendedMemoryGb) || candidates.at(-1) || null;

  return {
    platform: String(platform || ""),
    release: String(release || ""),
    arch: String(arch || ""),
    memoryGb: total,
    freeMemoryGb: free,
    localTier:
      total >= 24
        ? "capable"
        : total >= 12
          ? "balanced"
          : total >= 8
            ? "compact"
            : "managed-recommended",
    recommendedModelId: recommended?.id || null,
    localRecommendation: recommended
      ? `${recommended.name} is the recommended offline profile for this computer.`
      : "Use AMOS-hosted or customer-cloud intelligence on this computer."
  };
}

export function releaseSignedManifest() {
  const manifest = structuredClone(OFFLINE_MODEL_MANIFEST);
  return {
    ...manifest,
    digest: createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
  };
}

export class OllamaModelManager {
  constructor({
    fetchImpl = globalThis.fetch,
    baseUrl = OLLAMA_BASE_URL,
    emit = () => {},
    runtimeManager = null,
    startupTimeoutMs = RUNTIME_STARTUP_TIMEOUT_MS,
    retryMs = RUNTIME_RETRY_MS,
    sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  } = {}) {
    this.fetch = fetchImpl;
    this.runtimeManager = runtimeManager;
    this.baseUrl = String(runtimeManager?.baseUrl || baseUrl).replace(/\/$/, "");
    this.emit = emit;
    this.startupTimeoutMs = Math.max(0, Number(startupTimeoutMs) || 0);
    this.retryMs = Math.max(10, Number(retryMs) || RUNTIME_RETRY_MS);
    this.sleep = sleepImpl;
    this.runtime = {
      available: false,
      version: null,
      checkedAt: null,
      error: null,
      ...(runtimeManager?.state?.() || {})
    };
    this.installed = [];
    this.downloads = new Map();
  }

  state(system = null) {
    const manifest = releaseSignedManifest();
    const installedByName = new Map(this.installed.map((model) => [model.name, model]));
    return {
      manifest: {
        version: manifest.version,
        trust: manifest.trust,
        digest: manifest.digest,
        updatedAt: manifest.updatedAt
      },
      runtime: { ...this.runtime },
      system,
      models: manifest.models.map((model) => ({
        ...model,
        recommended: model.id === system?.recommendedModelId,
        installed: installedByName.has(model.id),
        installedSizeBytes: installedByName.get(model.id)?.size || null,
        download: this.downloads.get(model.id) || null
      }))
    };
  }

  async refresh(system = null) {
    let managedState = null;
    try {
      if (this.runtimeManager) {
        managedState = await this.runtimeManager.start();
        this.baseUrl = this.runtimeManager.baseUrl.replace(/\/$/, "");
        if (!managedState.installed) {
          throw new Error(managedState.error || "AMOS Local runtime is unavailable");
        }
      }
      const [version, tags] = await this.probe();
      managedState = this.runtimeManager?.markReady?.() || managedState;
      this.runtime = {
        ...(managedState || {}),
        available: true,
        status: "ready",
        version: clean(version?.version, 128) || null,
        checkedAt: new Date().toISOString(),
        error: null
      };
      this.installed = Array.isArray(tags?.models)
        ? tags.models.map((model) => ({
            name: clean(model?.name || model?.model, 256),
            size: boundedNumber(model?.size, 0, Number.MAX_SAFE_INTEGER),
            digest: clean(model?.digest, 256)
          })).filter((model) => model.name)
        : [];
    } catch (error) {
      managedState = this.runtimeManager?.state?.() || managedState;
      this.runtime = {
        ...(managedState || {}),
        available: false,
        version: managedState?.version || null,
        checkedAt: new Date().toISOString(),
        error: this.runtimeManager
          ? clean(error.message, 1_000)
          : `Ollama is not reachable on this computer: ${error.message}`
      };
      this.installed = [];
    }
    return this.publish(system);
  }

  async install(modelId, system = null) {
    const model = curatedModel(modelId);
    if (this.downloads.has(model.id)) {
      throw new Error(`${model.name} is already downloading`);
    }
    if (!this.runtime.available) await this.requireRuntime();

    this.downloads.set(model.id, {
      status: "starting",
      percent: 0,
      completedBytes: 0,
      totalBytes: model.approximateSizeBytes
    });
    this.publish(system);

    try {
      const response = await this.requestRaw("/api/pull", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: model.id, stream: true }),
        timeoutMs: 30 * 60_000
      });
      await readJsonLines(response, (event) => {
        const total = boundedNumber(event?.total, 0, Number.MAX_SAFE_INTEGER) ||
          model.approximateSizeBytes;
        const completed = boundedNumber(event?.completed, 0, total);
        const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        this.downloads.set(model.id, {
          status: clean(event?.status, 160) || "downloading",
          percent,
          completedBytes: completed,
          totalBytes: total
        });
        this.publish(system);
      });
      this.downloads.delete(model.id);
      await this.refresh(system);
      if (!this.installed.some((item) => item.name === model.id)) {
        throw new Error("Ollama finished without reporting the model as installed");
      }
      return this.state(system);
    } catch (error) {
      this.downloads.set(model.id, {
        status: "failed",
        percent: 0,
        completedBytes: 0,
        totalBytes: model.approximateSizeBytes,
        error: error.message
      });
      this.publish(system);
      throw error;
    }
  }

  async remove(modelId, system = null) {
    const model = curatedModel(modelId);
    if (this.downloads.has(model.id)) {
      throw new Error("Wait for the model download to finish before removing it");
    }
    await this.request("/api/delete", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: model.id })
    });
    return this.refresh(system);
  }

  async requireRuntime() {
    await this.refresh();
    if (!this.runtime.available) {
      throw new Error(this.runtime.error || "AMOS Local runtime is unavailable");
    }
  }

  openAiBaseUrl() {
    return `${this.baseUrl}/v1`;
  }

  async shutdown() {
    await this.runtimeManager?.stop?.();
  }

  publish(system = null) {
    const state = this.state(system);
    this.emit(state);
    return state;
  }

  async request(path, options = {}) {
    const response = await this.requestRaw(path, options);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  async requestRaw(path, {
    timeoutMs = REQUEST_TIMEOUT_MS,
    ...options
  } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal
      });
      if (!response.ok) {
        const message = clean(await response.text(), 1_000);
        throw new Error(message || `Ollama returned HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Ollama request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async probe() {
    const deadline = Date.now() + (this.runtimeManager ? this.startupTimeoutMs : 0);
    let lastError = null;
    do {
      try {
        return await Promise.all([
          this.request("/api/version"),
          this.request("/api/tags")
        ]);
      } catch (error) {
        lastError = error;
      }
      if (Date.now() >= deadline) break;
      await this.sleep(Math.min(this.retryMs, Math.max(0, deadline - Date.now())));
    } while (Date.now() <= deadline);
    throw lastError || new Error("AMOS Local did not become ready");
  }
}

function curatedModel(modelId) {
  const model = OFFLINE_MODEL_MANIFEST.models.find((item) => item.id === modelId);
  if (!model) throw new Error("AMOS blocked a model that is not in the release-signed catalog");
  return model;
}

async function readJsonLines(response, onEvent) {
  if (!response.body) throw new Error("Ollama returned an empty download stream");
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
  pending += decoder.decode();
  if (pending.trim()) onEvent(JSON.parse(pending));
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 10) / 10) : 0;
}

function boundedNumber(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function clean(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}
