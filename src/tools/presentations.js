import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { analyzePresentationLayout } from "../artifacts/presentationDiagnostics.js";
import { resolvePresentationAssets } from "../artifacts/presentationAssets.js";
import { renderPresentationPreviewSlides } from "../artifacts/presentationPreview.js";
import { renderPresentationArtifact } from "../artifacts/presentationRenderer.js";
import {
  PRESENTATION_KINDS,
  PRESENTATION_LAYOUTS,
  PRESENTATION_SIZES,
  PRESENTATION_STYLES,
  PRESENTATION_TEMPLATES,
  normalizePresentationSpec
} from "../artifacts/presentationSpec.js";
import { assertSafeAgentPath, resolveWorkspacePath } from "../util/pathSafety.js";

export function createPresentationTools({ present = null } = {}) {
  return [presentationArtifactTool({ present })];
}

function presentationArtifactTool({ present }) {
  return {
    name: "desktop_create_presentation",
    source: "local",
    description: [
      "Create a verified native PowerPoint PPTX file directly in the selected workspace from one typed presentation specification.",
      "Use this—not Bash, Python, or a document—when the user asks for a deck, slides, briefing, investor presentation, operating review, or sales presentation.",
      "V1 is create-from-spec only. Do not invent freeform coordinates, OOXML, animations, or claim inherited-template editing."
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative output path without .pptx, for example decks/q3-operating-review."
        },
        presentation: presentationSchema(),
        reason: { type: "string", description: "Brief reason the deck is being created." }
      },
      required: ["path", "presentation"],
      additionalProperties: false
    },
    async handler(args, context) {
      return createPresentationArtifact(args, context, { present });
    }
  };
}

export async function createPresentationArtifact(args, context, { present = null } = {}) {
  const spec = normalizePresentationSpec(args.presentation);
  const layout = analyzePresentationLayout(spec);
  const root = context.config.safety.workspaceRoot;
  const canonicalRoot = resolveWorkspacePath(root, ".", false);
  const relativePath = `${normalizedBasePath(args.path)}.pptx`;
  const absolutePath = resolveWorkspacePath(
    root,
    relativePath,
    context.config.safety.allowOutsideWorkspace
  );
  assertSafeAgentPath(absolutePath, root);
  const assets = await resolvePresentationAssets(spec, root);

  if (
    !context.config.safety.autoApproveWrites &&
    !context.config.safety.autoApproveKinds?.includes("file-write")
  ) {
    const approved = await context.approvals.confirm(
      [
        "AMOS Desktop wants to create a verified PowerPoint file:",
        "",
        `• ${relativePath}`,
        `• ${spec.slides.length} slides from amos.presentation-spec:${spec.version}`,
        "• .amos/previews/<presentation-digest>/slide-*.png (bounded local preview cache)",
        "",
        `Title: ${spec.title}`,
        args.reason ? `Reason: ${String(args.reason).slice(0, 500)}` : ""
      ].filter(Boolean).join("\n"),
      { kind: "file-write" }
    );
    if (!approved) return { ok: false, denied: true, message: "User denied presentation creation." };
  }

  const rendered = await renderPresentationArtifact(spec, { assets });
  const slidePreview = await renderPresentationPreviewSlides(spec, assets);
  const previewDigest = createHash("sha256").update(rendered.buffer).digest("hex");
  const previewDirectory = resolveWorkspacePath(
    root,
    `.amos/previews/${previewDigest.slice(0, 24)}`,
    false
  );
  assertSafeAgentPath(previewDirectory, root);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, rendered.buffer);
  await mkdir(previewDirectory, { recursive: true });
  const previewSlides = [];
  for (const slide of slidePreview.slides) {
    const slideAbsolutePath = resolveWorkspacePath(
      previewDirectory,
      `slide-${slide.slide}.png`,
      false
    );
    await writeFile(slideAbsolutePath, slide.data);
    previewSlides.push({
      path: relative(canonicalRoot, slideAbsolutePath).replaceAll("\\", "/"),
      slide: slide.slide,
      title: slide.title,
      layout: slide.layout,
      width: slide.width,
      height: slide.height,
      bytes: slide.bytes,
      sha256: slide.sha256
    });
  }
  const artifact = {
    path: relative(canonicalRoot, absolutePath).replaceAll("\\", "/"),
    format: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: rendered.buffer.length,
    sha256: previewDigest,
    verified: rendered.verification.verified
  };

  const slidePreviewPayload = {
    slide_count: slidePreview.slideCount,
    truncated: slidePreview.truncated,
    slides: previewSlides
  };
  let preview = null;
  if (typeof present === "function") {
    try {
      const canvas = await present({
        presentation: spec,
        artifact,
        layout,
        verification: rendered.verification,
        slidePreview: slidePreviewPayload,
        generatedAt: new Date().toISOString()
      });
      preview = { available: true, canvas_id: canvas.id, revision: canvas.revision };
    } catch (error) {
      preview = {
        available: false,
        error: String(error?.message || "Presentation preview is unavailable").slice(0, 500)
      };
    }
  }

  return {
    ok: true,
    contract: `amos.presentation-spec:${spec.version}`,
    title: spec.title,
    kind: spec.kind,
    style: spec.style,
    layout,
    artifact,
    verification: rendered.verification,
    slide_preview: {
      slide_count: slidePreview.slideCount,
      rendered_slides: previewSlides.length,
      truncated: slidePreview.truncated,
      slides: previewSlides
    },
    preview
  };
}

