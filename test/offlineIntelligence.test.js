import test from "node:test";
import assert from "node:assert/strict";
import {
  assessHardware,
  OllamaModelManager,
  releaseSignedManifest
} from "../src/desktop/offlineIntelligence.js";
import { routeModelStep } from "../src/model/capabilityRouter.js";
import { createRegistry } from "../src/runtime.js";
import {
  INTELLIGENCE_ROUTER_ARTIFACT,
  INTELLIGENCE_ROUTER_MODEL
} from "../src/model/intelligenceRouter.js";

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
  assert.equal(sixteenGig.recommendedModelId, "gpt-oss:20b");
  assert.equal(sixteenGig.recommendedVisionModelId, null);

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
  assert.equal(professional.recommendedModelId, "gpt-oss:20b");
  assert.equal(professional.recommendedVisionModelId, "qwen3.6:27b-q4_K_M");

  const professionalMax = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 64,
    freeMemoryGb: 48
  });
  assert.equal(professionalMax.localTier, "professional-max");
  assert.equal(professionalMax.recommendedModelId, "gpt-oss:20b");
  assert.equal(professionalMax.recommendedVisionModelId, "qwen3.6:27b-q4_K_M");
});

test("curated model manifest is release-signed and content-addressed", () => {
  const manifest = releaseSignedManifest();
  assert.equal(manifest.version, 5);
  assert.equal(manifest.trust, "release-signed");
  assert.match(manifest.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    manifest.models.map((model) => model.id),
    [
      "qwen3:4b",
      "qwen3:8b",
      "gpt-oss:20b",
      "qwen3.6:27b-q4_K_M",
      "qwen3.6:27b-q8_0"
    ]
  );
  const compact = manifest.models.find((model) => model.id === "qwen3:4b");
  const balanced = manifest.models.find((model) => model.id === "qwen3:8b");
  const capable = manifest.models.find((model) => model.id === "gpt-oss:20b");
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
  assert.equal(capable.qualification.status, "conditional");
  assert.equal(visionMax.experimental, true);
  assert.equal(visionMax.qualification.status, "experimental");
});

test("release-signed local contracts expose qualified grants instead of marketing claims", () => {
  const manifest = releaseSignedManifest();
  const gptOss = manifest.models.find((model) => model.id === "gpt-oss:20b");
  const vision = manifest.models.find((model) => model.id === "qwen3.6:27b-q4_K_M");
  assert.equal(gptOss.capabilityContract.status, "conditional");
  assert.deepEqual(gptOss.capabilityContract.grants.autonomy, ["observe", "draft", "propose"]);
  assert.equal(
    gptOss.capabilityContract.grants.capabilities.includes("approval-state-integrity"),
    false
  );
  assert.ok(vision.capabilities.includes("vision"));
  assert.equal(vision.capabilityContract.grants.modalities.includes("vision"), false);

  const executionRoute = routeModelStep({
    requirements: { autonomy: "execute" },
    candidates: manifest.models
      .filter((model) => model.capabilityContract)
      .map((model) => model.capabilityContract)
  });
  assert.equal(executionRoute.selected, null);
  assert.ok(executionRoute.rejected.every((item) =>
    item.reasons.some((reason) =>
      ["autonomy-not-qualified", "status-not-allowed"].includes(reason.code)
    )
  ));
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
