import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  normalizeDocumentFormats,
  normalizeDocumentSpec
} from "../src/artifacts/documentSpec.js";
import { analyzeDocumentLayout } from "../src/artifacts/documentDiagnostics.js";
import { extractDocumentText } from "../src/desktop/attachments.js";
import { createArtifactTools } from "../src/tools/artifacts.js";

const DOCUMENT = {
  version: "1",
  title: "Quarterly Operating Brief",
  subtitle: "A verified AMOS Desktop artifact",
  author: "AMOS Labs",
  subject: "Operating review",
  style: "business",
  blocks: [
    { type: "heading", level: 1, text: "Executive summary" },
    { type: "paragraph", text: "Revenue is growing and the expansion pipeline remains strong." },
    { type: "list", style: "bullets", items: ["Protect retention", "Expand qualified accounts"] },
    {
      type: "table",
      headers: ["Metric", "Current", "Status"],
      rows: [["ARR", "$3M", "Growing"], ["Expansion", "Strong", "On track"]]
    },
    { type: "callout", label: "Decision", text: "Fund the next operating phase." },
    {
      type: "sources",
      sources: [{ label: "Operating snapshot", source_ref: "amos:briefing:quarterly" }]
    }
  ]
};

test("DocumentSpec is bounded and rejects unsafe source contracts", () => {
  const spec = normalizeDocumentSpec(DOCUMENT);
  assert.equal(spec.title, DOCUMENT.title);
  assert.deepEqual(normalizeDocumentFormats(["pdf", "pdf"]), ["pdf"]);
  assert.throws(
    () => normalizeDocumentSpec({
      title: "Unsafe source",
      blocks: [{
        type: "sources",
        sources: [{ label: "Metadata", url: "http://169.254.169.254/latest/meta-data" }]
      }]
    }),
    /must use HTTPS/
  );
  assert.throws(
    () => normalizeDocumentSpec({
      title: "Wide table",
      blocks: [{
        type: "table",
        headers: Array.from({ length: 9 }, (_, index) => `Column ${index}`),
        rows: [Array(9).fill("value")]
      }]
    }),
    /between 1 and 8 items/
  );
  assert.throws(
    () => normalizeDocumentSpec({
      version: "1",
      title: "Legacy visual",
      blocks: [{ type: "image", path: "logo.png", alt_text: "Logo" }]
    }),
    /require DocumentSpec version 2/
  );
  assert.throws(
    () => normalizeDocumentSpec({
      version: "2",
      title: "Mismatched template",
      style: "business",
      template: "narrative_proposal",
      blocks: [{ type: "paragraph", text: "Blocked." }]
    }),
    /does not match template/
  );
  assert.throws(
    () => normalizeDocumentSpec({
      version: "2",
      title: "Unsafe image",
      blocks: [{ type: "image", path: "../logo.png", alt_text: "Logo" }]
    }),
    /workspace-relative PNG or JPEG/
  );
});

test("Desktop creates and reopens verified DOCX and PDF from one specification", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-documents-"));
  let approvals = 0;
  let previewInput = null;
  const tool = createArtifactTools({
    present: async (input) => {
      previewInput = input;
      return { id: "canvas-document", revision: 1 };
    }
  })[0];
  const result = await tool.handler(
    {
      path: "reports/quarterly-operating-brief",
      formats: ["docx", "pdf"],
      document: DOCUMENT,
      reason: "Prepare the operating review"
    },
    {
      config: {
        safety: {
          workspaceRoot: root,
          allowOutsideWorkspace: false,
          autoApproveWrites: false,
          autoApproveKinds: []
        }
      },
      approvals: {
        confirm: async (_message, options) => {
          approvals += 1;
          assert.equal(options.kind, "file-write");
          return true;
        }
      }
    }
  );

  assert.equal(approvals, 1);
  assert.equal(result.ok, true);
  assert.equal(result.contract, "amos.document-spec:1");
  assert.equal(result.layout.status, "ready");
  assert.equal(result.layout.estimated_pages, 1);
  assert.deepEqual(result.preview, {
    available: true,
    canvas_id: "canvas-document",
    revision: 1
  });
  assert.equal(previewInput.document.title, DOCUMENT.title);
  assert.equal(previewInput.artifacts.length, 2);
  assert.equal(previewInput.pagePreview.page_count, 1);
  assert.equal(previewInput.pagePreview.pages.length, 1);
  assert.match(previewInput.pagePreview.pages[0].path, /^\.amos\/previews\//);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.format), ["docx", "pdf"]);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.verified, true);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await stat(join(root, artifact.path))).size, artifact.bytes);
    const buffer = await readFile(join(root, artifact.path));
    if (artifact.format === "pdf") {
      const pageObjects = buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || [];
      assert.equal(pageObjects.length, 1);
    }
    const mime = artifact.format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const text = await extractDocumentText({ name: artifact.path, mime, buffer });
    assert.match(text, /Quarterly Operating Brief/);
    assert.match(text, /Fund the next operating phase/);
  }
});

