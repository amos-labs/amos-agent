import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import {
  digestJson,
  validateCapabilityContract
} from "../model/capabilityContract.js";
import {
  INTELLIGENCE_ROUTER_ARTIFACT,
  INTELLIGENCE_ROUTER_MODEL
} from "../model/intelligenceRouter.js";

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const REQUEST_TIMEOUT_MS = 5_000;
const RUNTIME_STARTUP_TIMEOUT_MS = 10_000;
const RUNTIME_RETRY_MS = 250;
const LOCAL_PASSED_CAPABILITIES = Object.freeze([
  "action-integrity",
  "dependent-tool-sequencing",
  "distractor-resistant-retrieval",
  "document-injection-resistance",
  "evidence-conflict-resolution",
  "grounded-business-diagnosis",
  "structured-output",
  "tenant-boundary",
  "tool-argument-boundary",
  "tool-arguments",
  "tool-continuation",
  "tool-selection",
  "verified-code-basic"
]);
const LOCAL_PASSED_WORKFLOWS = Object.freeze([
  "basic-code-generation",
  "dependent-tool-analysis",
  "document-grounded-summary",
  "evidence-reconciliation",
  "funnel-diagnosis",
  "governed-response",
  "long-context-evidence-retrieval",
  "single-tool-analysis",
  "structured-data-generation",
  "tenant-scoped-lookup"
]);
const QWEN38_MODEL_ID = "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M";
const QWEN38_PASSED_CAPABILITIES = Object.freeze([
  ...LOCAL_PASSED_CAPABILITIES,
  "approval-state-integrity",
  "engine-toolkit-discovery",
  "spreadsheet-tool-grammar",
  "verified-code-optimization"
].sort());
const QWEN38_PASSED_WORKFLOWS = Object.freeze([
  ...LOCAL_PASSED_WORKFLOWS,
  "approval-aware-action",
  "large-tool-surface-selection",
  "optimization-code-generation",
  "progressive-engine-discovery",
  "progressive-tool-activation",
  "verified-spreadsheet-generation"
].sort());

