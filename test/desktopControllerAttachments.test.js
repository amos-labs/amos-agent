import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DesktopController,
  shouldActivateAmosHosted,
  shouldUseDesktopOAuth
} from "../src/desktop/controller.js";

test("AMOS sign-in only replaces the legacy unconfigured Kimi default", () => {
  assert.equal(
    shouldActivateAmosHosted({
      provider: "kimi",
      model: "kimi-k3",
      baseUrl: "https://api.moonshot.ai/v1",
      apiKey: ""
    }),
    true
  );
  assert.equal(
    shouldActivateAmosHosted({
      provider: "kimi",
      model: "kimi-k3",
      baseUrl: "https://api.moonshot.ai/v1",
      apiKey: "customer-key"
    }),
    false
  );
  assert.equal(
    shouldActivateAmosHosted({
      provider: "ollama",
      model: "qwen3:4b",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: ""
    }),
    false
  );
});

test("expired demo credentials never keep AMOS Desktop connected", () => {
  const config = { auth: { mode: "oauth" } };
  assert.equal(
    shouldUseDesktopOAuth(
      config,
      { access_token: "demo", demo: true, expires_at: 2_000 },
      1_000
    ),
    true
  );
  assert.equal(
    shouldUseDesktopOAuth(
      config,
      { access_token: "demo", demo: true, expires_at: 1_000 },
      1_000
    ),
    false
  );
  assert.equal(
    shouldUseDesktopOAuth(config, { access_token: "oauth", expires_at: 1_000 }, 2_000),
    true
  );
});

test("active AMOS members cannot replace their company with the Northwind demo", async () => {
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-active-account",
    settingsStore: {
      read: async () => ({
        operatingMode: "online",
        amosMcpUrl: "https://app.amoslabs.com/mcp"
      })
    },
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({
    status: async () => ({ access_token: "active-member-token", demo: false })
  });
  controller.accountStatusFor = async () => ({
    subscriptionStatus: "trialing",
    billingExempt: false,
    workspaceActive: true
  });

  await assert.rejects(
    controller.startDemo(),
    /workspace is already active.*connect data, applications, memory, and policy/i
  );
});

test("starting an automation build opens an isolated context lane without clearing the prior lane", async () => {
  const events = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-controller-automation-lane",
    settingsStore: {
      read: async () => ({
        operatingMode: "personal",
        provider: "ollama",
        model: "qwen",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "",
        reasoningEffort: "medium",
        workspace: "/tmp",
        amosMcpUrl: "https://app.amoslabs.com/mcp"
      })
    },
    openBrowser() {},
    emit(channel, payload) {
      events.push({ channel, payload });
    }
  });
  controller.sendRemoteState = async () => {};
  controller.state = async () => ({ activeContextKey: controller.activeContextKey });
  controller.activity = [{ id: "prior-activity" }];
  controller.canvases.present({
    version: "1",
    title: "Prior canvas",
    source: { kind: "local", label: "test", references: [] },
    state: { kind: "loading", message: "Preparing prior canvas" },
    blocks: []
  });

  const result = await controller.startNewConversation({
    kind: "automation_builder",
    title: "Build an automation",
    objective: "Build the deterministic scorecard follow-up"
  });

  assert.equal(result.launch.previousContextKey, "active");
  assert.match(result.launch.contextKey, /^task:[0-9a-f-]{36}$/);
  assert.equal(result.state.activeContextKey, result.launch.contextKey);
  assert.equal(controller.canvases.list().length, 0);
  assert.equal(controller.activity.length, 1);
  assert.equal(controller.activity[0].detail.previous_context_key, "active");
  assert.ok(events.some((event) => event.channel === "canvas:changed"));
});

test("desktop explicitly promotes selected document attachments into governed company memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-controller-attachments-"));
  const path = join(root, "brief.md");
  await writeFile(path, "Durable launch evidence.");
  const events = [];
  let stored;
  let modelContent;
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: { read: async () => ({ operatingMode: "online" }) },
    openBrowser() {},
    emit(channel, payload) {
      events.push({ channel, payload });
    }
  });
  const [attachment] = await controller.addAttachmentPaths([path]);
  controller.getRuntime = async () => ({
    config: { model: { capabilities: { vision: false } } },
    runtime: {
      modelClient: {},
      amosClient: {
        async callTool(name, args) {
          stored = { name, args };
          return { document_id: "document-1", status: "indexed" };
        }
      },
      loop: {
        async run(content) {
          modelContent = content;
          return "done";
        }
      }
    }
  });

  const result = await controller.run({
    text: "Use the evidence",
    attachments: [{ id: attachment.id, retention: "company" }]
  });

  assert.equal(stored.name, "call_engine_tool");
  assert.equal(stored.args.engine, "company");
  assert.equal(stored.args.tool, "store_document");
  assert.equal(stored.args.arguments.content, "Durable launch evidence.");
  assert.match(modelContent, /Durable launch evidence/);
  assert.equal(result.attachments[0].memoryStatus, "requested");
  assert.ok(events.some((event) => event.payload?.name === "amos_company_store_document"));
});
