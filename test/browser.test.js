import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DesktopBrowserRuntime } from "../desktop/browserRuntime.js";
import { browserSessionCanvas } from "../src/desktop/browserCanvas.js";
import { DesktopCanvasManager } from "../src/desktop/canvas.js";
import { createBrowserTools } from "../src/tools/browser.js";
import { createBrowserVisualTools } from "../src/tools/browserVisual.js";
import { takeModelEvidence } from "../src/model/evidence.js";

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
      "browser_upload",
      "browser_download",
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

test("browser transfer tools keep local paths and bytes outside model-visible results", async () => {
  const bytes = Buffer.from("region,revenue\nwest,42\n");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const approvals = [];
  const presented = [];
  let registered = null;
  const browser = {
    async prepareUpload(_scope, input) {
      assert.equal(input.attachment.buffer.equals(bytes), true);
      return transferPreparation("upload", {
        attachment_id: "attachment-123",
        name: "report.csv",
        mime: "text/csv",
        bytes: bytes.length,
        sha256: digest
      });
    },
    async performUpload(_scope, input) {
      assert.equal(input.approved, true);
      return { ...browserResult(), operation: "upload", transfer_receipt: transferReceipt("upload", digest) };
    },
    async cancelPreparedUpload() {},
    async prepareDownload() { return transferPreparation("download"); },
    async performDownload(_scope, input) {
      assert.equal(input.approved, true);
      return {
        result: { ...browserResult(), operation: "download", transfer_receipt: transferReceipt("download", digest) },
        transfer: {
          name: "report.csv",
          mime: "text/csv",
          bytes: bytes.length,
          sha256: digest,
          source_url: "https://example.com/report",
          buffer: bytes
        }
      };
    }
  };
  const tools = createBrowserTools({
    browser,
    scope: () => scope,
    resolveAttachment: async (id) => ({
      id,
      name: "report.csv",
      mime: "text/csv",
      size: bytes.length,
      sha256: digest,
      buffer: bytes
    }),
    async registerDownload(transfer) {
      registered = transfer;
      return {
        id: "downloaded-attachment",
        name: transfer.name,
        mime: transfer.mime,
        kind: "document",
        size: transfer.buffer.length,
        sha256: transfer.sha256,
        source: "browser-download"
      };
    },
    present(input) {
      presented.push(input);
      return { id: "canvas-1" };
    }
  });
  const context = {
    signal: new AbortController().signal,
    approvals: {
      async confirm(message) {
        approvals.push(message);
        return true;
      }
    }
  };

  const uploaded = await tools.find((tool) => tool.name === "browser_upload").handler({
    session_id: "browser-session-1",
    ref: "el_upload",
    attachment_id: "attachment-123"
  }, context);
  const downloaded = await tools.find((tool) => tool.name === "browser_download").handler({
    session_id: "browser-session-1",
    ref: "el_download"
  }, context);

  assert.equal(uploaded.transfer_receipt.action, "upload");
  assert.equal(downloaded.downloaded_attachment.id, "downloaded-attachment");
  assert.equal(registered.buffer.equals(bytes), true);
  assert.match(approvals[0], /immutable staged copy/);
  assert.match(approvals[1], /quarantined/);
  assert.equal(JSON.stringify([uploaded, downloaded, presented]).includes(bytes.toString()), false);
  assert.equal(JSON.stringify([uploaded, downloaded, presented]).includes("/Users/"), false);
  assert.equal(Object.hasOwn(downloaded, "transfer"), false);
});

test("browser canvas carries only an opaque local frame capability", () => {
  const canvas = browserSessionCanvas({
    ...browserResult(),
    downloaded_attachment: {
      id: "downloaded-attachment",
      name: "report.csv",
      mime: "text/csv",
      size: 42,
      sha256: "d".repeat(64)
    }
  }, { generatedAt: timestamp });
  const block = canvas.blocks[0];
  assert.equal(block.type, "browser");
  assert.equal(block.session_id, "browser-session-1");
  assert.equal(block.frame_id, "frame-1");
  assert.equal(JSON.stringify(canvas).includes("base64"), false);
  assert.equal(JSON.stringify(canvas).includes("cookie"), false);
  assert.deepEqual(block.download, {
    attachment_id: "downloaded-attachment",
    name: "report.csv",
    mime: "text/csv",
    size: 42,
    sha256: "d".repeat(64)
  });
});

