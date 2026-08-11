import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("browser tools expose semantic governed primitives and present deterministic canvas results", async () => {
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
    [
      "browser_open",
      "browser_snapshot",
      "browser_extract",
      "browser_click",
      "browser_type",
      "browser_select",
      "browser_check",
      "browser_wait",
      "browser_screenshot",
      "browser_close"
    ]
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

test("consequential browser actions require one exact non-persistent approval", async () => {
  let performed = 0;
  let approval = null;
  const browser = {
    async prepareAction() {
      return {
        plan: { id: "plan-1" },
        requires_approval: true,
        takeover_required: false,
        public_action: {
          action: "click",
          risk: "consequential",
          origin: "https://example.com",
          page_revision: 4,
          target: { ref: "el_submit", role: "button", name: "Submit", destination: "" },
          payload: {}
        },
        observation: browserResult()
      };
    },
    async performAction(_scope, input) {
      performed += 1;
      assert.equal(input.plan.id, "plan-1");
      assert.equal(input.approved, true);
      return { ...browserResult(), action_receipt: { receipt_id: "receipt-1" } };
    }
  };
  const tools = createBrowserTools({ browser, scope: () => scope, present: () => ({ id: "canvas-1" }) });
  const click = tools.find((tool) => tool.name === "browser_click");
  const result = await click.handler(
    { session_id: "browser-session-1", ref: "el_submit" },
    {
      signal: new AbortController().signal,
      approvals: {
        async confirm(message, options) {
          approval = { message, options };
          return true;
        }
      }
    }
  );
  assert.equal(performed, 1);
  assert.equal(approval.options.kind, "browser-action");
  assert.match(approval.message, /Origin: https:\/\/example\.com/);
  assert.match(approval.message, /Page revision: 4/);
  assert.equal(result.action_receipt.receipt_id, "receipt-1");
});

test("authentication fields route to user takeover without asking the model to act", async () => {
  let approvals = 0;
  let performed = 0;
  const browser = {
    async prepareAction() {
      return {
        plan: { id: "blocked-plan" },
        requires_approval: false,
        takeover_required: true,
        public_action: {
          action: "type",
          risk: "credential",
          origin: "https://example.com",
          page_revision: 2,
          target: { ref: "el_password", role: "textbox", name: "Password" },
          payload: { characters: 6, sha256: "a".repeat(64), replace: true }
        },
        observation: browserResult()
      };
    },
    async performAction() { performed += 1; }
  };
  const tools = createBrowserTools({ browser, scope: () => scope, present: () => ({ id: "canvas-1" }) });
  const type = tools.find((tool) => tool.name === "browser_type");
  const result = await type.handler(
    { session_id: "browser-session-1", ref: "el_password", text: "secret" },
    {
      signal: new AbortController().signal,
      approvals: { async confirm() { approvals += 1; return true; } }
    }
  );
  assert.equal(result.takeover_required, true);
  assert.equal(approvals, 0);
  assert.equal(performed, 0);
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

test("runtime classifies safe links, consequential controls, and authentication fields deterministically", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp)
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/account";
  record.title = "Account";
  record.revision = 3;
  record.window.webContents.capturePage = async () => fakeImage();
  let descriptor = actionDescriptor({ tag: "a", type: "a", role: "link", name: "Documentation", href: "https://example.com/docs" });
  record.window.webContents.executeJavaScriptInIsolatedWorld = async () => descriptor;
  setReference(record, "el_link", "#docs");
  const link = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "click",
    ref: "el_link"
  });
  assert.equal(link.requires_approval, false);
  assert.equal(link.takeover_required, false);

  descriptor = actionDescriptor({
    tag: "a",
    type: "a",
    role: "link",
    name: "External documentation",
    href: "https://docs.example.net/guide"
  });
  setReference(record, "el_external", "#external-docs");
  const externalLink = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "click",
    ref: "el_external"
  });
  assert.equal(externalLink.requires_approval, true);
  assert.equal(externalLink.public_action.risk, "consequential");

  descriptor = actionDescriptor({ tag: "button", type: "submit", role: "button", name: "Save changes" });
  setReference(record, "el_save", "#save");
  const button = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "click",
    ref: "el_save"
  });
  assert.equal(button.requires_approval, true);
  assert.equal(button.public_action.risk, "consequential");

  descriptor = actionDescriptor({
    tag: "input",
    type: "password",
    role: "textbox",
    name: "Password",
    identifier: "password current-password",
    autocomplete: "current-password",
    form: { method: "post", action: "https://example.com/login", hasPassword: true, name: "Login" }
  });
  setReference(record, "el_password", "#password");
  const password = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "type",
    ref: "el_password",
    text: "never-send-this"
  });
  assert.equal(password.takeover_required, true);
});

test("runtime binds an approved action to the exact target and returns a redacted post-action receipt", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp)
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/profile";
  record.title = "Profile";
  record.revision = 5;
  record.window.webContents.capturePage = async () => fakeImage();
  const descriptor = actionDescriptor({
    tag: "textarea",
    type: "textarea",
    role: "textbox",
    name: "Internal note",
    identifier: "note",
    maxLength: 1_000
  });
  configureActionExecution(record, () => descriptor);
  setReference(record, "el_note", "#note");
  const prepared = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "type",
    ref: "el_note",
    text: "private note"
  });
  await assert.rejects(
    runtime.performAction(scope, { plan: prepared.plan, waitMs: 250 }),
    /requires exact human approval/
  );
  const result = await runtime.performAction(scope, {
    plan: prepared.plan,
    approved: true,
    waitMs: 250
  });
  assert.equal(result.action_receipt.contract, "amos.browser-action:1");
  assert.equal(result.action_receipt.approved, true);
  assert.equal(result.action_receipt.payload.characters, 12);
  assert.equal(JSON.stringify(result.action_receipt).includes("private note"), false);
  assert.equal(result.action_receipt.verified, true);
});

