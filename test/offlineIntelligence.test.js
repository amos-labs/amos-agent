import test from "node:test";
import assert from "node:assert/strict";
import {
  assessHardware,
  OllamaModelManager,
  releaseSignedManifest
} from "../src/desktop/offlineIntelligence.js";
import { routeModelStep } from "../src/model/capabilityRouter.js";
import { currentProductionToolSchemaVersion } from "../src/model/toolSurfaceQualification.js";
import { createRegistry } from "../src/runtime.js";
import {
  INTELLIGENCE_ROUTER_ARTIFACT,
  INTELLIGENCE_ROUTER_MODEL
} from "../src/model/intelligenceRouter.js";

const QWEN38_MODEL_ID = "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M";
const QWEN38_MANIFEST_DIGEST = "75312a6ba4358b341346c0291b4f4ee1bf1eb0e3e5b35413f3790d12e67a1b4c";

test("hardware assessment recommends a bounded curated profile", () => {
  const compact = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 8,
    freeMemoryGb: 4
  });
  assert.equal(compact.localTier, "compact");
  assert.equal(compact.recommendedModelId, null);
  assert.equal(
    compact.localRecommendation,
    "Use AMOS-hosted or customer-cloud intelligence on this computer."
  );

  const twelveGig = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 12,
    freeMemoryGb: 6
  });
  assert.equal(twelveGig.localTier, "balanced");
  assert.equal(twelveGig.recommendedModelId, null);
  assert.equal(
    twelveGig.localRecommendation,
    "Use AMOS-hosted or customer-cloud intelligence on this computer."
  );

  const sixteenGig = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 16,
    freeMemoryGb: 8
  });
  assert.equal(sixteenGig.localTier, "balanced");
  assert.equal(sixteenGig.recommendedModelId, null);
  assert.equal(sixteenGig.recommendedVisionModelId, null);
  assert.match(
    sixteenGig.localRecommendation,
    /not recommended below 24 GB/
  );

  const capable = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 24,
    freeMemoryGb: 12
  });
  assert.equal(capable.localTier, "capable");
  assert.equal(capable.recommendedModelId, "gpt-oss:20b");

  const professional = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 32,
    freeMemoryGb: 20
  });
  assert.equal(professional.localTier, "professional");
  assert.equal(professional.recommendedModelId, QWEN38_MODEL_ID);
  assert.equal(professional.recommendedVisionModelId, QWEN38_MODEL_ID);
  assert.equal(
    professional.localRecommendation,
    "AMOS Local · Capable is the recommended offline profile for this computer and handles image tasks."
  );

  const professionalMax = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 64,
    freeMemoryGb: 48
  });
  assert.equal(professionalMax.localTier, "professional-max");
  assert.equal(professionalMax.recommendedModelId, QWEN38_MODEL_ID);
  assert.equal(professionalMax.recommendedVisionModelId, QWEN38_MODEL_ID);
});