test("typed canvas accepts only a Desktop-attested exact loopback preview block", () => {
  const origin = "http://127.0.0.1:43119";
  const spec = browserSessionCanvas({
    ...browserResult(),
    operation: "click",
    url: `${origin}/index.html`,
    preview: { origin, network: "exact loopback origin only" }
  }, { generatedAt: timestamp });
  const manager = new DesktopCanvasManager();

  const canvas = manager.present(spec);

  assert.equal(canvas.blocks[0].url, `${origin}/index.html`);
  assert.equal(JSON.stringify(canvas).includes("attestation"), false);
});

test("runtime uploads only an immutable staged attachment through main-process CDP", async (t) => {
  const transferRoot = await mkdtemp(join(tmpdir(), "amos-browser-transfer-test-"));
  t.after(() => rm(transferRoot, { recursive: true, force: true }));
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    transferRoot,
    now: () => new Date(timestamp),
    createId: idSequence(["browser-session-1", "frame-prepare", "frame-after", "receipt-upload"])
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/import";
  record.title = "Import";
  record.revision = 3;
  record.window.webContents.capturePage = async () => fakeImage();
  const descriptor = actionDescriptor({
    tag: "input",
    type: "file",
    role: "button",
    name: "Import CSV"
  });
  configureActionExecution(record, () => descriptor);
  setReference(record, "el_upload", "#upload");
  const bytes = Buffer.from("region,revenue\nwest,42\n");
  const digest = createHash("sha256").update(bytes).digest("hex");

  const prepared = await runtime.prepareUpload(scope, {
    sessionId: record.id,
    ref: "el_upload",
    attachment: {
      id: "attachment-123",
      name: "report.csv",
      mime: "text/csv",
      size: bytes.length,
      sha256: digest,
      buffer: bytes
    }
  });

  assert.equal(prepared.requires_approval, true);
  assert.equal(JSON.stringify(prepared.public_action).includes(transferRoot), false);
  await assert.rejects(runtime.performUpload(scope, { plan: prepared.plan }), /exact human approval/);
  const result = await runtime.performUpload(scope, { plan: prepared.plan, approved: true });
  const assignment = record.window.debuggerCommands.find((entry) => entry.method === "DOM.setFileInputFiles");
  assert.equal(assignment.params.files.length, 1);
  assert.equal(assignment.params.files[0].startsWith(transferRoot), true);
  assert.equal(basename(assignment.params.files[0]), "report.csv");
  assert.equal(result.transfer_receipt.contract, "amos.browser-transfer:1");
  assert.equal(result.transfer_receipt.artifact.sha256, digest);
  assert.equal(JSON.stringify(result).includes(assignment.params.files[0]), false);
  runtime.closeAll();
});

