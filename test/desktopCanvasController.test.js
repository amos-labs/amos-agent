import test from "node:test";
import assert from "node:assert/strict";
import { DesktopController } from "../src/desktop/controller.js";

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
  await controller.clear();
  assert.deepEqual(controller.canvases.state(), { canvases: [], activeCanvasId: null });
});