test("curated model manifest is release-signed and content-addressed", () => {
  const manifest = releaseSignedManifest();
  assert.equal(manifest.version, 12);
  assert.equal(manifest.trust, "release-signed");
  assert.match(manifest.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    manifest.models.map((model) => model.id),
    [
      "qwen3:4b",
      "qwen3:8b",
      "gpt-oss:20b",
      "qwen3.6:27b-q4_K_M",
      QWEN38_MODEL_ID,
      "qwen3.6:27b-q8_0"
    ]
  );
  const compact = manifest.models.find((model) => model.id === "qwen3:4b");
  const balanced = manifest.models.find((model) => model.id === "qwen3:8b");
  const capable = manifest.models.find((model) => model.id === "gpt-oss:20b");
  const qwen36 = manifest.models.find((model) => model.id === "qwen3.6:27b-q4_K_M");
  const qwen38 = manifest.models.find((model) => model.id === QWEN38_MODEL_ID);
  const visionMax = manifest.models.find((model) => model.id === "qwen3.6:27b-q8_0");
  assert.equal(compact.primary, false);
  assert.equal(balanced.primary, false);
  assert.equal(compact.qualification.status, "unqualified");
  assert.equal(balanced.qualification.status, "unqualified");
  assert.equal(compact.qualification.score, undefined);
  assert.equal(balanced.qualification.score, undefined);
  assert.equal(compact.capabilityContract, undefined);
  assert.equal(balanced.capabilityContract, undefined);
  assert.equal(capable.primary, true);
  assert.equal(capable.name, "AMOS Local · Fast");
  assert.equal(capable.modelDisplayName, "GPT-OSS 20B");
  assert.equal(qwen38.modelDisplayName, "Qwen3.8 27B · Q4_K_M");
  assert.equal(qwen38.name, "AMOS Local · Capable");
  assert.equal(qwen38.primary, true);
  assert.equal(capable.qualification.status, "conditional");
  assert.equal(qwen36.deprecated, true);
  assert.equal(qwen36.retired, true);
  assert.equal(qwen36.replacedBy, QWEN38_MODEL_ID);
  assert.equal(qwen38.replaces, "qwen3.6:27b-q4_K_M");
  assert.equal(qwen38.qualification.status, "qualified");
  assert.equal(qwen38.qualification.score, 35);
  assert.equal(qwen38.qualification.maximum, 35);
  assert.equal(qwen38.qualification.suite, "amos-local-qualification-v4");
  assert.match(qwen38.capabilityContract.identity.toolSchemaVersion, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    qwen38.capabilityContract.identity.toolSchemaVersion,
    "sha256:75f90264b60fe40626caf69c71d4ed3e12f15759406716a1bfa2602905e456b9"
  );
  assert.match(currentProductionToolSchemaVersion(), /^sha256:[a-f0-9]{64}$/);
  // Production prompt/tool-schema drift is recorded, not a ship gate. Do not bump
  // the bound digest by hand. See docs/FOLLOWUPS.md.
  assert.equal(qwen38.qualification.repetitions, 3);
  assert.equal(qwen38.qualification.visionSmoke.passed, true);
  assert.equal(qwen38.source.revision, "0669b98607d47046c7c2b3f801011d54a08cfccf");
  assert.equal(qwen38.source.ollamaManifestDigest, QWEN38_MANIFEST_DIGEST);
  assert.deepEqual(
    qwen38.source.artifacts.map(({ role, sha256, size }) => ({ role, sha256, size })),
    [{
      role: "model",
      sha256: "31629f53165ab6a7dad8c9847dcfd1fdf55829dac1e6e748f4a68581b0033d34",
      size: 18_973_870_432
    }, {
      role: "projector",
      sha256: "2e968a6af97ce35d8971890b257b9b7edabf20ad91450501fa53162a19ee33eb",
      size: 629_247_008
    }]
  );
  assert.equal(visionMax.experimental, true);
  assert.equal(visionMax.retired, true);
  assert.equal(visionMax.replacedBy, QWEN38_MODEL_ID);
  assert.equal(visionMax.qualification.status, "experimental");
});

test("release-signed local contracts expose qualified grants instead of marketing claims", () => {
  const manifest = releaseSignedManifest();
  const gptOss = manifest.models.find((model) => model.id === "gpt-oss:20b");
  const legacyVision = manifest.models.find((model) => model.id === "qwen3.6:27b-q4_K_M");
  const vision = manifest.models.find((model) => model.id === QWEN38_MODEL_ID);
  assert.equal(gptOss.capabilityContract.status, "conditional");
  assert.deepEqual(gptOss.capabilityContract.grants.autonomy, ["observe", "draft", "propose"]);
  assert.equal(
    gptOss.capabilityContract.grants.capabilities.includes("approval-state-integrity"),
    false
  );
  assert.ok(legacyVision.capabilities.includes("vision"));
  assert.equal(legacyVision.capabilityContract.grants.modalities.includes("vision"), false);
  assert.ok(vision.capabilities.includes("vision"));
  assert.equal(vision.capabilityContract.grants.modalities.includes("vision"), false);
  assert.equal(vision.capabilityContract.status, "qualified");
  assert.deepEqual(
    vision.capabilityContract.grants.autonomy,
    ["observe", "draft", "propose", "execute"]
  );
  assert.equal(
    vision.capabilityContract.grants.capabilities.includes("approval-state-integrity"),
    true
  );
  assert.equal(
    vision.capabilityContract.grants.capabilities.includes("verified-code-optimization"),
    true
  );
  assert.equal(
    vision.capabilityContract.grants.capabilities.includes("engine-toolkit-discovery"),
    true
  );
  assert.equal(
    vision.capabilityContract.grants.capabilities.includes("spreadsheet-tool-grammar"),
    true
  );
  assert.deepEqual(vision.capabilityContract.failures, []);

  const executionRoute = routeModelStep({
    requirements: { autonomy: "execute" },
    candidates: manifest.models
      .filter((model) => model.capabilityContract)
      .map((model) => model.capabilityContract)
  });
  assert.equal(executionRoute.selected.contract.id, `local:ollama:${QWEN38_MODEL_ID}`);
});

