import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DesktopSettingsStore,
  localAutoApproveEnabled,
  sanitizeSettings
} from "../src/desktop/settingsStore.js";

test("desktop defaults to zero-config AMOS Hosted intelligence", () => {
  assert.equal(DEFAULT_DESKTOP_SETTINGS.provider, "amos-hosted");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.model, "auto");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.baseUrl, "");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.intelligenceProfile, "auto");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.reasoningEffort, "");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.researchCheckpointMinutes, 5);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.autonomousCheckpointMinutes, 0);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.localApprovalMode, "ask");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.localApprovalWorkspace, "");
  assert.deepEqual(DEFAULT_DESKTOP_SETTINGS.localApprovalKinds, []);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.telemetryEnabled, null);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.onboardingCompletedAt, "");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.onboardingBoundary, "");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.hybridRouting.enabled, false);
});

test("research checkpoint settings are bounded while autonomous goals may run uninterrupted", () => {
  const settings = sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    researchCheckpointMinutes: 10,
    autonomousCheckpointMinutes: 60
  });
  assert.equal(settings.researchCheckpointMinutes, 10);
  assert.equal(settings.autonomousCheckpointMinutes, 60);
  assert.equal(sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    researchCheckpointMinutes: 999,
    autonomousCheckpointMinutes: -1
  }).researchCheckpointMinutes, 5);
  assert.equal(sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    researchCheckpointMinutes: 999,
    autonomousCheckpointMinutes: -1
  }).autonomousCheckpointMinutes, 0);
});

test("hybrid model recipes are explicit, bounded, and survive unrelated writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-hybrid-routing-"));
  const path = join(directory, "settings.json");
  const store = new DesktopSettingsStore({
    filePath: path,
    encrypt: (value) => value,
    decrypt: (value) => value
  });
  const hybridRouting = {
    enabled: true,
    localModel: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
    frontier: { provider: "kimi", model: "kimi-k3" },
    strategies: {
      routine: "local",
      balanced: "local",
      deep: "local-review",
      frontier: "frontier"
    }
  };

  await store.write({ ...DEFAULT_DESKTOP_SETTINGS, hybridRouting });
  await store.write({ ...(await store.read()), appearance: "dark" });
  const saved = await store.read();

  assert.deepEqual(saved.hybridRouting, hybridRouting);
  assert.equal(saved.appearance, "dark");
  const invalid = sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    hybridRouting: {
      enabled: true,
      frontier: { provider: "not-a-provider", model: "anything" },
      strategies: { routine: "regex" }
    }
  });
  assert.deepEqual(invalid.hybridRouting.frontier, { provider: "amos-hosted", model: "auto" });
  assert.equal(invalid.hybridRouting.strategies.routine, "local");
});

test("desktop telemetry preference survives an unrelated settings write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-telemetry-pref-"));
  const path = join(directory, "settings.json");
  const store = new DesktopSettingsStore({
    filePath: path,
    encrypt: (value) => value,
    decrypt: (value) => value
  });

  await store.write({
    ...DEFAULT_DESKTOP_SETTINGS,
    telemetryEnabled: true
  });
  await store.write({
    ...(await store.read()),
    appearance: "dark"
  });

  const saved = await store.read();
  assert.equal(saved.telemetryEnabled, true);
  assert.equal(saved.appearance, "dark");
  assert.equal(
    sanitizeSettings({ ...DEFAULT_DESKTOP_SETTINGS, telemetryEnabled: false }).telemetryEnabled,
    false
  );
  assert.equal(
    sanitizeSettings({ ...DEFAULT_DESKTOP_SETTINGS, telemetryEnabled: "yes" }).telemetryEnabled,
    null
  );
});

