import test from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_BLOCK_TYPES,
  DesktopCanvasManager,
  normalizeCanvasSpec
} from "../src/desktop/canvas.js";
import { createCanvasTool } from "../src/tools/canvas.js";
import { createRegistry } from "../src/runtime.js";

const timestamp = "2026-07-26T12:00:00.000Z";

test("canvas contract normalizes all six safe block types", () => {
  const canvas = normalizeCanvasSpec({
    version: "1",
    title: "Campaign operating view",
    generated_at: timestamp,
    source: {
      kind: "live",
      label: "AMOS growth engine",
      refreshed_at: timestamp,
      stale_after: "2026-07-26T13:00:00.000Z",
      refresh_prompt: "Refresh campaign performance",
      references: [{ type: "campaign", id: "campaign-1", label: "Launch campaign" }]
    },
    blocks: [
      { type: "metric", label: "Playground sessions", value: 42, trend: "up" },
      {
        type: "table",
        columns: [{ key: "name", label: "Campaign" }, { key: "spend", label: "Spend", format: "currency" }],
        rows: [{ name: "Understand", spend: 18.25 }]
      },
      {
        type: "timeseries",
        series: [{ name: "Sessions", points: [{ x: "2026-07-25", y: 16 }] }]
      },
      { type: "markdown", content: "## What changed\nTraffic increased." },
      { type: "sources", items: [{ type: "receipt", id: "receipt-1", label: "Cycle receipt" }] },
      {
        type: "decision",
        kind: "approval",
        status: "pending",
        summary: "Increase the winning campaign.",
        pending_id: "pending-1",
        details: [{ label: "Daily budget", value: 20 }]
      }
    ]
  });

  assert.deepEqual(canvas.blocks.map((block) => block.type), CANVAS_BLOCK_TYPES);
  assert.equal(canvas.source.references[0].id, "campaign-1");
  assert.equal(canvas.blocks[1].rows[0].spend, 18.25);
  assert.equal(canvas.blocks[5].pendingId, "pending-1");
});

test("canvas contract rejects arbitrary block types and unbounded tables", () => {
  const base = {
    version: "1",
    title: "Unsafe view",
    source: { kind: "live", label: "AMOS", refreshed_at: timestamp, references: [] }
  };
  assert.throws(
    () => normalizeCanvasSpec({ ...base, blocks: [{ type: "html", content: "<script>run()</script>" }] }),
    /Unsupported canvas block type/
  );
  assert.throws(
    () => normalizeCanvasSpec({
      ...base,
      blocks: [{
        type: "table",
        columns: [{ key: "value", label: "Value" }],
        rows: Array.from({ length: 201 }, (_, value) => ({ value }))
      }]
    }),
    /limit of 200/
  );
});

test("desktop canvas manager keeps a bounded session-only history", () => {
  const manager = new DesktopCanvasManager({ limit: 2, now: () => timestamp });
  for (const title of ["One", "Two", "Three"]) {
    manager.present({
      version: "1",
      title,
      source: { kind: "live", label: "AMOS", refreshed_at: timestamp, references: [] },
      blocks: [{ type: "metric", label: "Count", value: 1 }]
    });
  }

  assert.deepEqual(manager.list().map((canvas) => canvas.title), ["Three", "Two"]);
  const active = manager.active();
  assert.equal(active.title, "Three");
  assert.equal(manager.remove(active.id), true);
  assert.equal(manager.active().title, "Two");
  manager.clear();
  assert.deepEqual(manager.state(), { canvases: [], activeCanvasId: null });
});

test("desktop canvas tool presents through the validated desktop boundary", async () => {
  const manager = new DesktopCanvasManager({ now: () => timestamp });
  const tool = createCanvasTool({ present: (input) => manager.present(input) });
  const result = await tool.handler({
    version: "1",
    title: "Decision view",
    source: { kind: "live", label: "AMOS approvals", refreshed_at: timestamp, references: [] },
    blocks: [{ type: "decision", kind: "receipt", status: "executed", summary: "Campaign created." }]
  });

  assert.equal(tool.name, "desktop_present_canvas");
  assert.equal(result.ok, true);
  assert.equal(result.block_count, 1);
  assert.equal(manager.active().title, "Decision view");
  assert.equal(JSON.stringify(tool.parameters).includes("$ref"), false);
});

test("desktop runtime exposes the canvas tool only when the desktop supplies it", () => {
  const tool = createCanvasTool({ present: () => ({ id: "canvas-1", title: "View", blocks: [] }) });
  assert.equal(createRegistry().list().some((item) => item.name === tool.name), false);
  assert.equal(
    createRegistry({ extraTools: [tool] }).list().some((item) => item.name === tool.name),
    true
  );
});