test("offline registry omits all AMOS and public-web tools", () => {
  const tools = createRegistry({ includeAmos: false, includeWeb: false }).list();
  assert.equal(tools.some((tool) => tool.source === "amos"), false);
  assert.equal(tools.some((tool) => tool.name.startsWith("amos_")), false);
  assert.equal(tools.some((tool) => tool.name.startsWith("web_")), false);
  assert.ok(tools.some((tool) => tool.name === "search_files"));
  assert.ok(tools.some((tool) => tool.name === "run_bash"));
  assert.ok(tools.some((tool) => tool.name === "desktop_create_document"));
  assert.ok(tools.some((tool) => tool.name === "desktop_create_spreadsheet"));
  assert.ok(tools.some((tool) => tool.name === "desktop_create_presentation"));
  assert.ok(tools.some((tool) => tool.name === "desktop_calculate"));
});

test("context-only registry exposes no local workspace tools", () => {
  const tools = createRegistry({ includeLocal: false }).list();
  assert.equal(tools.some((tool) => tool.name === "run_bash"), false);
  assert.equal(tools.some((tool) => tool.name === "search_files"), false);
  assert.equal(tools.some((tool) => tool.name === "read_file"), false);
  assert.equal(tools.some((tool) => tool.name === "write_file"), false);
  assert.equal(tools.some((tool) => tool.name === "apply_patch"), false);
  assert.equal(tools.some((tool) => tool.name === "desktop_create_document"), false);
  assert.equal(tools.some((tool) => tool.name === "desktop_create_spreadsheet"), false);
  assert.equal(tools.some((tool) => tool.name === "desktop_create_presentation"), false);
  assert.equal(tools.some((tool) => tool.name === "desktop_calculate"), false);
  assert.ok(tools.some((tool) => tool.name.startsWith("web_")));
  assert.ok(tools.some((tool) => tool.name.startsWith("amos_")));
});

test("Ollama manager probes, installs, reports progress, and removes curated models", async () => {
  let installed = false;
  const events = [];
  const manager = new OllamaModelManager({
    emit: (state) => events.push(state),
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/version") {
        return jsonResponse({ version: "0.12.0" });
      }
      if (path === "/api/tags") {
        return jsonResponse({
          models: installed
            ? [{ name: "qwen3:4b", size: 2_600_000_000, digest: "sha256:test" }]
            : []
        });
      }
      if (path === "/api/pull" && options.method === "POST") {
        installed = true;
        return new Response(
          [
            JSON.stringify({ status: "pulling", total: 100, completed: 50 }),
            JSON.stringify({ status: "success", total: 100, completed: 100 })
          ].join("\n")
        );
      }
      if (path === "/api/delete" && options.method === "DELETE") {
        installed = false;
        return jsonResponse({});
      }
      return new Response("not found", { status: 404 });
    }
  });
  const system = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 16,
    freeMemoryGb: 8
  });

  const ready = await manager.refresh(system);
  assert.equal(ready.runtime.available, true);
  assert.equal(ready.runtime.version, "0.12.0");

  const installedState = await manager.install("qwen3:4b", system);
  assert.equal(installedState.models.find((model) => model.id === "qwen3:4b").installed, true);
  assert.ok(events.some((state) =>
    state.models.find((model) => model.id === "qwen3:4b")?.download?.percent === 50
  ));

  const removed = await manager.remove("qwen3:4b", system);
  assert.equal(removed.models.find((model) => model.id === "qwen3:4b").installed, false);
  await assert.rejects(() => manager.install("not-curated:latest"), /release-signed catalog/);
});

