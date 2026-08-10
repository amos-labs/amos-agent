import test from "node:test";
import assert from "node:assert/strict";
import { DesktopBrowserRuntime } from "../desktop/browserRuntime.js";
import { browserSessionCanvas } from "../src/desktop/browserCanvas.js";
import { createBrowserTools } from "../src/tools/browser.js";

const timestamp = "2026-08-10T12:00:00.000Z";
const scope = {
  boundary: "online",
  subjectId: "user-1",
  tenantId: "tenant-1",
  taskId: "task-1"
};

test("browser tools expose semantic read-only primitives and present deterministic canvas results", async () => {
  const calls = [];
  const browser = {
    async open(receivedScope, input) {
      calls.push({ method: "open", receivedScope, input });
      return browserResult();
    },
    async snapshot() { return browserResult(); },
    async extract() { return { ...browserResult(), kind: "article", data: { text: "Example" } }; },
    async screenshot() { return browserResult(); },
    async close() { return { ...browserResult(), status: "closed", frame: undefined }; }
  };
  const presented = [];
  const tools = createBrowserTools({
    browser,
    scope: () => scope,
    present(input) {
      presented.push(input);
      return { id: "canvas-1" };
    }
  });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["browser_open", "browser_snapshot", "browser_extract", "browser_screenshot", "browser_close"]
  );
  assert.equal(tools.some((tool) => /CSS|XPath/.test(tool.description)), true);

  const result = await tools[0].handler(
    { url: "https://example.com" },
    { signal: new AbortController().signal }
  );
  assert.equal(result.canvas_id, "canvas-1");
  assert.equal(calls[0].receivedScope.taskId, "task-1");
  assert.equal(presented[0].operation, "open");
});

test("browser canvas carries only an opaque local frame capability", () => {
  const canvas = browserSessionCanvas(browserResult(), { generatedAt: timestamp });
  const block = canvas.blocks[0];
  assert.equal(block.type, "browser");
  assert.equal(block.session_id, "browser-session-1");
  assert.equal(block.frame_id, "frame-1");
  assert.equal(JSON.stringify(canvas).includes("base64"), false);
  assert.equal(JSON.stringify(canvas).includes("cookie"), false);
});

test("browser runtime binds sessions and frames to the exact task scope", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp),
    createId: idSequence(["browser-session-1", "frame-1"])
  });
  const record = await runtime.createSession(scope);
  record.frame = {
    id: "frame-1",
    buffer: Buffer.from("png"),
    width: 1280,
    height: 800
  };
  assert.equal(runtime.readFrame(record.id, "frame-1").base64, Buffer.from("png").toString("base64"));
  assert.throws(
    () => runtime.requireSession({ ...scope, taskId: "task-2" }, record.id),
    /not available to this task and account/
  );
  runtime.closeAll();
  assert.throws(() => runtime.readFrame(record.id, "frame-1"), /no longer available/);
});

test("browser request policy blocks local navigation and unsupported main-frame schemes", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() }
  });
  await assert.rejects(
    runtime.validateRequest({ url: "http://127.0.0.1/admin", resourceType: "mainFrame" }),
    /Private or local/
  );
  await assert.rejects(
    runtime.validateRequest({ url: "file:///tmp/secret", resourceType: "mainFrame" }),
    /Unsupported/
  );
  await assert.rejects(
    runtime.validateRequest({ url: "data:text/html,secret", resourceType: "mainFrame" }),
    /Unsupported/
  );
  await assert.rejects(
    runtime.validateRequest({
      url: "https://93.184.216.34/callback?access_token=secret",
      resourceType: "mainFrame"
    }),
    /Credential-like/
  );
});

test("browser observations do not expose credential-like history URLs", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp),
    createId: idSequence(["browser-session-1", "frame-1"])
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/start";
  record.revision = 1;
  record.window.webContents.executeJavaScriptInIsolatedWorld = async () => ({
    url: "https://example.com/callback#access_token=secret",
    title: "Callback",
    text: "Callback page",
    summary: "Callback page",
    elements: []
  });
  record.window.webContents.capturePage = async () => fakeImage();

  const result = await runtime.snapshot(scope, { sessionId: record.id });

  assert.equal(result.url, "https://example.com/start");
  assert.equal(JSON.stringify(result).includes("access_token"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("failed first navigation revokes the unreachable browser session", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FailingBrowserWindow,
    session: { fromPartition: () => fakeSession() }
  });

  await assert.rejects(
    runtime.open(scope, { url: "https://93.184.216.34/" }),
    /navigation failed/
  );
  assert.equal(runtime.sessions.size, 0);
});

function browserResult() {
  return {
    ok: true,
    status: "ready",
    session_id: "browser-session-1",
    url: "https://example.com/",
    title: "Example",
    page_revision: 1,
    observed_at: timestamp,
    element_count: 2,
    summary: "Example page",
    frame: { frame_id: "frame-1", width: 1280, height: 800, bytes: 3 }
  };
}

function fakeSession() {
  return {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    setDisplayMediaRequestHandler() {},
    on() {},
    webRequest: { onBeforeRequest() {} }
  };
}

class FakeBrowserWindow {
  constructor() {
    this.destroyed = false;
    this.listeners = new Map();
    this.webContents = {
      setWindowOpenHandler() {},
      on() {},
      isDestroyed: () => this.destroyed
    };
  }

  setMenuBarVisibility() {}
  on(name, callback) { this.listeners.set(name, callback); }
  isDestroyed() { return this.destroyed; }
  destroy() {
    this.destroyed = true;
    this.listeners.get("closed")?.();
  }
}

class FailingBrowserWindow extends FakeBrowserWindow {
  async loadURL() { throw new Error("navigation failed"); }
}

function fakeImage() {
  return {
    getSize: () => ({ width: 1280, height: 800 }),
    toPNG: () => Buffer.from("png")
  };
}

function idSequence(values) {
  let index = 0;
  return () => values[index++] || `generated-${index}`;
}
