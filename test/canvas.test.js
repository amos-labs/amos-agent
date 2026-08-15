import test from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_BLOCK_TYPES,
  DesktopCanvasManager,
  normalizeCanvasSpec
} from "../src/desktop/canvas.js";
import {
  createCanvasTool,
  createCanvasUpdateTool,
  createCompanyViewTool,
  createWorkSurfaceRequestTool
} from "../src/tools/canvas.js";
import { createRegistry } from "../src/runtime.js";

const timestamp = "2026-07-26T12:00:00.000Z";

test("canvas contract normalizes every safe block type", () => {
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
      {
        type: "code",
        title: "Implementation",
        filename: "src/app.js",
        language: "javascript",
        start_line: 12,
        content: "const value = '<script>never execute</script>';\n"
      },
      {
        type: "document",
        title: "Verified artifact",
        document: {
          title: "Quarterly brief",
          blocks: [{ type: "paragraph", text: "Verified local content." }]
        },
        artifacts: [{
          path: "reports/quarterly.pdf",
          format: "pdf",
          bytes: 1024,
          sha256: "a".repeat(64),
          verified: true
        }],
        diagnostics: [],
        page_preview: {
          page_count: 1,
          pages: [{
            path: ".amos/previews/fixture/page-1.png",
            page: 1,
            width: 420,
            height: 544,
            bytes: 1024,
            sha256: "b".repeat(64)
          }]
        },
        estimated_pages: 1,
        total_blocks: 1
      },
      {
        type: "spreadsheet",
        title: "Verified workbook",
        artifact: {
          path: "models/quarterly-plan.xlsx",
          format: "xlsx",
          bytes: 4096,
          sha256: "d".repeat(64),
          verified: true
        },
        sheet_names: ["Assumptions", "Base Case"],
        verification: {
          verified: true,
          sheet_count: 3,
          formula_count: 42,
          check_count: 2,
          checks_passed: 2,
          required_checks_passed: true
        },
        checks: [{ label: "Starting MRR", passed: true, required: true }]
      },
      {
        type: "browser",
        title: "Public page",
        session_id: "browser-session-1",
        url: "https://example.com/research",
        status: "ready",
        page_revision: 2,
        frame_id: "frame-1",
        frame_sha256: "c".repeat(64),
        viewport: { width: 1280, height: 800 },
        observed_at: timestamp,
        element_count: 12,
        summary: "Example research page",
        visual_fallback: true,
        visual_target: "Canvas control",
        takeover_active: true,
        interactive: true
      },
      {
        type: "link",
        title: "Preview",
        label: "Open the local app",
        url: "http://127.0.0.1:3000/preview",
        description: "Open in the system browser.",
        action_label: "Open preview"
      },
      { type: "sources", items: [{ type: "receipt", id: "receipt-1", label: "Cycle receipt" }] },
      {
        type: "decision",
        kind: "approval",
        status: "pending",
        summary: "Increase the winning campaign.",
        pending_id: "pending-1",
        details: [{ label: "Daily budget", value: 20 }]
      },
      {
        type: "operating_plan",
        status: "active",
        provenance: { uncertainty: "inferred" },
        sections: [{
          id: "outcome",
          title: "Desired outcome",
          items: [{
            id: "obj-1",
            kind: "objective",
            statement: "Stop duplicate books",
            status: "inferred",
            confidence: 0.7,
            actions: ["confirm", "correct", "reject"]
          }]
        }]
      }
    ]
  });

  assert.deepEqual(canvas.blocks.map((block) => block.type), CANVAS_BLOCK_TYPES);
  assert.equal(canvas.source.references[0].id, "campaign-1");
  assert.equal(canvas.blocks[1].rows[0].spend, 18.25);
  assert.equal(canvas.blocks[4].content.includes("<script>"), true);
  assert.equal(canvas.blocks[5].artifacts[0].path, "reports/quarterly.pdf");
  assert.equal(canvas.blocks[5].pagePreview.pages[0].path, ".amos/previews/fixture/page-1.png");
  assert.equal(canvas.blocks[6].artifact.path, "models/quarterly-plan.xlsx");
  assert.equal(canvas.blocks[6].verification.formulaCount, 42);
  assert.equal(canvas.blocks[7].sessionId, "browser-session-1");
  assert.equal(canvas.blocks[7].frameId, "frame-1");
  assert.equal(canvas.blocks[7].frameSha256, "c".repeat(64));
  assert.equal(canvas.blocks[7].visualFallback, true);
  assert.equal(canvas.blocks[7].takeoverActive, true);
  assert.equal(canvas.blocks[8].url, "http://127.0.0.1:3000/preview");
  assert.equal(canvas.blocks[10].pendingId, "pending-1");
  assert.equal(canvas.blocks[11].sections[0].items[0].id, "obj-1");
  assert.equal(canvas.blocks[11].provenance.uncertainty, "inferred");
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
  for (const url of [
    "javascript:alert(1)",
    "http://example.com/preview",
    "https://user:password@example.com/preview",
    "https://example.com/preview?access_token=secret"
  ]) {
    assert.throws(
      () => normalizeCanvasSpec({
        ...base,
        blocks: [{ type: "link", label: "Unsafe", url }]
      }),
      /URL|HTTPS|credential/i
    );
  }
  for (const url of [
    "file:///tmp/secret",
    "http://localhost:3000/admin",
    "https://user:password@example.com/private"
  ]) {
    assert.throws(
      () => normalizeCanvasSpec({
        ...base,
        blocks: [{
          type: "browser",
          session_id: "browser-session-1",
          url,
          status: "ready",
          page_revision: 1,
          viewport: { width: 1280, height: 800 },
          observed_at: timestamp
        }]
      }),
      /HTTP|local network|credentials/i
    );
  }
  for (const path of [
    "/tmp/report.pdf",
    "../report.pdf",
    "reports/report.docx",
    "reports/report.txt"
  ]) {
    assert.throws(
      () => normalizeCanvasSpec({
        ...base,
        blocks: [{
          type: "document",
          document: {
            title: "Unsafe artifact",
            blocks: [{ type: "paragraph", text: "Blocked." }]
          },
          artifacts: [{
            path,
            format: "pdf",
            bytes: 1,
            sha256: "a".repeat(64),
            verified: true
          }]
        }]
      }),
      /workspace-relative PDF path/
    );
  }
  assert.throws(
    () => normalizeCanvasSpec({
      ...base,
      blocks: [{
        type: "document",
        document: {
          title: "Unsafe preview",
          blocks: [{ type: "paragraph", text: "Blocked." }]
        },
        artifacts: [{
          path: "reports/report.pdf",
          format: "pdf",
          bytes: 1,
          sha256: "a".repeat(64),
          verified: true
        }],
        page_preview: {
          page_count: 1,
          pages: [{
            path: "../page-1.png",
            page: 1,
            width: 420,
            height: 544,
            bytes: 1024,
            sha256: "b".repeat(64)
          }]
        }
      }]
    }),
    /AMOS preview PNG path/
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

test("desktop canvas manager restores a task-bound canvas snapshot", () => {
  const manager = new DesktopCanvasManager({ now: () => timestamp });
  const first = manager.present({
    version: "1",
    title: "First",
    generated_at: timestamp,
    source: { kind: "local", label: "Workspace", refreshed_at: timestamp, references: [] },
    state: "ready",
    blocks: [{ id: "note", type: "markdown", content: "Task one" }]
  });
  const snapshot = manager.state();
  manager.clear();

  const restored = manager.restore(snapshot);

  assert.equal(restored.activeCanvasId, first.id);
  assert.equal(restored.canvases[0].title, "First");
  assert.equal(restored.canvases[0].revision, 1);
  assert.equal(manager.active().blocks[0].content, "Task one");
});

test("canvas supports explicit empty and restricted states without pretending data exists", () => {
  const empty = normalizeCanvasSpec({
    version: "1",
    title: "Approval queue",
    state: { kind: "empty", message: "No approvals are waiting." },
    source: { kind: "live", label: "AMOS governance", refreshed_at: timestamp, references: [] },
    blocks: []
  });
  assert.equal(empty.state.kind, "empty");
  assert.equal(empty.blocks.length, 0);
  assert.throws(
    () => normalizeCanvasSpec({
      version: "1",
      title: "Invalid ready view",
      source: { kind: "live", label: "AMOS", refreshed_at: timestamp, references: [] },
      blocks: []
    }),
    /ready canvas must include/
  );
});

test("incremental canvas updates preserve unrelated blocks and provenance", () => {
  const manager = new DesktopCanvasManager({ now: () => timestamp });
  const canvas = manager.present({
    version: "1",
    title: "Live work",
    state: { kind: "partial", message: "Still loading receipts." },
    source: {
      kind: "live",
      label: "AMOS company",
      refreshed_at: timestamp,
      references: [{ type: "goal", id: "goal-1", label: "Growth goal" }]
    },
    blocks: [
      { id: "metric", type: "metric", label: "Open work", value: 2 },
      { id: "brief", type: "markdown", content: "Initial evidence." }
    ]
  });

  const updated = manager.update(canvas.id, {
    state: { kind: "ready" },
    blocks: [{ id: "metric", type: "metric", label: "Open work", value: 3 }],
    generated_at: timestamp
  });

  assert.equal(updated.revision, 2);
  assert.equal(updated.state.kind, "ready");
  assert.equal(updated.blocks.find((block) => block.id === "metric").value, 3);
  assert.equal(updated.blocks.find((block) => block.id === "brief").content, "Initial evidence.");
  assert.equal(updated.blocks[0].provenance.references[0].id, "goal-1");
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

test("company and incremental canvas tools expose narrow deterministic contracts", async () => {
  const company = createCompanyViewTool({
    present: ({ result_ref: resultRef, intent }) => ({
      id: "canvas-company",
      title: `${intent}:${resultRef}`,
      state: { kind: "ready" },
      blocks: [{ id: "metric" }]
    })
  });
  const presented = await company.handler({
    result_ref: "result-1",
    intent: "company_overview"
  });
  assert.equal(presented.canvas_id, "canvas-company");

  const update = createCanvasUpdateTool({
    update: (id) => ({
      id,
      revision: 2,
      state: { kind: "partial" },
      blocks: [{ id: "metric" }]
    })
  });
  const updated = await update.handler({ canvas_id: "canvas-company" });
  assert.equal(updated.revision, 2);
  assert.equal(updated.state, "partial");
  assert.equal(JSON.stringify(company.parameters).includes("$ref"), false);
  assert.equal(JSON.stringify(update.parameters).includes("$ref"), false);
});

test("model canvas tools cannot author operating_plan blocks", async () => {
  const present = createCanvasTool({
    present: () => ({ id: "canvas-1", title: "View", blocks: [] })
  });
  const update = createCanvasUpdateTool({
    update: () => ({ id: "canvas-1", revision: 2, state: { kind: "ready" }, blocks: [] })
  });
  const payload = {
    version: "1",
    title: "Invented plan",
    source: { kind: "local", label: "model", refreshed_at: timestamp, references: [] },
    blocks: [{
      type: "operating_plan",
      sections: [{
        id: "outcome",
        title: "Desired outcome",
        items: [{ id: "obj-1", statement: "Invented", status: "confirmed", actions: ["confirm"] }]
      }]
    }]
  };
  await assert.rejects(() => present.handler(payload), /compiled by Desktop/);
  await assert.rejects(
    () => update.handler({ canvas_id: "canvas-1", blocks: payload.blocks }),
    /compiled by Desktop/
  );
  assert.equal(JSON.stringify(present.parameters).includes("operating_plan"), false);
});

test("semantic work-surface intent is language-neutral and carries no business authority", async () => {
  const tool = createWorkSurfaceRequestTool();
  const result = await tool.handler({
    intent: "comparison",
    title: "Comparação de desempenho",
    reason: "Uma comparação persistente torna as diferenças entre unidades mais claras."
  });
  assert.equal(tool.name, "desktop_request_work_surface");
  assert.equal(result.requested, true);
  assert.equal(result.intent, "comparison");
  assert.equal(Object.hasOwn(result, "credential"), false);
  assert.equal(Object.hasOwn(result, "authority"), false);
});
