import test from "node:test";
import assert from "node:assert/strict";
import { access, copyFile, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  PRESENTATION_LIMITS,
  normalizePresentationSpec,
  presentationSlideTitles,
  presentationText
} from "../src/artifacts/presentationSpec.js";
import { analyzePresentationLayout } from "../src/artifacts/presentationDiagnostics.js";
import { extractPresentationText, verifyPresentationBuffer } from "../src/artifacts/presentationRenderer.js";
import { renderPresentationArtifact } from "../src/artifacts/presentationRenderer.js";
import { resolvePresentationAssets } from "../src/artifacts/presentationAssets.js";
import { createPresentationArtifact, createPresentationTools } from "../src/tools/presentations.js";
import { ToolRegistry } from "../src/tools/registry.js";

const DECK = {
  version: "1",
  title: "Q3 Operating Review",
  subtitle: "Retention first",
  author: "AMOS Labs",
  kind: "operating_review",
  style: "business",
  footer: "Confidential",
  brand: {
    name: "AMOS Labs",
    primary_color: "315FD6",
    logo_path: "brand/logo.png"
  },
  slides: [
    {
      layout: "title",
      title: "Q3 Operating Review",
      subtitle: "Retention first",
      notes: "Open with the retention number, not the narrative."
    },
    {
      layout: "metrics",
      title: "The quarter in four numbers",
      metrics: [
        { label: "ARR", value: "$3.1M", delta: "+18%" },
        { label: "NRR", value: "118%", note: "Expansion held" },
        { label: "Gross margin", value: "79%" },
        { label: "Cash", value: "18 mo" }
      ]
    },
    {
      layout: "bullets",
      eyebrow: "Focus",
      title: "Protect what is already working",
      items: ["Keep NRR above 115%", "Hire two solution consultants", "Cut unpaid pilots"]
    },
    {
      layout: "two_column",
      title: "Where time should go",
      columns: [
        { title: "Do now", items: ["Close expansion on Northwind", "Ship PPTX create"] },
        { title: "Do later", text: "Inherited-template editing waits until create reopens cleanly." }
      ]
    },
    {
      layout: "table",
      title: "Pipeline by stage",
      headers: ["Stage", "Count", "ARR"],
      rows: [["Commit", "4", "$420k"], ["Verify", "6", "$610k"]]
    },
    {
      layout: "chart",
      title: "ARR by quarter",
      chart_type: "bar",
      labels: ["Q1", "Q2", "Q3"],
      series: [{ name: "ARR", values: [2.2, 2.6, 3.1] }],
      alt_text: "Bar chart of ARR rising from 2.2 to 3.1"
    },
    {
      layout: "quote",
      title: "Customer signal",
      quote: "AMOS is the first operator that keeps receipts.",
      attribution: "Northwind COO"
    },
    {
      layout: "image",
      title: "Product surface",
      path: "previews/desktop.png",
      alt_text: "Desktop canvas showing a verified workbook",
      caption: "Verified XLSX on the operating canvas"
    },
    {
      layout: "section",
      title: "Ask"
    },
    {
      layout: "closer",
      title: "Fund the next ninety days",
      next_step: "Approve the presentation engine slice.",
      items: ["Ship create-from-spec", "Qualify reopen in PowerPoint"],
      sources: [{ label: "Operating snapshot", source_ref: "amos:briefing:q3" }]
    }
  ]
};

test("PresentationSpec rejects a runaway payload before normalizing fields", () => {
  const huge = {
    title: "Oversized",
    slides: [{ layout: "bullets", title: "Big", items: ["x".repeat(PRESENTATION_LIMITS.maxTotalCharacters * 3)] }]
  };
  assert.throws(() => normalizePresentationSpec(huge), /byte input limit/);
  // A circular structure still fails safely (size guard, then object validation).
  const circular = { title: "Loop" };
  circular.self = circular;
  assert.throws(() => normalizePresentationSpec(circular));
});

test("PPTX verification reopens the package and counts packaged media", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-pptx-media-"));
  const chartDeck = {
    version: "1",
    title: "Media Check",
    slides: [
      { layout: "title", title: "Media Check" },
      {
        layout: "chart",
        title: "ARR",
        chart_type: "bar",
        labels: ["Q1", "Q2"],
        series: [{ name: "ARR", values: [1, 2] }],
        alt_text: "ARR rising"
      }
    ]
  };
  const assets = await resolvePresentationAssets(chartDeck, root);
  const rendered = await renderPresentationArtifact(chartDeck, { assets });
  assert.equal(rendered.verification.verified, true);
  // One chart renders as exactly one packaged media part; the reopened package
  // agrees, and the slide count round-trips.
  const zip = await JSZip.loadAsync(rendered.buffer);
  const mediaParts = Object.keys(zip.files).filter((name) => /^ppt\/media\/.+/.test(name));
  assert.equal(mediaParts.length, 1);
  assert.equal(rendered.verification.slideCount, 2);
});

