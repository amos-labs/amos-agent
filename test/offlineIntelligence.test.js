import test from "node:test";
import assert from "node:assert/strict";
import {
  assessHardware,
  OllamaModelManager,
  releaseSignedManifest
} from "../src/desktop/offlineIntelligence.js";
import { createRegistry } from "../src/runtime.js";

test("hardware assessment recommends a bounded curated profile", () => {
  const compact = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 8,
    freeMemoryGb: 4
  });
  assert.equal(compact.localTier, "compact");
  assert.equal(compact.recommendedModelId, "qwen3:4b");

  const capable = assessHardware({
    platform: "darwin",
    release: "test",
    arch: "arm64",
    memoryGb: 32,
    freeMemoryGb: 20
  });
  assert.equal(capable.localTier, "capable");
  assert.equal(capable.recommendedModelId, "gpt-oss:20b");
});

test("curated model manifest is release-signed and content-addressed", () => {
  const manifest = releaseSignedManifest();
  assert.equal(manifest.trust, "release-signed");
  assert.match(manifest.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    manifest.models.map((model) => model.id),
    ["qwen3:4b", "qwen3:8b", "gpt-oss:20b"]
  );
});

test("offline registry omits all AMOS and public-web tools", () => {
  const tools = createRegistry({ includeAmos: false, includeWeb: false }).list();
  assert.equal(tools.some((tool) => tool.source === "amos"), false);
  assert.equal(tools.some((tool) => tool.name.startsWith("amos_")), false);
  assert.equal(tools.some((tool) => tool.name.startsWith("web_")), false);
  assert.ok(tools.some((tool) => tool.name === "search_files"));
  assert.ok(tools.some((tool) => tool.name === "run_bash"));
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

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" }
  });
}
