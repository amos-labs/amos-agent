import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import { LocalReceiptStore } from "../src/desktop/localReceiptStore.js";
import { DEFAULT_DESKTOP_SETTINGS, DesktopSettingsStore } from "../src/desktop/settingsStore.js";
import { DesktopTelemetry } from "../src/desktop/telemetry.js";
import { createAbortError } from "../src/util/abort.js";

function identityEncrypt() {
  return {
    encrypt: (value) => value,
    decrypt: (value) => value
  };
}

function receiptEncrypt() {
  return {
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  };
}

function stubCreateRuntime({ onReady } = {}) {
  return () => ({
    loop: {
      async run(_content, { signal, onEvent } = {}) {
        onEvent?.({ type: "tool_start", name: "desktop_inspect_project", args: {} });
        onEvent?.({
          type: "tool_end",
          name: "desktop_inspect_project",
          result: { inspected: true }
        });
        onReady?.();
        await new Promise((_resolve, reject) => {
          const fail = () => reject(createAbortError());
          if (signal?.aborted) {
            fail();
            return;
          }
          signal?.addEventListener("abort", fail, { once: true });
        });
      },
      restoreContinuity() {
        return false;
      },
      clear() {}
    }
  });
}

async function firstRunHarness({ telemetryEnabled = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "amos-desktop-first-run-"));
  const workspace = join(directory, "workspace");
  await mkdir(workspace, { recursive: true });
  const requests = [];
  const settingsStore = new DesktopSettingsStore({
    filePath: join(directory, "settings.json"),
    ...identityEncrypt()
  });
  const localReceiptStore = new LocalReceiptStore({
    filePath: join(directory, "receipts.json"),
    ...receiptEncrypt()
  });
  const telemetry = new DesktopTelemetry({
    filePath: join(directory, "telemetry.json"),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, status: 202 };
    }
  });
  await telemetry.initialize({
    mcpUrl: DEFAULT_DESKTOP_SETTINGS.amosMcpUrl,
    telemetryEnabled
  });
  let started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const controller = new DesktopController({
    userDataPath: directory,
    settingsStore,
    localReceiptStore,
    telemetry,
    createRuntime: stubCreateRuntime({ onReady: started }),
    openBrowser() {},
    emit() {}
  });
  return { controller, workspace, requests, startedPromise };
}

test("first-run personal local/BYO walks to cancelTask and a local receipt", async () => {
  const { controller, workspace, requests, startedPromise } = await firstRunHarness();

  const personal = await controller.startPersonal();
  assert.equal(personal.settings.operatingMode, "personal");
  assert.equal(personal.settings.provider, "amos-hosted");
  assert.equal(personal.configured, false);

  await controller.saveSettings({
    provider: "openai",
    model: "gpt-5.6-terra",
    apiKey: "sk-test-first-run"
  });
  await controller.chooseWorkspace(workspace);
  const ready = await controller.state();
  assert.equal(ready.settings.operatingMode, "personal");
  assert.equal(ready.settings.provider, "openai");
  assert.equal(ready.settings.workspace, workspace);
  assert.equal(ready.configured, true);

  const runPromise = controller.run("Inspect this workspace");
  await startedPromise;
  const running = await controller.state();
  const runId = running.activeRuns[0]?.id;
  assert.ok(runId, "stubbed first-run task must occupy one Desktop lane");
  const canceled = await controller.cancelTask(runId);
  assert.equal(canceled.canceled, true);
  await assert.rejects(runPromise, (error) => error.code === "AMOS_TASK_CANCELED");

  const finished = await controller.state();
  assert.equal(finished.localReceipts.length, 1);
  assert.equal(finished.localReceipts[0].status, "canceled");
  assert.equal(finished.localReceipts[0].boundary, "personal");
  assert.equal(finished.localReceipts[0].workspace, "workspace");
  assert.ok(finished.localReceipts[0].events.some((event) =>
    event.type === "tool_end" && event.name === "desktop_inspect_project"
  ));
  assert.match(finished.localReceipts[0].digest, /^[a-f0-9]{64}$/);

  await controller.saveSettings({ provider: "amos-hosted" });
  const hostedPersonal = await controller.state();
  assert.equal(hostedPersonal.settings.operatingMode, "personal");
  assert.equal(hostedPersonal.settings.provider, "amos-hosted");
  assert.equal(hostedPersonal.configured, false);
  assert.equal(requests.some((event) => event.event_type === "desktop_first_launch"), false);
});

test("telemetry opt-out blocks desktop_first_launch on first-run", async () => {
  const { controller, requests } = await firstRunHarness({ telemetryEnabled: false });

  await controller.startPersonal();
  await controller.completeOnboarding({ boundary: "personal" });

  assert.equal(requests.length, 0);
  assert.equal(
    requests.some((event) => event.event_type === "desktop_first_launch"),
    false
  );
});
