import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";

const settings = {
  provider: "ollama",
  model: "qwen3:4b",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: "",
  reasoningEffort: "medium",
  workspace: "/tmp",
  amosMcpUrl: "https://app.amoslabs.com/mcp",
  operatingMode: "offline"
};

test("desktop local-only runtime admits only the verified company-cache read tool", async () => {
  const grant = {
    claims: {
      cache_id: "cache-1",
      sub: "user-1",
      tenant_id: "tenant-1",
      tenant_slug: "northwind",
      role: "owner",
      scope_fingerprint: "a".repeat(64),
      iat: 1_753_531_200,
      exp: 1_753_545_600
    },
    snapshot: {
      generated_at: "2025-07-26T12:00:00.000Z",
      company_state: { status: "available", name: "Northwind Labs" }
    }
  };
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-company-cache-controller",
    settingsStore: { read: async () => settings },
    companyCacheStore: {
      async read() {
        return grant;
      },
      async status() {
        return { status: "active", available: true };
      }
    },
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({ status: async () => ({}) });

  const { runtime } = await controller.getRuntime({
    requireAmos: false,
    offline: true
  });
  const tools = runtime.registry.list();
  assert.equal(tools.some((tool) => tool.name === "desktop_read_company_cache"), true);
  assert.equal(tools.some((tool) => tool.source === "amos"), false);
  assert.equal(tools.some((tool) => tool.name.startsWith("web_")), false);

  const result = await runtime.registry.execute("desktop_read_company_cache", {});
  assert.equal(result.provenance.live, false);
  assert.equal(result.company_state.name, "Northwind Labs");
});

test("desktop clears a saved company cache when live revalidation fails", async () => {
  let cleared = false;
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-company-cache-revalidation",
    settingsStore: { read: async () => settings },
    companyCacheStore: {
      async status() {
        return {
          status: "active",
          cacheId: "cache-1",
          available: true
        };
      },
      async read() {
        throw new Error("AMOS company cache belongs to a different user or company");
      },
      async clear() {
        cleared = true;
      }
    },
    openBrowser() {},
    emit() {}
  });
  const remote = {
    async fetchJwks() {
      return { keys: [] };
    }
  };

  await assert.rejects(
    controller.revalidateCompanyCache(
      remote,
      {
        sub: "user-2",
        tenant_id: "tenant-2",
        principal_type: "user"
      },
      settings
    ),
    /removed because AMOS could not revalidate/
  );
  assert.equal(cleared, true);
});