test("desktop onboarding completion survives an unrelated settings write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-onboarding-pref-"));
  const path = join(directory, "settings.json");
  const store = new DesktopSettingsStore({
    filePath: path,
    encrypt: (value) => value,
    decrypt: (value) => value
  });
  const completedAt = "2026-08-14T12:00:00.000Z";

  await store.write({
    ...DEFAULT_DESKTOP_SETTINGS,
    onboardingCompletedAt: completedAt,
    onboardingBoundary: "personal"
  });
  await store.write({
    ...(await store.read()),
    appearance: "dark"
  });

  const saved = await store.read();
  assert.equal(saved.onboardingCompletedAt, completedAt);
  assert.equal(saved.onboardingBoundary, "personal");
  assert.equal(saved.appearance, "dark");
  assert.equal(
    sanitizeSettings({ ...DEFAULT_DESKTOP_SETTINGS, onboardingBoundary: "lab" }).onboardingBoundary,
    ""
  );
  assert.equal(
    sanitizeSettings({
      ...DEFAULT_DESKTOP_SETTINGS,
      onboardingCompletedAt: "not-a-date"
    }).onboardingCompletedAt,
    ""
  );
});

test("local auto-approve is pinned to one exact selected workspace", () => {
  const trusted = sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    workspace: "/tmp/project-a",
    localApprovalMode: "workspace",
    localApprovalWorkspace: "/tmp/project-a"
  });
  assert.equal(localAutoApproveEnabled(trusted), true);

  const changed = sanitizeSettings({
    ...trusted,
    workspace: "/tmp/project-b"
  });
  assert.equal(changed.localApprovalMode, "ask");
  assert.equal(changed.localApprovalWorkspace, "");
  assert.equal(localAutoApproveEnabled(changed), false);
});

test("AMOS Intelligence always stores automatic routing and strips provider-specific routing", () => {
  const settings = sanitizeSettings({
    provider: "amos-hosted",
    model: "kimi-k3",
    baseUrl: "https://api.moonshot.ai/v1",
    apiKey: "must-not-survive",
    intelligenceProfile: "frontier",
    reasoningEffort: "low",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });

  assert.equal(settings.model, "auto");
  assert.equal(settings.baseUrl, "");
  assert.equal(settings.apiKey, "");
  assert.equal(settings.intelligenceProfile, "auto");
  assert.equal(settings.reasoningEffort, "");
});

test("legacy AMOS Intelligence tiers migrate into automatic routing", () => {
  const settings = sanitizeSettings({
    provider: "amos-hosted",
    reasoningEffort: "high",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.equal(settings.intelligenceProfile, "auto");
  assert.equal(settings.reasoningEffort, "");
});

test("stored managed tiers and provider keys migrate before reaching the runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-managed-migration-"));
  const path = join(directory, "settings.json");
  await writeFile(path, JSON.stringify({
    version: 1,
    settings: {
      ...DEFAULT_DESKTOP_SETTINGS,
      intelligenceProfile: "frontier",
      reasoningEffort: "max",
      model: "provider-model",
      baseUrl: "https://provider.example/v1"
    },
    encryptedApiKey: "legacy-provider-key"
  }));
  const store = new DesktopSettingsStore({
    filePath: path,
    encrypt: (value) => value,
    decrypt: (value) => value
  });

  const settings = await store.read();
  assert.equal(settings.model, "auto");
  assert.equal(settings.intelligenceProfile, "auto");
  assert.equal(settings.reasoningEffort, "");
  assert.equal(settings.baseUrl, "");
  assert.equal(settings.apiKey, "");
});

