import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DesktopSettingsStore,
  sanitizeSettings
} from "../src/desktop/settingsStore.js";

test("desktop defaults to zero-config AMOS Hosted intelligence", () => {
  assert.equal(DEFAULT_DESKTOP_SETTINGS.provider, "amos-hosted");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.model, "auto");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.baseUrl, "");
  assert.equal(DEFAULT_DESKTOP_SETTINGS.reasoningEffort, "medium");
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
    /requires an Ollama or llama.cpp/
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
