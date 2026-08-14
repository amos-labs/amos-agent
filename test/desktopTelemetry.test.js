import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import { DesktopTelemetry } from "../src/desktop/telemetry.js";

test("Desktop telemetry initialize does not fire without consent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-telemetry-opt-out-"));
  const requests = [];
  const telemetry = new DesktopTelemetry({
    filePath: join(directory, "telemetry.json"),
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 202 };
    }
  });

  const unset = await telemetry.initialize({ mcpUrl: "https://app.amoslabs.com/mcp" });
  const declined = await telemetry.initialize({
    mcpUrl: "https://app.amoslabs.com/mcp",
    telemetryEnabled: false
  });
  await telemetry.record("desktop_first_launch", { mcpUrl: "https://app.amoslabs.com/mcp" });

  assert.equal(unset, "");
  assert.equal(declined, "");
  assert.equal(requests.length, 0);
});

test("Desktop telemetry creates a random install id and sends first launch once after consent", async () => {
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

  const firstId = await telemetry.initialize({
    mcpUrl: "https://app.amoslabs.com/mcp",
    telemetryEnabled: true
  });
  const secondId = await telemetry.initialize({
    mcpUrl: "https://app.amoslabs.com/mcp",
    telemetryEnabled: true
  });

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

test("Desktop telemetry records first launch and the consent choice only after opt-in", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-telemetry-choice-"));
  const requests = [];
  const telemetry = new DesktopTelemetry({
    filePath: join(directory, "telemetry.json"),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, status: 202 };
    }
  });

  await telemetry.applyPreference({
    enabled: false,
    mcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.equal(requests.length, 0);

  await telemetry.applyPreference({
    enabled: true,
    mcpUrl: "https://app.amoslabs.com/mcp"
  });
  assert.deepEqual(requests.map((event) => event.event_type), [
    "desktop_first_launch",
    "desktop_telemetry_choice"
  ]);
  assert.equal(requests[1].context.enabled, true);
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
  telemetry.setEnabled(true);

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