test("personal workspace mode allows a cloud model without AMOS company access", () => {
  const settings = sanitizeSettings({
    provider: "kimi",
    model: "kimi-k3",
    operatingMode: "personal",
    baseUrl: "https://api.moonshot.ai/v1",
    apiKey: "customer-key",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.equal(settings.operatingMode, "personal");
});

test("desktop settings accept native OpenAI, Anthropic, and xAI providers", () => {
  const openai = sanitizeSettings({
    provider: "openai",
    model: "gpt-5.6-terra",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "openai-key",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  const anthropic = sanitizeSettings({
    provider: "anthropic",
    model: "claude-sonnet-5",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "anthropic-key",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.equal(openai.provider, "openai");
  assert.equal(openai.apiKey, "openai-key");
  assert.equal(anthropic.provider, "anthropic");
  assert.equal(anthropic.apiKey, "anthropic-key");
  const grok = sanitizeSettings({
    provider: "xai",
    model: "grok-4.6",
    baseUrl: "https://api.x.ai/v1",
    apiKey: "xai-key",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.equal(grok.provider, "xai");
  assert.equal(grok.model, "grok-4.6");
  assert.equal(grok.apiKey, "xai-key");
});

test("desktop settings keep per-provider credentials and a planner/builder/checker pair", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-roles-"));
  const path = join(directory, "settings.json");
  const store = new DesktopSettingsStore({
    filePath: path,
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  });
  await store.write({
    ...DEFAULT_DESKTOP_SETTINGS,
    provider: "xai",
    model: "grok-4.6",
    baseUrl: "https://api.x.ai/v1",
    apiKey: "xai-key",
    providerCredentials: { kimi: "kimi-key" },
    intelligenceRoles: {
      enabled: true,
      planner: { provider: "kimi", model: "kimi-k3" },
      implementer: { provider: "xai", model: "grok-4.6" },
      checker: { provider: "kimi", model: "kimi-k3" }
    },
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  const settings = await store.read();
  assert.equal(settings.provider, "xai");
  assert.equal(settings.apiKey, "xai-key");
  assert.equal(settings.providerCredentials.kimi, "kimi-key");
  assert.equal(settings.providerCredentials.xai, "xai-key");
  assert.equal(settings.intelligenceRoles.enabled, true);
  assert.equal(settings.intelligenceRoles.implementer.model, "grok-4.6");
  assert.equal(JSON.parse(await readFile(path, "utf8")).settings.providerCredentials, undefined);
});

test("desktop settings encrypt provider credentials at rest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-settings-"));
  const path = join(directory, "settings.json");
  const store = new DesktopSettingsStore({
    filePath: path,
    encrypt: (value) => Buffer.from(`protected:${value}`).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString().replace(/^protected:/, "")
  });

  await store.write({
    provider: "bedrock",
    model: "openai.gpt-oss-120b",
    baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
    reasoningEffort: "high",
    workspace: "/tmp/work",
    amosMcpUrl: "https://app.amoslabs.com/mcp",
    apiKey: "secret-bedrock-key"
  });

  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes("secret-bedrock-key"), false);
  assert.equal((await store.read()).apiKey, "secret-bedrock-key");
});

test("desktop upgrades preserve compatible settings and encrypted provider credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-settings-upgrade-"));
  const path = join(directory, "settings.json");
  await writeFile(path, JSON.stringify({
    version: 2,
    settings: {
      ...DEFAULT_DESKTOP_SETTINGS,
      provider: "openai",
      model: "gpt-5.6-terra",
      baseUrl: "https://api.openai.com/v1"
    },
    encryptedApiKey: "openai-key",
    encryptedProviderCredentials: JSON.stringify({
      openai: "openai-key",
      xai: "xai-key"
    })
  }));
  const store = new DesktopSettingsStore({
    filePath: path,
    encrypt: (value) => value,
    decrypt: (value) => value
  });

  const settings = await store.read();
  assert.equal(settings.provider, "openai");
  assert.equal(settings.model, "gpt-5.6-terra");
  assert.equal(settings.apiKey, "openai-key");
  assert.deepEqual(settings.providerCredentials, {
    openai: "openai-key",
    xai: "xai-key"
  });
});

test("trusted Desktop workspace projects local approval flags into the runtime environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-trust-"));
  const path = join(directory, "settings.json");
  const store = new DesktopSettingsStore({
    filePath: path,
    encrypt: (value) => value,
    decrypt: (value) => value
  });
  await store.write({
    ...DEFAULT_DESKTOP_SETTINGS,
    workspace: "/tmp/trusted-project",
    localApprovalMode: "workspace",
    localApprovalWorkspace: "/tmp/trusted-project"
  });

  const env = await store.asEnvironment();
  assert.equal(env.AMOS_AGENT_WORKSPACE, "/tmp/trusted-project");
  assert.equal(env.AMOS_AGENT_AUTO_APPROVE_BASH, "true");
  assert.equal(env.AMOS_AGENT_AUTO_APPROVE_WRITES, "true");
  assert.equal(env.AMOS_AGENT_AUTO_APPROVE_KINDS, "");
});