test("runtime quarantines, hashes, and returns approved downloads without a filesystem path", async (t) => {
  const transferRoot = await mkdtemp(join(tmpdir(), "amos-browser-download-test-"));
  t.after(() => rm(transferRoot, { recursive: true, force: true }));
  const browserSession = fakeSession();
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => browserSession },
    transferRoot,
    now: () => new Date(timestamp),
    createId: idSequence(["browser-session-1", "frame-prepare", "download-1", "frame-after", "receipt-download"])
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/reports";
  record.title = "Reports";
  record.revision = 2;
  record.window.webContents.capturePage = async () => fakeImage();
  const descriptor = actionDescriptor({ tag: "button", role: "button", name: "Download CSV" });
  const bytes = Buffer.from("region,revenue\nwest,42\n");
  configureActionExecution(record, () => descriptor, {
    async onAction() {
      const item = new FakeDownloadItem({ name: "report.csv", bytes });
      browserSession.emit("will-download", { preventDefault() {} }, item, record.window.webContents);
      await item.completed;
    }
  });
  setReference(record, "el_download", "#download");

  const prepared = await runtime.prepareDownload(scope, {
    sessionId: record.id,
    ref: "el_download"
  });
  const completed = await runtime.performDownload(scope, {
    plan: prepared.plan,
    approved: true,
    timeoutMs: 2_000
  });

  assert.equal(completed.transfer.buffer.equals(bytes), true);
  assert.equal(completed.transfer.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(completed.result.transfer_receipt.contract, "amos.browser-transfer:1");
  assert.equal(JSON.stringify(completed.result).includes(transferRoot), false);
  assert.equal(JSON.stringify(completed.result).includes(bytes.toString()), false);
  runtime.closeAll();
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

test("browser permits only a task-granted exact loopback preview origin", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() }
  });
  const origin = "http://127.0.0.1:43119";
  runtime.grantLocalPreview(scope, { origin });

  const target = await runtime.validateTarget(scope, `${origin}/index.html`, {
    allowSensitiveQuery: false
  });
  assert.equal(target.origin, origin);
  await runtime.validateRequest(
    { url: `${origin}/styles.css`, resourceType: "stylesheet" },
    { localPreviewOrigin: origin }
  );
  await assert.rejects(
    runtime.validateRequest(
      { url: "https://example.com/track", resourceType: "xhr" },
      { localPreviewOrigin: origin }
    ),
    /cannot access external/
  );
  await assert.rejects(
    runtime.validateTarget({ ...scope, taskId: "task-2" }, `${origin}/index.html`),
    /Private or local/
  );

  runtime.revokeLocalPreview(scope, { origin });
  await assert.rejects(runtime.validateTarget(scope, `${origin}/index.html`), /Private or local/);
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
    tag: "a",
    type: "a",
    role: "link",
    name: "Download report",
    href: "https://example.com/report.csv",
    download: true
  });
  setReference(record, "el_download", "#download");
  await assert.rejects(
    runtime.prepareAction(scope, {
      sessionId: record.id,
      kind: "click",
      ref: "el_download"
    }),
    /Use browser_download/
  );

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

test("task-bound local preview controls do not prompt because the preview cannot leave its exact origin", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp)
  });
  const record = await runtime.createSession(scope);
  record.localPreviewOrigin = "http://127.0.0.1:43119";
  record.url = `${record.localPreviewOrigin}/index.html`;
  record.title = "Local dashboard";
  record.revision = 1;
  record.window.webContents.capturePage = async () => fakeImage();
  record.window.webContents.executeJavaScriptInIsolatedWorld = async () => actionDescriptor({
    tag: "button",
    type: "button",
    role: "button",
    name: "Refresh dashboard"
  });
  setReference(record, "el_refresh", "#refresh");

  const prepared = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "click",
    ref: "el_refresh"
  });

  assert.equal(prepared.requires_approval, false);
  assert.equal(prepared.public_action.risk, "preview");
  assert.deepEqual(runtime.localPreviewForSession(record.id), {
    origin: record.localPreviewOrigin,
    network: "exact loopback origin only"
  });
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

test("generic browser actions cancel surprise downloads and require the dedicated transfer tool", async () => {
  const browserSession = fakeSession();
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => browserSession },
    now: () => new Date(timestamp)
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/reports";
  record.title = "Reports";
  record.revision = 2;
  record.window.webContents.capturePage = async () => fakeImage();
  const descriptor = actionDescriptor({ tag: "button", role: "button", name: "Generate report" });
  let canceled = false;
  configureActionExecution(record, () => descriptor, {
    onAction() {
      browserSession.emit(
        "will-download",
        { preventDefault() {} },
        {
          getFilename: () => "surprise.csv",
          cancel() { canceled = true; }
        },
        record.window.webContents
      );
    }
  });
  setReference(record, "el_generate", "#generate");
  const prepared = await runtime.prepareAction(scope, {
    sessionId: record.id,
    kind: "click",
    ref: "el_generate"
  });

  await assert.rejects(
    runtime.performAction(scope, { plan: prepared.plan, approved: true, waitMs: 250 }),
    /unapproved download.*browser_download/i
  );
  assert.equal(canceled, true);
  runtime.closeAll();
});