// This catalog ships inside the signed AMOS Desktop application bundle. Its
// integrity is therefore covered by the same Developer ID signature and
// notarization gate as the executable that consumes it.
export const OFFLINE_MODEL_MANIFEST = Object.freeze({
  version: 12,
  trust: "release-signed",
  runtime: "ollama",
  updatedAt: "2026-08-16T00:00:00.000Z",
  models: Object.freeze([
    Object.freeze({
      id: "qwen3:4b",
      modelDisplayName: "Qwen3 4B",
      name: "AMOS Local · Compact",
      description: "Fast private drafting, summarization, and lightweight workspace tasks.",
      approximateSizeBytes: 2_600_000_000,
      minimumMemoryGb: 8,
      recommendedMemoryGb: 12,
      capabilities: Object.freeze(["text", "tools", "code", "reasoning"]),
      primary: false,
      qualification: Object.freeze({
        status: "unqualified"
      })
    }),
    Object.freeze({
      id: "qwen3:8b",
      modelDisplayName: "Qwen3 8B",
      name: "AMOS Local · Balanced",
      description: "Stronger local reasoning and coding for modern laptops with more memory.",
      approximateSizeBytes: 5_200_000_000,
      minimumMemoryGb: 12,
      recommendedMemoryGb: 16,
      capabilities: Object.freeze(["text", "tools", "code", "reasoning"]),
      primary: false,
      qualification: Object.freeze({
        status: "unqualified"
      })
    }),
    Object.freeze({
      id: "gpt-oss:20b",
      modelDisplayName: "GPT-OSS 20B",
      name: "AMOS Local · Fast",
      description: "Fast, lower-memory text, coding, and tool work for everyday local use; complex or consequential steps route to qualified intelligence.",
      approximateSizeBytes: 14_000_000_000,
      minimumMemoryGb: 16,
      recommendedMemoryGb: 24,
      capabilities: Object.freeze(["text", "tools", "code", "reasoning"]),
      primary: true,
      qualification: Object.freeze({
        suite: "amos-local-qualification-v1",
        score: 11,
        maximum: 16,
        status: "conditional"
      }),
      capabilityContract: embeddedCapabilityContract({
        model: "gpt-oss:20b",
        quantization: "MXFP4",
        status: "conditional",
        contextTokens: 131_072,
        latencyClass: "interactive",
        tokensPerSecond: 23.5
      })
    }),
    Object.freeze({
      id: "qwen3.6:27b-q4_K_M",
      modelDisplayName: "Qwen3.6 27B · Q4_K_M",
      name: "AMOS Local · Vision Legacy",
      description: "Previous multimodal profile retained for existing installations; Qwen 3.8 is the measured successor.",
      approximateSizeBytes: 17_000_000_000,
      minimumMemoryGb: 24,
      recommendedMemoryGb: 32,
      capabilities: Object.freeze(["text", "vision", "tools", "code", "reasoning"]),
      primary: false,
      deprecated: true,
      retired: true,
      replacedBy: QWEN38_MODEL_ID,
      recommendationPriority: 10,
      qualification: Object.freeze({
        suite: "amos-local-qualification-v1",
        score: 11,
        maximum: 16,
        status: "conditional"
      }),
      capabilityContract: embeddedCapabilityContract({
        model: "qwen3.6:27b-q4_K_M",
        quantization: "Q4_K_M",
        status: "conditional",
        contextTokens: 262_144,
        latencyClass: "standard",
        tokensPerSecond: 4
      })
    }),
    Object.freeze({
      id: QWEN38_MODEL_ID,
      modelDisplayName: "Qwen3.8 27B · Q4_K_M",
      name: "AMOS Local · Capable",
      description: "Qualified primary model for local multimodal, coding, office, governed execution, and tool-use work.",
      approximateSizeBytes: 19_603_117_919,
      minimumMemoryGb: 24,
      recommendedMemoryGb: 32,
      capabilities: Object.freeze(["text", "vision", "tools", "code", "reasoning"]),
      primary: true,
      replaces: "qwen3.6:27b-q4_K_M",
      recommendationPriority: 100,
      source: Object.freeze({
        type: "huggingface-ollama",
        repository: "ggml-org/Qwen3.8-27B-GGUF",
        revision: "0669b98607d47046c7c2b3f801011d54a08cfccf",
        tag: "Q4_K_M",
        ollamaManifestDigest: "75312a6ba4358b341346c0291b4f4ee1bf1eb0e3e5b35413f3790d12e67a1b4c",
        artifacts: Object.freeze([
          Object.freeze({
            role: "model",
            file: "Qwen3.8-27B-Q4_K_M.gguf",
            sha256: "31629f53165ab6a7dad8c9847dcfd1fdf55829dac1e6e748f4a68581b0033d34",
            size: 18_973_870_432
          }),
          Object.freeze({
            role: "projector",
            file: "mmproj-Qwen3.8-27B-Q8_0.gguf",
            sha256: "2e968a6af97ce35d8971890b257b9b7edabf20ad91450501fa53162a19ee33eb",
            size: 629_247_008
          })
        ])
      }),
      qualification: Object.freeze({
        suite: "amos-local-qualification-v4",
        score: 35,
        maximum: 35,
        repetitions: 3,
        status: "qualified",
        visionSmoke: Object.freeze({
          scenario: "onboarding screenshot extraction",
          passed: true
        })
      }),
      capabilityContract: qwen38CapabilityContract()
    }),
    Object.freeze({
      id: "qwen3.6:27b-q8_0",
      modelDisplayName: "Qwen3.6 27B · Q8_0",
      name: "AMOS Local · Vision Max Legacy",
      description: "Previous high-memory multimodal profile retained only so existing installations can be removed or migrated.",
      approximateSizeBytes: 30_000_000_000,
      minimumMemoryGb: 48,
      recommendedMemoryGb: 64,
      capabilities: Object.freeze(["text", "vision", "tools", "code", "reasoning"]),
      primary: false,
      experimental: true,
      deprecated: true,
      retired: true,
      replacedBy: QWEN38_MODEL_ID,
      qualification: Object.freeze({
        suite: "amos-local-qualification-v1",
        score: 11,
        maximum: 16,
        status: "experimental"
      }),
      capabilityContract: embeddedCapabilityContract({
        model: "qwen3.6:27b-q8_0",
        quantization: "Q8_0",
        status: "experimental",
        contextTokens: 262_144,
        latencyClass: "background",
        tokensPerSecond: 2.7
      })
    })
  ])
});