test("desktop settings reject non-local cleartext endpoints", () => {
  assert.throws(
    () =>
      sanitizeSettings({
        provider: "openai-compatible",
        baseUrl: "http://inference.example.com/v1",
        amosMcpUrl: "https://app.amoslabs.com/mcp"
      }),
    /HTTPS/
  );
});

test("desktop settings allow local HTTP inference but require HTTPS for AMOS", () => {
  const settings = sanitizeSettings({
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.equal(settings.baseUrl, "http://127.0.0.1:11434/v1");

  const ipv6 = sanitizeSettings({
    provider: "llama-cpp",
    baseUrl: "http://[::1]:8080/v1",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.equal(ipv6.baseUrl, "http://[::1]:8080/v1");
});

test("desktop settings accept only known intelligence providers", () => {
  assert.throws(
    () =>
      sanitizeSettings({
        provider: "untrusted-runtime",
        baseUrl: "https://models.example.com/v1",
        amosMcpUrl: "https://app.amoslabs.com/mcp"
      }),
    /Unsupported intelligence provider/
  );
});

test("desktop appearance defaults to the Mac and accepts explicit overrides", () => {
  assert.equal(sanitizeSettings(DEFAULT_DESKTOP_SETTINGS).appearance, "system");
  assert.equal(
    sanitizeSettings({ ...DEFAULT_DESKTOP_SETTINGS, appearance: "light" }).appearance,
    "light"
  );
  assert.equal(
    sanitizeSettings({ ...DEFAULT_DESKTOP_SETTINGS, appearance: "dark" }).appearance,
    "dark"
  );
  assert.equal(
    sanitizeSettings({ ...DEFAULT_DESKTOP_SETTINGS, appearance: "sepia" }).appearance,
    "system"
  );
});

test("local-only mode requires a local intelligence provider", () => {
  assert.throws(
    () =>
      sanitizeSettings({
        provider: "kimi",
        operatingMode: "offline",
        baseUrl: "https://api.moonshot.ai/v1",
        amosMcpUrl: "https://app.amoslabs.com/mcp"
      }),
    /requires Ollama or llama.cpp infrastructure/
  );

  const settings = sanitizeSettings({
    provider: "ollama",
    model: "qwen3:4b",
    operatingMode: "offline",
    baseUrl: "http://127.0.0.1:11434/v1",
    amosMcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.equal(settings.operatingMode, "offline");
});

test("desktop settings retain only a bounded approval-notification history", () => {
  const notifiedApprovalIds = Array.from({ length: 205 }, (_, index) =>
    `${index}`.padStart(36, "0")
  );
  const sanitized = sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    notifiedApprovalIds
  });

  assert.equal(sanitized.notifiedApprovalIds.length, 200);
  assert.equal(sanitized.notifiedApprovalIds[0], notifiedApprovalIds[5]);
  assert.equal(sanitized.notifiedApprovalIds.at(-1), notifiedApprovalIds.at(-1));
});

test("desktop settings retain only a bounded Mission-decision notification history", () => {
  const notifiedMissionDecisionIds = Array.from({ length: 205 }, (_, index) =>
    `mission-${index}`
  );
  const sanitized = sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    notifiedMissionDecisionIds
  });

  assert.equal(sanitized.notifiedMissionDecisionIds.length, 200);
  assert.equal(sanitized.notifiedMissionDecisionIds[0], notifiedMissionDecisionIds[5]);
  assert.equal(
    sanitized.notifiedMissionDecisionIds.at(-1),
    notifiedMissionDecisionIds.at(-1)
  );
});

test("desktop settings retain only a bounded delivered approval-outcome history", () => {
  const deliveredApprovalOutcomeIds = Array.from({ length: 205 }, (_, index) =>
    `outcome-${index}`
  );
  const sanitized = sanitizeSettings({
    ...DEFAULT_DESKTOP_SETTINGS,
    deliveredApprovalOutcomeIds
  });

  assert.equal(sanitized.deliveredApprovalOutcomeIds.length, 200);
  assert.equal(sanitized.deliveredApprovalOutcomeIds[0], deliveredApprovalOutcomeIds[5]);
  assert.equal(
    sanitized.deliveredApprovalOutcomeIds.at(-1),
    deliveredApprovalOutcomeIds.at(-1)
  );
});