test("observational links navigate directly without invoking page click handlers", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp)
  });
  runtime.publicPolicy.cache.set("example.com", {
    promise: Promise.resolve(),
    expiresAt: Number.MAX_SAFE_INTEGER
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/account";
  record.title = "Account";
  record.revision = 3;
  record.window.webContents.capturePage = async () => fakeImage();
  const descriptor = actionDescriptor({
    tag: "a",
    type: "a",
    role: "link",
    name: "Documentation",
    href: "https://example.com/docs"
  });
  let scriptedClicks = 0;
  configureActionExecution(record, () => descriptor, {
    onAction() { scriptedClicks += 1; }
  });
  setReference(record, "el_docs", "#docs");
  const prepared = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "click",
    ref: "el_docs"
  });

  const result = await runtime.performAction(scope, {
    plan: prepared.plan,
    waitMs: 250
  });

  assert.equal(scriptedClicks, 0);
  assert.equal(record.window.loadedUrls.at(-1), "https://example.com/docs");
  assert.equal(result.action_receipt.approved, false);
});

test("material page drift invalidates an already approved browser action", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() }
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/settings";
  record.title = "Settings";
  record.revision = 2;
  record.window.webContents.capturePage = async () => fakeImage();
  const descriptor = actionDescriptor({ tag: "button", role: "button", name: "Save" });
  configureActionExecution(record, () => descriptor);
  setReference(record, "el_save", "#save");
  const prepared = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "click",
    ref: "el_save"
  });
  descriptor.pageMarker = "page-materially-changed";
  await assert.rejects(
    runtime.performAction(scope, { plan: prepared.plan, approved: true }),
    /target changed while approval was pending/
  );
});

test("user takeover reveals and returns the same isolated session without exposing credentials", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp)
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/login";
  record.title = "Login";
  record.revision = 1;
  record.window.webContents.capturePage = async () => fakeImage();
  configureActionExecution(record, () => actionDescriptor({ tag: "a", role: "link", name: "Home" }));

  const started = await runtime.startUserTakeover(record.id);
  assert.equal(started.takeover_active, true);
  assert.equal(record.window.visible, true);
  assert.match(record.window.title, /AMOS Secure Browser/);
  await assert.rejects(
    runtime.snapshot(scope, { sessionId: record.id }),
    /Direct user control is active/
  );

  const finished = await runtime.finishUserTakeover(record.id);
  assert.equal(finished.takeover_active, false);
  assert.equal(record.window.visible, false);
  assert.equal(JSON.stringify(finished).includes("cookie"), false);
});

test("browser observations remove editable values before returning page text", () => {
  const source = readFileSync(new URL("../desktop/browserRuntime.js", import.meta.url), "utf8");
  assert.match(
    source,
    /querySelectorAll\('input,textarea,select,option,\[contenteditable\]'\)\.forEach\(\(control\) => control\.remove\(\)\)/
  );
  assert.match(source, /region\.matches\('input,textarea,select,option,\[contenteditable\]'\)/);
  assert.match(source, /editable browser fields cannot be extracted/i);
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
    this.visible = false;
    this.title = "";
    this.loadedUrls = [];
    this.listeners = new Map();
    this.webContents = {
      setWindowOpenHandler() {},
      on() {},
      isDestroyed: () => this.destroyed,
      isLoading: () => false,
      getURL: () => this.loadedUrls.at(-1) || "https://example.com/",
      getTitle: () => this.title || "Example"
    };
  }

  setMenuBarVisibility() {}
  setTitle(value) { this.title = value; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() {}
  async loadURL(value) { this.loadedUrls.push(value); }
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

function setReference(record, ref, selector) {
  record.refs.set(ref, {
    revision: record.revision,
    selector,
    role: "",
    name: "",
    tag: "",
    type: ""
  });
}

function actionDescriptor(target) {
  return {
    url: "https://example.com/",
    pageMarker: "page-1",
    target: {
      tag: "button",
      type: "button",
      role: "button",
      name: "",
      identifier: "",
      href: "",
      target: "",
      download: false,
      disabled: false,
      readOnly: false,
      checked: false,
      selected: false,
      contentEditable: false,
      autocomplete: "",
      maxLength: -1,
      visible: true,
      form: null,
      ...target
    },
    option: null,
    optionBelongsToTarget: false
  };
}

function configureActionExecution(record, descriptor, { onAction = () => {} } = {}) {
  record.window.webContents.executeJavaScriptInIsolatedWorld = async (_world, scripts) => {
    const code = scripts[0].code;
    if (code.includes("const kind =")) {
      onAction();
      return true;
    }
    if (code.includes("document.readyState")) return true;
    if (code.includes("const maxElements")) {
      return {
        url: record.url,
        title: record.title,
        text: "Updated page",
        summary: "Updated page",
        elements: []
      };
    }
    return descriptor();
  };
}

function idSequence(values) {
  let index = 0;
  return () => values[index++] || `generated-${index}`;
}
