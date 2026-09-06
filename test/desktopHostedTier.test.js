import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopSettingsStore, DEFAULT_DESKTOP_SETTINGS, sanitizeSettings } from "../src/desktop/settingsStore.js";
import { DesktopController, desktopSystemPrompt } from "../src/desktop/controller.js";
import { createModelClient, resolveModelConfig } from "../src/model/providers.js";
import { hybridRoutingEnabled } from "../src/model/hybridRouting.js";

const hosted = { ...DEFAULT_DESKTOP_SETTINGS, apiKey: "" };

test("hosted tier persists across restart, defaults safely and does not revive legacy profiles", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amos-manual-tier-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "settings.json");
  const open = () => new DesktopSettingsStore({ filePath, encrypt: v => v, decrypt: v => v });
  await open().write({ ...hosted, hostedTier: "frontier" });
  assert.equal((await open().read()).hostedTier, "frontier");
  assert.equal((await open().asEnvironment()).AMOS_HOSTED_TIER, "frontier");
  await open().write({ ...hosted, hostedTier: "auto" });
  assert.equal((await open().read()).hostedTier, "auto");
  assert.equal(sanitizeSettings({ ...hosted, hostedTier: "vendor-model" }).hostedTier, "auto");
  await writeFile(filePath, JSON.stringify({ version: 1, settings: { provider: "amos-hosted", intelligenceProfile: "frontier" } }));
  assert.equal((await open().read()).hostedTier, "auto");
});

for (const tier of ["routine", "balanced", "deep", "frontier"]) {
  test(`manual ${tier} skips router and sends the chosen class on initial and continuation requests`, async () => {
    const config = resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: tier,
      AMOS_MCP_URL: "https://app.amoslabs.com/mcp", AMOS_LOCAL_ROUTER_MODE: "active" });
    assert.equal(config.routingMode, "manual");
    assert.equal(config.localRouterMode, "disabled");
    const bodies = [], decisions = [];
    const client = createModelClient({ ...config,
      intelligenceRouter: { classify() { throw new Error("manual mode invoked router"); } }
    }, async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    });
    for (const messages of [
      [{ role: "user", content: "Review the project" }],
      [{ role: "user", content: "Review the project" }, { role: "tool", tool_call_id: "read", content: "source" }]
    ]) {
      await client.chat({ messages, preclassifiedRouting: { minimumClass: "balanced" },
        skipLocalRouting: true, onRoutingDecision: d => decisions.push(d) });
    }
    assert.deepEqual(bodies.map(b => b.amos_routing.minimum_class), [tier, tier]);
    assert.deepEqual(bodies.map(b => b.amos_routing.phase), ["plan", "continue"]);
    assert.ok(bodies.every(b => b.model === "auto" && b.amos_routing.source === "desktop-manual-tier"));
    assert.ok(bodies.every(b => !b.amos_routing.classifier_contract && !b.amos_routing_shadow));
    assert.ok(decisions.filter(d => d.status === "manual").every(d => d.latencyMs === 0));
  });
}

test("manual Desktop mode bypasses router preparation and optional switching while keeping preferences", async () => {
  const settings = { ...hosted, hostedTier: "frontier", hybridRouting: { enabled: true },
    intelligenceRoles: { enabled: true } };
  let prepares = 0;
  const controller = new DesktopController({ userDataPath: "/tmp/amos-manual-tier-controller",
    settingsStore: { read: async () => settings },
    offlineManager: {
      ensureRouter() { prepares++; throw new Error("must not start router"); },
      warmRouter() { prepares++; throw new Error("must not warm router"); },
      refresh() { throw new Error("must not prepare inactive hybrid model"); }
    },
    openBrowser() {}, emit() {} });
  const decision = await controller.classifyTaskRouting({ settings, boundary: "online",
    prompt: "Modernize this app", pairing: { enabled: true } });
  assert.equal(decision, null);
  assert.equal(await controller.warmLocalIntelligence(settings), null);
  assert.equal(prepares, 0);
  assert.equal(controller.configFrom(settings).model.localRouterMode, "disabled");
  assert.equal(controller.buildHybridRoutingRuntime({ settings, boundary: "online", router: null }), null);
  const role = await controller.applyIntelligenceRole("planner", { settings, announce: false });
  assert.equal(role.intelligence.provider, "amos-hosted");
  assert.equal(settings.intelligenceRoles.enabled, true);
  assert.doesNotMatch(desktopSystemPrompt("Base", settings, {}), /Coding-role pairing is on/);
  assert.equal(hybridRoutingEnabled({ ...settings, hostedTier: "auto" }), true);
});

test("saving a manual tier resets runtime and tolerates inactive hybrid credentials", async () => {
  let current = { ...hosted, hybridRouting: { enabled: true,
    frontier: { provider: "openai", model: "gpt-5.6-terra" } } };
  const controller = new DesktopController({ userDataPath: "/tmp/amos-save-manual-tier",
    settingsStore: { read: async () => current, write: async value => (current = value) },
    openBrowser() {}, emit() {} });
  controller.state = async () => ({ settings: current });
  let resets = 0;
  const records = [];
  controller.resetRuntime = () => { resets++; };
  controller.record = (_type, summary) => records.push(summary);
  await controller.saveSettings({ hostedTier: "frontier" });
  assert.equal(current.hostedTier, "frontier");
  assert.equal(resets, 1);
  assert.ok(records.some(summary => summary.includes("AMOS Intelligence · Frontier")));
  assert.equal(current.hybridRouting.enabled, true);
  await assert.rejects(controller.saveSettings({ hostedTier: "auto" }), /Finish OpenAI setup/);
  assert.equal(current.hostedTier, "frontier");
  controller.runManager.nonTerminal = () => [{}];
  await assert.rejects(controller.saveSettings({ hostedTier: "deep" }), /Finish or stop running tasks/);
  assert.equal(current.hostedTier, "frontier");
});

test("switching back to Auto re-enables classification", async () => {
  let calls = 0, body;
  const config = resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "auto",
    AMOS_MCP_URL: "https://app.amoslabs.com/mcp" });
  assert.equal(config.routingMode, "automatic");
  const client = createModelClient({ ...config, intelligenceRouter: { async classify() {
    calls++; return { minimumClass: "deep" };
  } } }, async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  });
  await client.chat({ messages: [{ role: "user", content: "Plan this" }] });
  assert.equal(calls, 1);
  assert.equal(body.amos_routing.minimum_class, "deep");
});

test("hosted tier cannot inject AMOS routing into a separately selected provider", async () => {
  let body;
  const config = resolveModelConfig({ AMOS_MODEL_PROVIDER: "ollama", AMOS_HOSTED_TIER: "frontier" });
  assert.equal(config.routingMode, "pinned");
  assert.equal(config.hostedTier, "auto");
  const client = createModelClient(config, async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  });
  await client.chat({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(body.amos_routing, undefined);
});