test("approved browser downloads fail closed before accepting declared oversize payloads", async (t) => {
  const transferRoot = await mkdtemp(join(tmpdir(), "amos-browser-oversize-test-"));
  t.after(() => rm(transferRoot, { recursive: true, force: true }));
  const browserSession = fakeSession();
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => browserSession },
    transferRoot,
    now: () => new Date(timestamp)
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/reports";
  record.title = "Reports";
  record.revision = 2;
  record.window.webContents.capturePage = async () => fakeImage();
  const descriptor = actionDescriptor({ tag: "button", role: "button", name: "Download archive" });
  let canceled = false;
  configureActionExecution(record, () => descriptor, {
    onAction() {
      browserSession.emit(
        "will-download",
        { preventDefault() {} },
        {
          getFilename: () => "archive.zip",
          getTotalBytes: () => 20 * 1024 * 1024 + 1,
          cancel() { canceled = true; }
        },
        record.window.webContents
      );
    }
  });
  setReference(record, "el_download", "#download");
  const prepared = await runtime.prepareDownload(scope, {
    sessionId: record.id,
    ref: "el_download"
  });

  await assert.rejects(
    runtime.performDownload(scope, { plan: prepared.plan, approved: true, timeoutMs: 2_000 }),
    /exceeds the 20 MB attachment limit/
  );
  assert.equal(canceled, true);
  runtime.closeAll();
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

test("visual browser fallback binds actions to a masked frame hash and fresh approval", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp),
    createId: idSequence(["browser-session-1", "frame-observe", "frame-revalidate", "frame-after", "visual-receipt"])
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/canvas";
  record.title = "Canvas editor";
  record.revision = 2;
  record.window.webContents.capturePage = async () => fakeImage();
  configureVisualExecution(record);

  const observation = await runtime.visualObserve(scope, {
    sessionId: record.id,
    targetDescription: "Blue canvas control"
  });
  assert.equal(observation.contract, "amos.browser-visual-observation:1");
  assert.match(observation.frame.sha256, /^[a-f0-9]{64}$/);
  const prepared = await runtime.prepareVisualAction(scope, {
    sessionId: record.id,
    frameId: observation.frame.frame_id,
    action: "click",
    targetDescription: "Blue canvas control",
    x: 420,
    y: 240
  });
  assert.equal(prepared.requires_approval, true);
  assert.equal(prepared.public_action.point.x, 420);
  const result = await runtime.performVisualAction(scope, {
    plan: prepared.plan,
    approved: true
  });
  assert.equal(result.visual_action_receipt.contract, "amos.browser-visual-action:1");
  assert.equal(result.visual_action_receipt.verified, true);
  assert.equal(record.window.inputEvents.some((event) => event.type === "mouseDown"), true);
  runtime.closeAll();
});

test("visual browser fallback stops on changed pixels and sensitive surfaces", async () => {
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => fakeSession() },
    now: () => new Date(timestamp),
    createId: idSequence(["browser-session-1", "frame-observe", "frame-changed"])
  });
  const record = await runtime.createSession(scope);
  record.url = "https://example.com/canvas";
  record.title = "Canvas editor";
  record.revision = 1;
  let imageBytes = "png";
  record.window.webContents.capturePage = async () => ({
    getSize: () => ({ width: 1280, height: 800 }),
    toPNG: () => Buffer.from(imageBytes)
  });
  configureVisualExecution(record);
  const observation = await runtime.visualObserve(scope, {
    sessionId: record.id,
    targetDescription: "Canvas control"
  });
  const prepared = await runtime.prepareVisualAction(scope, {
    sessionId: record.id,
    frameId: observation.frame.frame_id,
    action: "click",
    targetDescription: "Canvas control",
    x: 20,
    y: 20
  });
  imageBytes = "changed pixels";
  await assert.rejects(
    runtime.performVisualAction(scope, { plan: prepared.plan, approved: true }),
    /frame changed while approval was pending/
  );
  record.url = "https://example.com/login";
  await assert.rejects(
    runtime.visualObserve(scope, { sessionId: record.id, targetDescription: "Login" }),
    /authentication surfaces/
  );
  runtime.closeAll();
});