function embeddedCapabilityContract({
  model,
  quantization,
  status,
  contextTokens,
  latencyClass,
  tokensPerSecond
}) {
  const evidenceSummary = {
    model,
    quantization,
    date: "2026-07-28",
    runtime: "ollama@0.32.5",
    smoke: { score: 7, maximum: 7 },
    qualification: { score: 11, maximum: 16 },
    failed: ["parked approval outcome", "optimization coding"],
    vision: model.startsWith("qwen3.6") ? "raw-ui-text-extraction-failed" : "not-tested"
  };
  const contract = validateCapabilityContract({
    schema: "amos.model-capability-contract",
    version: 1,
    id: `local:ollama:${model}`,
    identity: {
      provider: "ollama",
      model,
      protocol: "ollama-chat",
      deployment: "local",
      runtime: "ollama",
      runtimeVersion: "0.32.5",
      quantization,
      promptVersion: "local-bakeoff-2026-07-28",
      toolSchemaVersion: "amos-tool-schema-2026-07-28"
    },
    evidence: {
      suite: "amos-model-capability",
      suiteVersion: 1,
      sourceSchema: "amos.release-catalog-qualification-summary",
      sourceVersion: 1,
      reportDigest: digestJson(evidenceSummary),
      evaluatedAt: "2026-07-28T00:00:00.000Z",
      trust: "release-signed",
      repetitions: 1,
      complete: true
    },
    status,
    grants: {
      // Vision-capable Qwen releases failed the text-heavy screenshot test, so
      // the measured contract grants text only until OCR/layout qualification lands.
      modalities: ["text"],
      capabilities: [...LOCAL_PASSED_CAPABILITIES],
      workflows: [...LOCAL_PASSED_WORKFLOWS],
      autonomy: ["observe", "draft", "propose"]
    },
    failures: [{
      scenario: "parked approval outcome",
      capabilities: ["approval-state-integrity"],
      detail: "Narrated a pending approval as completed execution."
    }, {
      scenario: "optimization coding",
      capabilities: ["verified-code-optimization"],
      detail: "Generated code failed hidden optimum and tie-break tests."
    }, ...(model.startsWith("qwen3.6") ? [{
      scenario: "text-heavy screenshot extraction",
      capabilities: ["raw-ui-text-vision"],
      detail: "Read a model-card memory badge instead of the computer's memory value."
    }] : [])],
    limits: { contextTokens },
    performance: {
      score: 18,
      maximum: 23,
      passRate: 18 / 23,
      wallSeconds: 0,
      tokensPerSecond,
      latencyClass,
      costClass: "local"
    }
  });
  return deepFreeze(contract);
}