test("PresentationSpec is bounded and rejects unsafe contracts", () => {
  const spec = normalizePresentationSpec(DECK);
  assert.equal(spec.title, DECK.title);
  assert.equal(spec.size, "widescreen_16_9");
  assert.equal(spec.template, "standard_business_brief");
  assert.equal(spec.slides.length, 10);
  assert.deepEqual(presentationSlideTitles(spec), DECK.slides.map((slide) => slide.title));
  assert.match(presentationText(spec), /Q3 Operating Review/);
  assert.match(presentationText(spec), /Keep NRR above 115%/);

  assert.throws(
    () => normalizePresentationSpec({
      title: "Unknown layout",
      slides: [{ layout: "freeform", title: "Nope" }]
    }),
    /Unsupported presentation layout/
  );
  assert.throws(
    () => normalizePresentationSpec({
      title: "Too many bullets",
      slides: [{
        layout: "bullets",
        title: "Overflow",
        items: Array.from({ length: PRESENTATION_LIMITS.maxBullets + 1 }, (_, index) => `Point ${index}`)
      }]
    }),
    /between 1 and 8 items/
  );
  assert.throws(
    () => normalizePresentationSpec({
      title: "Wide table",
      slides: [{
        layout: "table",
        title: "Too wide",
        headers: Array.from({ length: 9 }, (_, index) => `Col ${index}`),
        rows: [Array(9).fill("x")]
      }]
    }),
    /between 1 and 8 items/
  );
  assert.throws(
    () => normalizePresentationSpec({
      title: "Unsafe image",
      slides: [{
        layout: "image",
        title: "Logo",
        path: "../logo.png",
        alt_text: "Logo"
      }]
    }),
    /workspace-relative PNG or JPEG/
  );
  assert.throws(
    () => normalizePresentationSpec({
      title: "Unsafe brand",
      brand: { logo_path: "/etc/passwd.png" },
      slides: [{ layout: "title", title: "Cover" }]
    }),
    /workspace-relative PNG or JPEG/
  );
  assert.throws(
    () => normalizePresentationSpec({
      title: "Unsafe source",
      slides: [{
        layout: "closer",
        title: "Next",
        sources: [{ label: "Metadata", url: "http://169.254.169.254/latest/meta-data" }]
      }]
    }),
    /must use HTTPS/
  );
  assert.throws(
    () => normalizePresentationSpec({
      title: "Mismatched template",
      style: "business",
      template: "narrative_proposal",
      slides: [{ layout: "title", title: "Cover" }]
    }),
    /does not match template/
  );
  assert.throws(
    () => normalizePresentationSpec({
      version: "2",
      title: "Future",
      slides: [{ layout: "title", title: "Cover" }]
    }),
    /Unsupported PresentationSpec version/
  );
  assert.throws(
    () => normalizePresentationSpec({
      title: "Empty column",
      slides: [{
        layout: "two_column",
        title: "Split",
        columns: [{ title: "Left", items: ["One"] }, { title: "Right" }]
      }]
    }),
    /needs text or items/
  );
});

test("layout diagnostics flag dense frames without blocking a valid spec", () => {
  const ready = analyzePresentationLayout(DECK);
  assert.equal(ready.status, "ready");
  assert.equal(ready.slide_count, 10);

  const layout = analyzePresentationLayout({
    title: "A very long operating review title that will wrap across the 16:9 cover slide",
    kind: "investor",
    slides: [
      {
        layout: "section",
        title: "Skipped the cover"
      },
      {
        layout: "section",
        title: "Another divider"
      },
      {
        layout: "bullets",
        title: "This headline is also long enough that it should wrap on a widescreen frame",
        items: [
          "One",
          "Two",
          "Three",
          "Four",
          "Five",
          "Six",
          "Seven is the density warning"
        ]
      },
      {
        layout: "metrics",
        title: "Too many cards",
        metrics: [
          { label: "A", value: "1" },
          { label: "B", value: "2" },
          { label: "C", value: "3" },
          { label: "D", value: "4" },
          { label: "E", value: "5" }
        ]
      },
      {
        layout: "table",
        title: "Wide",
        headers: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
        rows: [["1", "2", "3", "4", "5", "6", "7"]]
      },
      {
        layout: "image",
        title: "No caption",
        path: "shot.png",
        alt_text: "Screenshot"
      }
    ]
  });
  assert.equal(layout.status, "attention");
  assert.deepEqual(
    layout.diagnostics.map((item) => item.code),
    [
      "long-title",
      "missing-title-slide",
      "missing-closer",
      "consecutive-sections",
      "long-slide-title",
      "dense-bullets",
      "dense-metrics",
      "wide-table",
      "uncaptioned-image"
    ]
  );
  assert.ok(layout.diagnostics.every((item) => item.severity === "warning"));
});