test("visual browser tools keep image bytes in transient model evidence only", async () => {
  const browser = {
    async visualObserve() {
      return {
        ...browserResult(),
        contract: "amos.browser-visual-observation:1",
        frame: { ...browserResult().frame, sha256: "a".repeat(64) }
      };
    },
    readFrame() {
      return { mime: "image/png", base64: Buffer.from("png").toString("base64") };
    }
  };
  const tools = createBrowserVisualTools({ browser, scope: () => scope, present: () => ({ id: "canvas-1" }) });
  assert.deepEqual(tools.map((tool) => tool.name), ["browser_visual_observe", "browser_visual_act"]);
  const result = await tools[0].handler({
    session_id: "browser-session-1",
    target_description: "Canvas control"
  }, {
    config: { model: { capabilities: { vision: true } } },
    signal: new AbortController().signal
  });
  assert.equal(JSON.stringify(result).includes(Buffer.from("png").toString("base64")), false);
  const evidence = takeModelEvidence(result);
  assert.equal(evidence.length, 1);
  assert.match(evidence[0].image_url.url, /^data:image\/png;base64,/);
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
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    setDisplayMediaRequestHandler() {},
    webRequest: { onBeforeRequest() {} }
  });
}

class FakeBrowserWindow {
  constructor() {
    this.destroyed = false;
    this.visible = false;
    this.title = "";
    this.loadedUrls = [];
    this.listeners = new Map();
    this.debuggerCommands = [];
    this.inputEvents = [];
    this.insertedTexts = [];
    let debuggerAttached = false;
    this.webContents = {
      setWindowOpenHandler() {},
      on() {},
      isDestroyed: () => this.destroyed,
      isLoading: () => false,
      getURL: () => this.loadedUrls.at(-1) || "https://example.com/",
      getTitle: () => this.title || "Example",
      sendInputEvent: (event) => this.inputEvents.push(event),
      insertText: async (value) => this.insertedTexts.push(value),
      insertCSS: async () => "masked-css",
      removeInsertedCSS: async () => {},
      debugger: {
        isAttached: () => debuggerAttached,
        attach: () => { debuggerAttached = true; },
        detach: () => { debuggerAttached = false; },
        sendCommand: async (method, params = {}) => {
          this.debuggerCommands.push({ method, params });
          if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
          if (method === "DOM.querySelector") return { nodeId: 2 };
          return {};
        }
      }
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

function configureVisualExecution(record, { visibleSensitiveFields = 0 } = {}) {
  record.window.webContents.executeJavaScriptInIsolatedWorld = async (_world, scripts) => {
    const code = scripts[0].code;
    if (code.includes("visibleSensitiveFields")) return { visibleSensitiveFields };
    if (code.includes("document.elementFromPoint")) {
      return {
        tag: "canvas",
        type: "canvas",
        role: "canvas",
        name: "Canvas control",
        disabled: false,
        editable: false,
        sensitive: false
      };
    }
    if (code.includes("document.readyState")) return true;
    return true;
  };
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
      await onAction();
      return true;
    }
    if (code.includes("Array.from(target.files")) return true;
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

class FakeDownloadItem extends EventEmitter {
  constructor({ name, bytes, mime = "text/csv" }) {
    super();
    this.name = name;
    this.bytes = bytes;
    this.mime = mime;
    this.received = 0;
    this.completed = new Promise((resolve) => { this.finish = resolve; });
  }

  getFilename() { return this.name; }
  getTotalBytes() { return this.bytes.length; }
  getReceivedBytes() { return this.received; }
  getMimeType() { return this.mime; }
  cancel() { this.emit("done", {}, "cancelled"); }
  setSavePath(path) {
    writeFile(path, this.bytes).then(() => {
      this.received = this.bytes.length;
      this.emit("updated");
      this.emit("done", {}, "completed");
      this.finish();
    });
  }
}

function transferPreparation(action, payload = {}) {
  return {
    plan: { id: `${action}-plan` },
    requires_approval: true,
    takeover_required: false,
    public_action: {
      action,
      risk: "file-transfer",
      origin: "https://example.com",
      page_revision: 1,
      target: { ref: `el_${action}`, role: "button", name: action, tag: "button", type: "button" },
      payload
    },
    observation: browserResult()
  };
}

function transferReceipt(action, sha256) {
  return {
    contract: "amos.browser-transfer:1",
    receipt_id: `receipt-${action}`,
    action,
    artifact: { name: "report.csv", mime: "text/csv", bytes: 24, sha256 },
    verified: true
  };
}

function idSequence(values) {
  let index = 0;
  return () => values[index++] || `generated-${index}`;
}
