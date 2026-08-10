import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
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
});