test("Ollama manager installs Qwen 3.8 from the release-pinned Hugging Face manifest", async () => {
  let installed = false;
  let pullInput = null;
  const manager = new OllamaModelManager({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/version") return jsonResponse({ version: "0.32.5" });
      if (path === "/api/tags") {
        return jsonResponse({
          models: installed
            ? [{
                name: QWEN38_MODEL_ID,
                size: 19_603_117_919,
                digest: `sha256:${QWEN38_MANIFEST_DIGEST}`
              }]
            : []
        });
      }
      if (path === "/api/pull" && options.method === "POST") {
        pullInput = JSON.parse(options.body);
        installed = true;
        return new Response(`${JSON.stringify({ status: "success" })}\n`);
      }
      return new Response("not found", { status: 404 });
    }
  });

  await manager.refresh();
  const state = await manager.install(QWEN38_MODEL_ID);
  assert.deepEqual(pullInput, { model: QWEN38_MODEL_ID, stream: true });
  const model = state.models.find((item) => item.id === QWEN38_MODEL_ID);
  assert.equal(model.installed, true);
  assert.equal(model.integrity.status, "verified");
  assert.equal(model.integrity.actualDigest, QWEN38_MANIFEST_DIGEST);
});

test("Ollama manager preloads a selected model and exposes native residency metrics", async () => {
  let generateInput = null;
  const manager = new OllamaModelManager({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/version") return jsonResponse({ version: "0.32.5" });
      if (path === "/api/tags") {
        return jsonResponse({
          models: [{
            name: QWEN38_MODEL_ID,
            size: 19_603_117_919,
            digest: `sha256:${QWEN38_MANIFEST_DIGEST}`
          }]
        });
      }
      if (path === "/api/generate" && options.method === "POST") {
        generateInput = JSON.parse(options.body);
        return jsonResponse({
          load_duration: 2_500_000_000,
          total_duration: 2_750_000_000
        });
      }
      if (path === "/api/ps") {
        return jsonResponse({
          models: [{
            name: QWEN38_MODEL_ID,
            size: 19_603_117_919,
            size_vram: 19_603_117_919,
            context_length: 65_536,
            expires_at: "2026-08-16T12:30:00.000Z"
          }]
        });
      }
      return new Response("not found", { status: 404 });
    }
  });

  await manager.refresh();
  const preload = await manager.preload(QWEN38_MODEL_ID);
  assert.deepEqual(generateInput, {
    model: QWEN38_MODEL_ID,
    prompt: "",
    stream: false,
    keep_alive: "30m"
  });
  assert.equal(preload.loadMs, 2_500);
  assert.equal(preload.totalMs, 2_750);
  const performanceState = manager.state().performance;
  assert.equal(performanceState.loadedModels[0].contextLength, 65_536);
  assert.equal(
    performanceState.loadedModels[0].sizeBytes,
    performanceState.loadedModels[0].sizeVramBytes
  );
});

test("local inference selects ready MTPLX and falls back to Ollama without changing the catalog model", async () => {
  let acceleratorReady = false;
  const acceleratorManager = {
    supportsModel: (modelId) => modelId === QWEN38_MODEL_ID,
    state: () => ({
      status: acceleratorReady ? "ready" : "stopped",
      openAiBaseUrl: "http://127.0.0.1:18081/v1",
      contextLength: 32_768,
      error: acceleratorReady ? null : "not started"
    }),
    start: async () => {
      acceleratorReady = true;
      return { persistentSessionCache: true };
    }
  };
  const manager = new OllamaModelManager({ acceleratorManager });
  assert.deepEqual(manager.inferenceTarget(QWEN38_MODEL_ID, "mtplx"), {
    runtime: "ollama",
    model: QWEN38_MODEL_ID,
    baseUrl: "http://127.0.0.1:11434/v1",
    contextLength: null,
    fallback: true,
    fallbackReason: "not started"
  });
  const preload = await manager.preload(QWEN38_MODEL_ID, { runtime: "mtplx" });
  assert.equal(preload.runtime, "mtplx");
  assert.equal(preload.fallback, false);
  assert.deepEqual(manager.inferenceTarget(QWEN38_MODEL_ID, "mtplx"), {
    runtime: "mtplx",
    model: "amos-local-qwen38-mtplx",
    baseUrl: "http://127.0.0.1:18081/v1",
    contextLength: 32_768,
    fallback: false
  });
});

