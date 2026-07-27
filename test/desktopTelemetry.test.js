import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import { DesktopTelemetry } from "../src/desktop/telemetry.js";

test("Desktop telemetry creates a random install id and sends first launch once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-telemetry-"));
  const requests = [];
  const telemetry = new DesktopTelemetry({
    filePath: join(directory, "telemetry.json"),
    appVersion: "0.15.0",
    platform: "darwin",
    architecture: "arm64",
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 202 };
    }
  });

  const firstId = await telemetry.initialize({ mcpUrl: "https://app.amoslabs.com/mcp" });
  const secondId = await telemetry.initialize({ mcpUrl: "https://app.amoslabs.com/mcp" });

  assert.match(firstId, /^[0-9a-f-]{36}$/i);
  assert.equal(secondId, firstId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://app.amoslabs.com/api/v1/desktop/events");
  assert.equal(requests[0].body.event_type, "desktop_first_launch");
  assert.equal(requests[0].body.install_id, firstId);
  assert.equal(requests[0].body.platform, "darwin");
  assert.ok(!requests[0].options.headers.Authorization);

  const stored = JSON.parse(await readFile(join(directory, "telemetry.json"), "utf8"));
  assert.deepEqual(stored.pending, []);
  assert.deepEqual(stored.completed, ["desktop_first_launch"]);
});

test("Desktop telemetry retains transient failures and never persists bearer tokens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-telemetry-retry-"));
  let attempts = 0;
  const telemetry = new DesktopTelemetry({
    filePath: join(directory, "telemetry.json"),
    fetchImpl: async (_url, options) => {
      attempts += 1;
      assert.equal(options.headers.Authorization, "Bearer demo-secret");
      return { ok: attempts > 1, status: attempts > 1 ? 202 : 503 };
    }
  });

  await telemetry.record("northwind_demo_value_reached", {
    mcpUrl: "https://app.amoslabs.com/mcp",
    accessToken: "demo-secret",
    once: true
  });
  let raw = await readFile(join(directory, "telemetry.json"), "utf8");
  assert.equal(JSON.parse(raw).pending.length, 1);
  assert.ok(!raw.includes("demo-secret"));

  await telemetry.flush({
    mcpUrl: "https://app.amoslabs.com/mcp",
    accessToken: "demo-secret"
  });
  raw = await readFile(join(directory, "telemetry.json"), "utf8");
  assert.equal(JSON.parse(raw).pending.length, 0);
});

test("completed Northwind tool work records the value milestone once", async () => {
  const calls = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-desktop-telemetry-controller",
    settingsStore: { read: async () => ({ amosMcpUrl: "https://app.amoslabs.com/mcp" }) },
    telemetry: {
      async record(...args) {
        calls.push(args);
      }
    },
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({
    status: async () => ({ demo: true, access_token: "demo-secret" })
  });

  await controller.recordNorthwindValue(
    { amosMcpUrl: "https://app.amoslabs.com/mcp" },
    [{ type: "tool_end", tool: "list_records" }]
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "northwind_demo_value_reached");
  assert.equal(calls[0][1].accessToken, "demo-secret");
  assert.equal(calls[0][1].once, true);
});