function presentationSchema() {
  return {
    type: "object",
    properties: {
      version: { type: "string", enum: ["1"] },
      title: { type: "string" },
      subtitle: { type: "string" },
      author: { type: "string" },
      kind: { type: "string", enum: PRESENTATION_KINDS },
      size: { type: "string", enum: PRESENTATION_SIZES },
      style: { type: "string", enum: PRESENTATION_STYLES },
      template: { type: "string", enum: PRESENTATION_TEMPLATES },
      footer: { type: "string" },
      brand: {
        type: "object",
        properties: {
          name: { type: "string" },
          primary_color: { type: "string" },
          secondary_color: { type: "string" },
          text_color: { type: "string" },
          logo_path: { type: "string" }
        },
        additionalProperties: false
      },
      slides: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          properties: {
            layout: { type: "string", enum: PRESENTATION_LAYOUTS },
            title: { type: "string" },
            eyebrow: { type: "string" },
            subtitle: { type: "string" },
            notes: { type: "string" },
            text: { type: "string" },
            items: { type: "array", maxItems: 8, items: { type: "string" } },
            columns: {
              type: "array",
              maxItems: 2,
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  text: { type: "string" },
                  items: { type: "array", maxItems: 6, items: { type: "string" } }
                },
                required: ["title"],
                additionalProperties: false
              }
            },
            metrics: {
              type: "array",
              maxItems: 6,
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  delta: { type: "string" },
                  note: { type: "string" }
                },
                required: ["label", "value"],
                additionalProperties: false
              }
            },
            headers: { type: "array", maxItems: 8, items: { type: "string" } },
            rows: {
              type: "array",
              maxItems: 12,
              items: { type: "array", maxItems: 8, items: { type: "string" } }
            },
            chart_type: { type: "string", enum: ["bar", "line"] },
            labels: { type: "array", maxItems: 12, items: { type: "string" } },
            series: {
              type: "array",
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  values: { type: "array", maxItems: 12, items: { type: "number" } },
                  color: { type: "string" }
                },
                required: ["name", "values"],
                additionalProperties: false
              }
            },
            quote: { type: "string" },
            attribution: { type: "string" },
            path: { type: "string" },
            alt_text: { type: "string" },
            caption: { type: "string" },
            source_ref: { type: "string" },
            next_step: { type: "string" },
            sources: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  url: { type: "string" },
                  source_ref: { type: "string" }
                },
                required: ["label"],
                additionalProperties: false
              }
            }
          },
          required: ["layout", "title"],
          additionalProperties: false
        }
      }
    },
    required: ["title", "slides"],
    additionalProperties: false
  };
}

function normalizedBasePath(value) {
  const input = String(value || "").trim().replaceAll("\\", "/");
  if (!input) throw new Error("Presentation output path is required");
  if (input.toLowerCase().endsWith(".pptx")) throw new Error("Presentation path must not include .pptx");
  if (input.includes("\0") || input.split("/").includes("..") || input.startsWith("/")) {
    throw new Error("Presentation output path must stay inside the selected workspace");
  }
  return input;
}
