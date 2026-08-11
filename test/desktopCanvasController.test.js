import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopController } from "../src/desktop/controller.js";
import { documentArtifactCanvas } from "../src/desktop/documentArtifactCanvas.js";

const timestamp = "2026-07-26T12:00:00.000Z";

test("desktop controller emits canvas lifecycle updates and clears them with the session", async () => {
  const events = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-canvas-controller",
    settingsStore: {},
    openBrowser() {},
    emit(channel, payload) {
      events.push({ channel, payload });
    }
  });
  const canvas = controller.presentCanvas({
    version: "1",
    title: "Company health",
    source: { kind: "live", label: "AMOS overview", refreshed_at: timestamp, references: [] },
    blocks: [{ type: "metric", label: "Open approvals", value: 2 }]
  });
  const updated = controller.updateCanvas(canvas.id, {
    blocks: [{ id: "block-1", type: "metric", label: "Open approvals", value: 3 }],
    generated_at: timestamp
  });
  assert.equal(updated.revision, 2);
  assert.ok(events.filter((event) => event.channel === "canvas:changed").length >= 2);

  const removed = controller.removeCanvas(updated.id);
  assert.equal(removed.canvases.length, 0);
  assert.ok(events.some((event) => event.channel === "canvas:changed"));

  controller.canvases.present({
    version: "1",
    title: "Company health",
    source: { kind: "live", label: "AMOS overview", refreshed_at: timestamp, references: [] },
    blocks: [{ type: "metric", label: "Open approvals", value: 2 }]
  });
  let loopCleared = false;
  controller.runtime = {
    runtime: {
      loop: {
        clear() {
          loopCleared = true;
        }
      }
    }
  };
  await controller.clear();
  assert.equal(loopCleared, true);
  assert.deepEqual(controller.canvases.state(), { canvases: [], activeCanvasId: null });
});

test("regenerating the same document refreshes one bounded artifact canvas", () => {
  const events = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-document-canvas-controller",
    settingsStore: {},
    openBrowser() {},
    emit(channel, payload) {
      events.push({ channel, payload });
    }
  });
  const artifact = {
    path: "reports/operating-review.pdf",
    format: "pdf",
    bytes: 2048,
    sha256: "a".repeat(64),
    verified: true
  };
  const first = controller.presentDocumentArtifact({
    generatedAt: timestamp,
    document: {
      title: "Operating review",
      blocks: [{ type: "paragraph", text: "Initial review." }]
    },
    artifacts: [artifact],
    layout: {
      status: "ready",
      estimated_pages: 1,
      diagnostic_count: 0,
      diagnostics: []
    }
  });
  const second = controller.presentDocumentArtifact({
    generatedAt: timestamp,
    document: {
      title: "Operating review — revised",
      blocks: [{ type: "paragraph", text: "Revised review." }]
    },
    artifacts: [{ ...artifact, bytes: 3072, sha256: "b".repeat(64) }],
    layout: {
      status: "ready",
      estimated_pages: 1,
      diagnostic_count: 0,
      diagnostics: []
    }
  });

  assert.equal(second.id, first.id);
  assert.equal(second.revision, 2);
  assert.equal(controller.canvases.list().length, 1);
  assert.equal(second.blocks[0].artifacts[0].bytes, 3072);
  assert.equal(events.filter((event) => event.channel === "canvas:changed").length, 2);

  const bounded = documentArtifactCanvas({
    generatedAt: timestamp,
    document: {
      title: "Long operating review",
      blocks: Array.from({ length: 61 }, (_, index) => ({
        type: "paragraph",
        text: `Paragraph ${index + 1}`
      }))
    },
    artifacts: [artifact],
    layout: {
      status: "ready",
      estimated_pages: 4,
      diagnostic_count: 0,
      diagnostics: []
    }
  });
  assert.equal(bounded.blocks[0].document.blocks.length, 60);
  assert.equal(bounded.blocks[0].preview_truncated, true);
  assert.equal(bounded.blocks[0].total_blocks, 61);
});