test("MTPLX startup failures preload the same qualified model through Ollama", async () => {
  let generated = false;
  const acceleratorManager = {
    supportsModel: () => true,
    state: () => ({ status: "failed", error: "MTP head failed validation" }),
    start: async () => { throw new Error("MTP head failed validation"); }
  };
  const manager = new OllamaModelManager({
    acceleratorManager,
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/version") return jsonResponse({ version: "0.32.5" });
      if (path === "/api/tags") return jsonResponse({ models: [{
        name: QWEN38_MODEL_ID,
        size: 19_603_117_919,
        digest: `sha256:${QWEN38_MANIFEST_DIGEST}`
      }] });
      if (path === "/api/generate" && options.method === "POST") {
        generated = true;
        return jsonResponse({ load_duration: 1, total_duration: 1 });
      }
      if (path === "/api/ps") return jsonResponse({ models: [] });
      return new Response("not found", { status: 404 });
    }
  });
  await manager.refresh();
  const preload = await manager.preload(QWEN38_MODEL_ID, { runtime: "mtplx" });
  assert.equal(preload.fallback, true);
  assert.equal(preload.runtime, "ollama");
  assert.match(preload.fallbackReason, /MTP head failed validation/);
  assert.equal(generated, true);
  assert.match(manager.state().performance.lastAcceleratorFallback.reason, /MTP head/);
});

test("Qwen 3.8 replaces Qwen 3.6 while existing legacy installs remain removable", async () => {
  let legacyInstalled = true;
  let removedModel = null;
  const manager = new OllamaModelManager({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/version") return jsonResponse({ version: "0.32.5" });
      if (path === "/api/tags") {
        return jsonResponse({
          models: legacyInstalled
            ? [{
                name: "qwen3.6:27b-q4_K_M",
                size: 17_000_000_000,
                digest: "a50eda8ed977ab48a12431878896b27ffd5cef552c17af3317d9623b939a7f1e"
              }]
            : []
        });
      }
      if (path === "/api/delete" && options.method === "DELETE") {
        removedModel = JSON.parse(options.body).model;
        legacyInstalled = false;
        return jsonResponse({});
      }
      return new Response("not found", { status: 404 });
    }
  });

  const installed = await manager.refresh();
  const legacy = installed.models.find((model) => model.id === "qwen3.6:27b-q4_K_M");
  assert.equal(legacy.installed, true);
  assert.equal(legacy.retired, true);
  await assert.rejects(
    () => manager.install("qwen3.6:27b-q4_K_M"),
    /replaced by AMOS Local · Capable \(Qwen 3\.8\)/
  );

  const removed = await manager.remove("qwen3.6:27b-q4_K_M");
  assert.equal(removedModel, "qwen3.6:27b-q4_K_M");
  assert.equal(removed.models.some((model) => model.id.startsWith("qwen3.6:")), false);
});

test("Ollama manager surfaces streamed pull errors and release digest mismatches", async () => {
  let installedDigest = null;
  const manager = new OllamaModelManager({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/version") return jsonResponse({ version: "0.32.5" });
      if (path === "/api/tags") {
        return jsonResponse({
          models: installedDigest
            ? [{ name: QWEN38_MODEL_ID, size: 1, digest: installedDigest }]
            : []
        });
      }
      if (path === "/api/pull" && options.method === "POST") {
        installedDigest = `sha256:${"0".repeat(64)}`;
        return new Response(`${JSON.stringify({ status: "success" })}\n`);
      }
      return new Response("not found", { status: 404 });
    }
  });

  await manager.refresh();
  await assert.rejects(
    () => manager.install(QWEN38_MODEL_ID),
    /release-signed manifest digest/
  );
  const mismatch = manager.state().models.find((item) => item.id === QWEN38_MODEL_ID);
  assert.equal(mismatch.installed, false);
  assert.equal(mismatch.integrity.status, "mismatch");

  const streamed = new OllamaModelManager({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/version") return jsonResponse({ version: "0.32.5" });
      if (path === "/api/tags") return jsonResponse({ models: [] });
      if (path === "/api/pull" && options.method === "POST") {
        return new Response(`${JSON.stringify({ error: "projector translation failed" })}\n`);
      }
      return new Response("not found", { status: 404 });
    }
  });
  await streamed.refresh();
  await assert.rejects(
    () => streamed.install(QWEN38_MODEL_ID),
    /projector translation failed/
  );
  await assert.rejects(
    () => streamed.install(QWEN38_MODEL_ID),
    /projector translation failed/
  );
});