test("model schema keeps exact slide ceilings while runtime writes verified PPTX", async () => {
  const tool = createPresentationTools().find((item) => item.name === "desktop_create_presentation");
  const slides = tool.parameters.properties.presentation.properties.slides;
  assert.equal(slides.maxItems, 40);
  assert.equal(slides.items.properties.items.maxItems, 8);
  assert.equal(slides.items.properties.headers.maxItems, 8);

  const registry = new ToolRegistry();
  registry.register(tool);
  const modelSlides = registry.openAiTools()[0].function.parameters.properties.presentation.properties.slides;
  assert.equal(modelSlides.maxItems, 40);
  assert.equal(modelSlides.items.properties.items.maxItems, 8);
});

test("Desktop creates and reopens a verified PPTX from one specification", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-presentations-"));
  await copyFile(
    new URL("../desktop/assets/amos-mark.png", import.meta.url),
    join(root, "brand-logo.png")
  );
  await copyFile(
    new URL("../desktop/assets/amos-mark.png", import.meta.url),
    join(root, "product.png")
  );
  let approvals = 0;
  const presented = [];
  const spec = {
    ...DECK,
    brand: { ...DECK.brand, logo_path: "brand-logo.png" },
    slides: DECK.slides.map((slide) => slide.layout === "image"
      ? { ...slide, path: "product.png" }
      : slide)
  };
  const result = await createPresentationArtifact(
    {
      path: "decks/q3-operating-review",
      presentation: spec,
      reason: "Ship the operating review deck"
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
    },
    {
      present: async (input) => {
        presented.push(input);
        return { id: "canvas-deck", revision: 1 };
      }
    }
  );

  assert.equal(approvals, 1);
  assert.equal(result.ok, true);
  assert.equal(result.contract, "amos.presentation-spec:1");
  assert.equal(result.artifact.path, "decks/q3-operating-review.pptx");
  assert.equal(result.artifact.verified, true);
  assert.equal(result.verification.slideCount, 10);
  assert.equal(result.preview.canvas_id, "canvas-deck");
  assert.equal(presented.length, 1);
  assert.equal(result.slide_preview.slide_count, 10);
  assert.equal(result.slide_preview.rendered_slides, 10);
  assert.equal(result.slide_preview.slides[0].path.startsWith(".amos/previews/"), true);
  assert.equal(presented[0].slidePreview.slides.length, 10);
  assert.equal((await stat(join(root, result.artifact.path))).size, result.artifact.bytes);
  assert.equal((await stat(join(root, result.slide_preview.slides[0].path))).size, result.slide_preview.slides[0].bytes);
  const previewPng = await readFile(join(root, result.slide_preview.slides[0].path));
  assert.deepEqual(previewPng.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const buffer = await readFile(join(root, result.artifact.path));
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4B);
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file("[Content_Types].xml"));
  assert.ok(zip.file("ppt/presentation.xml"));
  assert.equal(
    Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length,
    10
  );
  const extracted = await extractPresentationText(buffer);
  assert.match(extracted, /Q3 Operating Review/);
  assert.match(extracted, /Protect what is already working/);
  assert.match(extracted, /Fund the next ninety days/);
  assert.match(extracted, /Open with the retention number/);
});

test("presentation creation denies writes cleanly and rejects paths outside the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-presentations-denied-"));
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
  const denied = await createPresentationArtifact(
    { path: "decks/blocked", presentation: { title: "Blocked", slides: [{ layout: "title", title: "Cover" }] } },
    context
  );
  assert.deepEqual(denied, {
    ok: false,
    denied: true,
    message: "User denied presentation creation."
  });
  await assert.rejects(access(join(root, "decks/blocked.pptx")));
  await assert.rejects(
    createPresentationArtifact({ path: "../escape", presentation: { title: "Nope", slides: [{ layout: "title", title: "Cover" }] } }, context),
    /must stay inside the selected workspace/
  );
  await assert.rejects(
    createPresentationArtifact({ path: "already.pptx", presentation: { title: "Nope", slides: [{ layout: "title", title: "Cover" }] } }, context),
    /must not include \.pptx/
  );
});