test("DocumentSpec v2 renders branded images, deterministic charts, and page thumbnails", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-documents-v2-"));
  await copyFile(
    new URL("../desktop/assets/amos-mark.png", import.meta.url),
    join(root, "logo.png")
  );
  const tool = createArtifactTools()[0];
  const result = await tool.handler({
    path: "visual-brief",
    formats: ["docx", "pdf"],
    document: {
      version: "2",
      title: "Visual Operating Brief",
      style: "business",
      template: "standard_business_brief",
      header: "AMOS Operating Review",
      footer: "Confidential",
      brand: {
        name: "AMOS Labs",
        primary_color: "315FD6",
        secondary_color: "EEF3FF",
        text_color: "172033",
        logo_path: "logo.png"
      },
      blocks: [
        { type: "heading", level: 1, text: "Performance" },
        {
          type: "image",
          path: "logo.png",
          alt_text: "AMOS orbit mark",
          caption: "Figure 1. AMOS visual identity",
          width_percent: 35,
          source_ref: "workspace:logo.png"
        },
        {
          type: "chart",
          chart_type: "bar",
          title: "ARR growth",
          labels: ["Q1", "Q2", "Q3"],
          series: [{ name: "ARR", values: [1.8, 2.4, 3] }],
          alt_text: "Bar chart showing ARR increasing from 1.8 to 3 million",
          caption: "Figure 2. ARR by quarter",
          source_ref: "amos:metric:arr"
        }
      ]
    }
  }, {
    config: {
      safety: {
        workspaceRoot: root,
        allowOutsideWorkspace: false,
        autoApproveWrites: true,
        autoApproveKinds: []
      }
    },
    approvals: { confirm: async () => true }
  });

  assert.equal(result.ok, true);
  assert.equal(result.contract, "amos.document-spec:2");
  assert.ok(result.page_preview.page_count >= 1);
  assert.equal(result.page_preview.rendered_pages, result.page_preview.page_count);
  assert.equal((await stat(join(root, result.page_preview.pages[0].path))).isFile(), true);
  for (const artifact of result.artifacts) {
    assert.equal((await stat(join(root, artifact.path))).isFile(), true);
  }
  const docxArtifact = result.artifacts.find((artifact) => artifact.format === "docx");
  const zip = await JSZip.loadAsync(await readFile(join(root, docxArtifact.path)));
  const documentXml = await zip.file("word/document.xml").async("string");
  const settingsXml = await zip.file("word/settings.xml").async("string");
  assert.match(documentXml, /<w:headerReference w:type="default"/);
  assert.match(documentXml, /<w:footerReference w:type="default"/);
  assert.doesNotMatch(settingsXml, /<w:evenAndOddHeaders\s+w:val="(?:false|0|off|no)"/);
});

test("layout diagnostics provide bounded repair guidance before regeneration", () => {
  const layout = analyzeDocumentLayout({
    title: "A very long operating review title that should be shortened before it is shared with the executive team and board",
    blocks: [
      { type: "heading", level: 1, text: "Detached heading" },
      { type: "page_break" },
      {
        type: "table",
        headers: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
        rows: [["1", "2", "3", "4", "5", "6", "7"]]
      }
    ]
  });
  assert.equal(layout.status, "attention");
  assert.ok(layout.estimated_pages >= 2);
  assert.deepEqual(
    layout.diagnostics.map((item) => item.code),
    ["long-title", "orphan-heading", "wide-table"]
  );
  assert.ok(layout.diagnostics.every((item) => item.severity === "warning"));
});

test("Document creation denies writes cleanly and rejects paths outside the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-documents-denied-"));
  const tool = createArtifactTools()[0];
  const context = {
    config: {
      safety: {
        workspaceRoot: root,
        allowOutsideWorkspace: false,
        autoApproveWrites: false,
        autoApproveKinds: []
      }
    },
    approvals: { confirm: async () => false }
  };
  const denied = await tool.handler({ path: "brief", formats: ["pdf"], document: DOCUMENT }, context);
  assert.deepEqual(denied, {
    ok: false,
    denied: true,
    message: "User denied document creation."
  });
  await assert.rejects(stat(join(root, "brief.pdf")), /ENOENT/);
  await assert.rejects(
    tool.handler({ path: "../escape", formats: ["pdf"], document: DOCUMENT }, context),
    /escapes workspace/
  );
  await assert.rejects(
    tool.handler({ path: "already.pdf", formats: ["pdf"], document: DOCUMENT }, context),
    /must not include a file extension/
  );
});