test("browser canvas refreshes one local frame, supports user takeover, and removal revokes its session", async () => {
  const closed = [];
  const frames = [];
  const takeovers = [];
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-browser-canvas-controller",
    settingsStore: {},
    browserRuntime: {
      closeAll() {},
      closeSession(id) { closed.push(id); },
      async startUserTakeover(id) {
        takeovers.push({ id, active: true });
        return {
          status: "ready",
          session_id: id,
          url: "https://example.com/login",
          title: "Login",
          page_revision: 3,
          observed_at: timestamp,
          element_count: 2,
          summary: "Direct control open",
          frame: { frame_id: "frame-2", width: 1280, height: 800 },
          takeover_active: true
        };
      },
      async finishUserTakeover(id) {
        takeovers.push({ id, active: false });
        return {
          status: "ready",
          session_id: id,
          url: "https://example.com/account",
          title: "Account",
          page_revision: 4,
          observed_at: timestamp,
          element_count: 6,
          summary: "Direct control ended",
          frame: { frame_id: "frame-3", width: 1280, height: 800 },
          takeover_active: false
        };
      },
      readFrame(sessionId, frameId) {
        frames.push({ sessionId, frameId });
        return { mime: "image/png", base64: "cG5n", width: 1280, height: 800 };
      }
    },
    openBrowser() {},
    emit() {}
  });
  const first = controller.presentBrowserSession({
    operation: "open",
    status: "ready",
    session_id: "browser-session-1",
    url: "https://example.com/",
    title: "Example",
    page_revision: 1,
    observed_at: timestamp,
    element_count: 4,
    summary: "Example page",
    frame: { frame_id: "frame-1", width: 1280, height: 800 }
  });
  const second = controller.presentBrowserSession({
    operation: "screenshot",
    status: "ready",
    session_id: "browser-session-1",
    url: "https://example.com/next",
    title: "Example next",
    page_revision: 2,
    observed_at: timestamp,
    element_count: 8,
    summary: "Updated page",
    frame: { frame_id: "frame-2", width: 1280, height: 800 }
  });
  assert.equal(second.id, first.id);
  assert.equal(second.revision, 2);
  assert.equal(controller.readBrowserFrame("browser-session-1", "frame-2").base64, "cG5n");
  assert.deepEqual(frames, [{ sessionId: "browser-session-1", frameId: "frame-2" }]);
  assert.throws(
    () => controller.readBrowserFrame("browser-session-1", "frame-1"),
    /no longer attached/
  );
  const downloaded = await controller.attachments.addBrowserDownload({
    name: "report.csv",
    mime: "text/csv",
    bytes: Buffer.from("region,revenue\nwest,42\n")
  });
  const downloadCanvas = controller.presentBrowserSession({
    operation: "download",
    status: "ready",
    session_id: "browser-session-1",
    url: "https://example.com/next",
    title: "Example next",
    page_revision: 2,
    observed_at: timestamp,
    element_count: 8,
    summary: "Verified download",
    frame: { frame_id: "frame-2", width: 1280, height: 800 },
    downloaded_attachment: downloaded
  });
  assert.equal(downloadCanvas.blocks[0].download.attachmentId, downloaded.id);
  assert.equal(
    controller.browserDownloadPayload(downloaded.id).buffer.toString(),
    "region,revenue\nwest,42\n"
  );
  assert.throws(
    () => controller.browserDownloadPayload("not-attached"),
    /no longer attached to this task canvas/
  );
  await controller.startBrowserTakeover("browser-session-1");
  assert.equal(
    controller.canvases.list()[0].blocks[0].takeoverActive,
    true
  );
  await controller.finishBrowserTakeover("browser-session-1");
  assert.equal(
    controller.canvases.list()[0].blocks[0].takeoverActive,
    false
  );
  assert.deepEqual(takeovers, [
    { id: "browser-session-1", active: true },
    { id: "browser-session-1", active: false }
  ]);
  controller.removeCanvas(first.id);
  assert.deepEqual(closed, ["browser-session-1"]);
});

test("local preview attestation survives browser follow-up actions", () => {
  const origin = "http://127.0.0.1:43119";
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-local-preview-canvas-controller",
    settingsStore: {},
    browserRuntime: {
      closeAll() {},
      localPreviewForSession(sessionId) {
        return sessionId === "browser-preview-1"
          ? { origin, network: "exact loopback origin only" }
          : null;
      }
    },
    openBrowser() {},
    emit() {}
  });
  const first = controller.presentBrowserSession({
    operation: "local_preview",
    status: "ready",
    session_id: "browser-preview-1",
    url: `${origin}/index.html`,
    title: "Local preview",
    page_revision: 1,
    observed_at: timestamp,
    element_count: 1,
    summary: "Score 0",
    frame: { frame_id: "frame-1", width: 1280, height: 800 }
  });
  const second = controller.presentBrowserSession({
    operation: "click",
    status: "ready",
    session_id: "browser-preview-1",
    url: `${origin}/index.html`,
    title: "Local preview",
    page_revision: 2,
    observed_at: timestamp,
    element_count: 1,
    summary: "Score 1",
    frame: { frame_id: "frame-2", width: 1280, height: 800 }
  });

  assert.equal(second.id, first.id);
  assert.equal(second.revision, 2);
  assert.equal(second.blocks[0].url, `${origin}/index.html`);
  assert.equal(second.blocks[0].summary, "Score 1");
});

test("document artifact actions resolve only existing DOCX or PDF files inside the workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "amos-artifact-actions-"));
  await writeFile(join(workspace, "brief.pdf"), "%PDF-1.7\n");
  await writeFile(join(workspace, "notes.txt"), "not an artifact\n");
  const controller = new DesktopController({
    userDataPath: join(workspace, ".amos"),
    settingsStore: { read: async () => ({ workspace }) },
    openBrowser() {},
    emit() {}
  });

  assert.equal(
    await controller.resolveDocumentArtifactPath("brief.pdf"),
    await realpath(join(workspace, "brief.pdf"))
  );
  await assert.rejects(
    controller.resolveDocumentArtifactPath("../brief.pdf"),
    /escapes workspace/
  );
  await assert.rejects(
    controller.resolveDocumentArtifactPath("notes.txt"),
    /only DOCX and PDF/
  );
  await assert.rejects(
    controller.resolveDocumentArtifactPath("missing.docx"),
    /ENOENT/
  );

  const previewDirectory = join(workspace, ".amos", "previews", "fixture");
  await mkdir(previewDirectory, { recursive: true });
  await writeFile(join(previewDirectory, "page-1.png"), Buffer.from("preview"));
  assert.equal(
    await controller.resolveDocumentPreviewPath(".amos/previews/fixture/page-1.png"),
    await realpath(join(previewDirectory, "page-1.png"))
  );
  await assert.rejects(
    controller.resolveDocumentPreviewPath("reports/page-1.png"),
    /invalid document preview path/
  );
  await assert.rejects(
    controller.resolveDocumentPreviewPath(".amos/previews/../brief.pdf.png"),
    /invalid document preview path/
  );
});