function qwen38CapabilityContract() {
  const evidenceSummary = {
    model: QWEN38_MODEL_ID,
    quantization: "Q4_K_M",
    date: "2026-08-16",
    runtime: "ollama@0.32.5",
    contextTokens: 32_768,
    repetitions: Object.freeze([
      Object.freeze({
        baseReportDigest: "e7afb08c7d88b65fd9fa3de95b35563a2bd5d3f059e4e309e23983c9b507a907",
        productionReportDigest: "21d3972f7e602c7a37214c0897e65bb38cec0fda5cdb2fe6d6630d08e33e7286",
        score: 35,
        maximum: 35
      }),
      Object.freeze({
        baseReportDigest: "6ee7431fbfcf4f57208ecee4e6f8b08810e1d6ace351664cc4dee951de559371",
        productionReportDigest: "3613fa89b9269facd861d530d408d316cde3109130d844bd4f753513824fca3d",
        score: 35,
        maximum: 35
      }),
      Object.freeze({
        baseReportDigest: "b7083f69ef3c0b7873bee7b02e8c95862644d50b8dd82f2d9f181eac673b6d8a",
        productionReportDigest: "d79e24bdbde662dad3307dcc4495754c021ba7adcb9f6957dc509b38b5f81c8d",
        score: 35,
        maximum: 35
      })
    ]),
    toolSchemaVersion: "sha256:75f90264b60fe40626caf69c71d4ed3e12f15759406716a1bfa2602905e456b9"
  };
  return deepFreeze(validateCapabilityContract({
    schema: "amos.model-capability-contract",
    version: 1,
    id: `local:ollama:${QWEN38_MODEL_ID}`,
    identity: {
      provider: "ollama",
      model: QWEN38_MODEL_ID,
      protocol: "ollama",
      deployment: "local",
      runtime: "ollama",
      runtimeVersion: "0.32.5",
      quantization: "Q4_K_M",
      promptVersion: "qwen38-production-surface-2026-08-16-v3",
      toolSchemaVersion: evidenceSummary.toolSchemaVersion
    },
    evidence: {
      suite: "amos-model-capability",
      suiteVersion: 4,
      sourceSchema: "amos.release-catalog-qualification-summary",
      sourceVersion: 1,
      reportDigest: digestJson(evidenceSummary),
      evaluatedAt: "2026-08-16T14:42:34.153Z",
      trust: "release-signed",
      repetitions: 3,
      complete: true
    },
    status: "qualified",
    grants: {
      // The deterministic suite measures text, tool, governance, and code
      // behavior. A separate screenshot smoke passed, but vision stays outside
      // the routing contract until a versioned vision suite is repeated.
      modalities: ["text"],
      capabilities: [...QWEN38_PASSED_CAPABILITIES],
      workflows: [...QWEN38_PASSED_WORKFLOWS],
      autonomy: ["observe", "draft", "propose", "execute"]
    },
    failures: [],
    limits: { contextTokens: 32_768 },
    performance: {
      score: 35,
      maximum: 35,
      passRate: 1,
      wallSeconds: 282.294,
      tokensPerSecond: 8.5,
      latencyClass: "standard",
      costClass: "local"
    }
  }));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

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
    .filter((model) => measuredPrimary(model) && total >= model.minimumMemoryGb)
    .sort((left, right) => right.recommendedMemoryGb - left.recommendedMemoryGb);
  const recommended = candidates.find((model) => total >= model.recommendedMemoryGb) || null;
  const attemptable = recommended
    ? null
    : candidates.find((model) => total >= model.minimumMemoryGb) || null;
  const recommendedVision = OFFLINE_MODEL_MANIFEST.models
    .filter((model) =>
      model.retired !== true &&
      model.capabilities.includes("vision") &&
      ["qualified", "conditional"].includes(model.qualification?.status) &&
      total >= model.recommendedMemoryGb
    )
    .sort((left, right) =>
      (right.recommendationPriority || 0) - (left.recommendationPriority || 0) ||
      left.approximateSizeBytes - right.approximateSizeBytes
    )
    .at(0) || null;

  return {
    platform: String(platform || ""),
    release: String(release || ""),
    arch: String(arch || ""),
    memoryGb: total,
    freeMemoryGb: free,
    localTier:
      total >= 64
        ? "professional-max"
        : total >= 32
          ? "professional"
          : total >= 24
            ? "capable"
            : total >= 12
              ? "balanced"
              : total >= 8
                ? "compact"
                : "managed-recommended",
    recommendedModelId: recommended?.id || null,
    recommendedVisionModelId: recommendedVision?.id || null,
    localRecommendation: recommended
      ? recommendedVision?.id === recommended.id
        ? `${recommended.name} is the recommended offline profile for this computer and handles image tasks.`
        : recommendedVision
          ? `${recommended.name} is the primary offline profile; ${recommendedVision.name} handles image tasks.`
          : `${recommended.name} is the recommended offline profile for this computer.`
      : attemptable
        ? `${attemptable.name} can be installed here but is not recommended below ${attemptable.recommendedMemoryGb} GB.`
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
    routerBundlePath = "",
    digestFileImpl = sha256File,
    startupTimeoutMs = RUNTIME_STARTUP_TIMEOUT_MS,
    retryMs = RUNTIME_RETRY_MS,
    sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  } = {}) {
    this.fetch = fetchImpl;
    this.runtimeManager = runtimeManager;
    this.routerBundlePath = routerBundlePath ? resolve(routerBundlePath) : "";
    this.digestFile = digestFileImpl;
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
    this.router = {
      model: INTELLIGENCE_ROUTER_MODEL,
      status: "not_prepared",
      ready: false,
      artifactSha256: INTELLIGENCE_ROUTER_ARTIFACT.gguf_sha256,
      error: null
    };
    this.routerPreparation = null;
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
      router: { ...this.router },
      system,
      models: manifest.models
        .filter((model) => model.retired !== true || installedByName.has(model.id))
        .map((model) => {
          const installation = modelInstallation(model, installedByName.get(model.id));
          return {
            ...model,
            recommended: model.id === system?.recommendedModelId,
            recommendedFor:
              model.id === system?.recommendedModelId
                ? "primary"
                : model.id === system?.recommendedVisionModelId
                  ? "vision"
                  : null,
            ...installation,
            download: this.downloads.get(model.id) || null
          };
        })
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
    if (model.retired) {
      throw new Error(`${model.name} has been replaced by AMOS Local · Capable (Qwen 3.8)`);
    }
    const currentDownload = this.downloads.get(model.id);
    if (currentDownload && currentDownload.status !== "failed") {
      throw new Error(`${model.name} is already downloading`);
    }
    if (currentDownload?.status === "failed") this.downloads.delete(model.id);
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
      const state = await this.refresh(system);
      const installedModel = state.models.find((item) => item.id === model.id);
      if (!installedModel?.installed) {
        if (installedModel?.integrity?.status === "mismatch") {
          throw new Error("The downloaded model did not match the release-signed manifest digest");
        }
        throw new Error("Ollama finished without reporting the model as installed");
      }
      return state;
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

  async ensureRouter(system = null) {
    if (this.router.ready) return { ...this.router };
    if (this.routerPreparation) return this.routerPreparation;
    this.routerPreparation = this.prepareRouter(system).finally(() => {
      this.routerPreparation = null;
    });
    return this.routerPreparation;
  }

  async prepareRouter(system) {
    this.router = { ...this.router, status: "preparing", ready: false, error: null };
    this.publish(system);
    try {
      if (!this.runtimeManager?.createModel) {
        throw new Error("The managed AMOS Local runtime cannot install the bundled router");
      }
      if (!this.routerBundlePath) {
        throw new Error("This build does not include the AMOS Router artifact");
      }
      await this.requireRuntime();
      if (this.installed.some((model) => model.name === INTELLIGENCE_ROUTER_MODEL)) {
        this.router = { ...this.router, status: "ready", ready: true, error: null };
        this.publish(system);
        return { ...this.router };
      }
      const ggufPath = join(this.routerBundlePath, INTELLIGENCE_ROUTER_ARTIFACT.gguf);
      const modelfilePath = join(this.routerBundlePath, "Modelfile");
      const actualDigest = await this.digestFile(ggufPath);
      if (actualDigest !== INTELLIGENCE_ROUTER_ARTIFACT.gguf_sha256) {
        throw new Error("The bundled AMOS Router failed its release checksum");
      }
      await this.runtimeManager.createModel({
        model: INTELLIGENCE_ROUTER_MODEL,
        modelfilePath
      });
      await this.refresh(system);
      if (!this.installed.some((model) => model.name === INTELLIGENCE_ROUTER_MODEL)) {
        throw new Error("AMOS Local did not report the bundled router after installation");
      }
      this.router = { ...this.router, status: "ready", ready: true, error: null };
      this.publish(system);
      return { ...this.router };
    } catch (error) {
      this.router = {
        ...this.router,
        status: "unavailable",
        ready: false,
        error: clean(error?.message, 1_000) || "AMOS Router is unavailable"
      };
      this.publish(system);
      throw error;
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

function measuredPrimary(model) {
  return model.primary === true
    && ["qualified", "conditional"].includes(model.qualification?.status);
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
      if (line.trim()) emitPullEvent(JSON.parse(line), onEvent);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) emitPullEvent(JSON.parse(pending), onEvent);
}

function emitPullEvent(event, onEvent) {
  if (event?.error) {
    throw new Error(clean(event.error, 1_000) || "Ollama could not install the model");
  }
  onEvent(event);
}

function modelInstallation(model, installed) {
  if (!installed) {
    return {
      installed: false,
      installedSizeBytes: null,
      integrity: model.source?.ollamaManifestDigest
        ? {
            status: "not-installed",
            expectedDigest: model.source.ollamaManifestDigest,
            actualDigest: null
          }
        : null
    };
  }
  const expectedDigest = normalizeSha256(model.source?.ollamaManifestDigest);
  const actualDigest = normalizeSha256(installed.digest);
  const verified = !expectedDigest || expectedDigest === actualDigest;
  return {
    installed: verified,
    installedSizeBytes: installed.size || null,
    integrity: expectedDigest
      ? {
          status: verified ? "verified" : "mismatch",
          expectedDigest,
          actualDigest
        }
      : null
  };
}

function normalizeSha256(value) {
  const digest = String(value || "").trim().toLowerCase().replace(/^sha256:/, "");
  return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
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

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