test("Ollama manager reports an unavailable runtime without leaking the request", async () => {
  const manager = new OllamaModelManager({
    fetchImpl: async () => {
      throw new Error("connect refused");
    }
  });
  const state = await manager.refresh();
  assert.equal(state.runtime.available, false);
  assert.match(state.runtime.error, /not reachable/);
});

test("managed local runtime starts before probing and owns the inference endpoint", async () => {
  let attempts = 0;
  let markedReady = false;
  const runtimeManager = {
    baseUrl: "http://127.0.0.1:11435",
    state: () => ({
      managed: true,
      installed: true,
      source: "bundled",
      status: "stopped",
      version: "0.32.5",
      error: null
    }),
    start: async () => ({
      managed: true,
      installed: true,
      source: "bundled",
      status: "starting",
      version: "0.32.5",
      error: null
    }),
    markReady: () => {
      markedReady = true;
      return {
        managed: true,
        installed: true,
        source: "bundled",
        status: "ready",
        version: "0.32.5",
        error: null
      };
    }
  };
  const manager = new OllamaModelManager({
    runtimeManager,
    startupTimeoutMs: 100,
    retryMs: 10,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      attempts += 1;
      if (attempts === 1) throw new Error("starting");
      const path = new URL(url).pathname;
      return jsonResponse(path === "/api/version" ? { version: "0.32.5" } : { models: [] });
    }
  });

  const state = await manager.refresh();
  assert.equal(state.runtime.available, true);
  assert.equal(state.runtime.managed, true);
  assert.equal(state.runtime.source, "bundled");
  assert.equal(state.runtime.status, "ready");
  assert.equal(markedReady, true);
  assert.equal(manager.openAiBaseUrl(), "http://127.0.0.1:11435/v1");
  assert.ok(attempts >= 3);
});

test("Ollama manager verifies and installs the bundled router exactly once", async () => {
  let routerInstalled = false;
  const created = [];
  const runtimeManager = {
    baseUrl: "http://127.0.0.1:11435",
    state: () => ({ installed: true, status: "stopped", error: null }),
    start: async () => ({ installed: true, status: "starting", error: null }),
    markReady: () => ({ installed: true, status: "ready", error: null }),
    createModel: async (input) => {
      created.push(input);
      routerInstalled = true;
    }
  };
  const manager = new OllamaModelManager({
    runtimeManager,
    routerBundlePath: "/bundle/router",
    digestFileImpl: async () => INTELLIGENCE_ROUTER_ARTIFACT.gguf_sha256,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/version") return jsonResponse({ version: "0.32.5" });
      if (path === "/api/generate") return jsonResponse({
        load_duration: 2_000_000,
        total_duration: 3_000_000
      });
      return jsonResponse({
        models: routerInstalled ? [{ name: INTELLIGENCE_ROUTER_MODEL, size: 1 }] : []
      });
    }
  });

  const state = await manager.ensureRouter();
  assert.equal(state.ready, true);
  assert.deepEqual(created, [{
    model: INTELLIGENCE_ROUTER_MODEL,
    modelfilePath: "/bundle/router/Modelfile"
  }]);
  await manager.ensureRouter();
  assert.equal(created.length, 1);
  const warmed = await manager.warmRouter();
  assert.equal(warmed.model, INTELLIGENCE_ROUTER_MODEL);
  assert.equal(warmed.loadMs, 2);
  assert.equal(warmed.keepAlive, "30m");
});

test("Ollama manager blocks a router whose release checksum does not match", async () => {
  let created = false;
  const runtimeManager = {
    baseUrl: "http://127.0.0.1:11435",
    state: () => ({ installed: true, status: "stopped", error: null }),
    start: async () => ({ installed: true, status: "starting", error: null }),
    markReady: () => ({ installed: true, status: "ready", error: null }),
    createModel: async () => { created = true; }
  };
  const manager = new OllamaModelManager({
    runtimeManager,
    routerBundlePath: "/bundle/router",
    digestFileImpl: async () => "0".repeat(64),
    sleepImpl: async () => {},
    fetchImpl: async (url) => jsonResponse(
      new URL(url).pathname === "/api/version" ? { version: "0.32.5" } : { models: [] }
    )
  });

  await assert.rejects(() => manager.ensureRouter(), /release checksum/);
  assert.equal(created, false);
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" }
  });
}
