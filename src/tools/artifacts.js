import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative } from "node:path";
import { renderDocumentArtifact } from "../artifacts/documentRenderer.js";
import {
  DOCUMENT_BLOCK_TYPES,
  DOCUMENT_FORMATS,
  DOCUMENT_STYLES,
  normalizeDocumentFormats,
  normalizeDocumentSpec
} from "../artifacts/documentSpec.js";
import { extractDocumentText } from "../desktop/attachments.js";
import { assertSafeAgentPath, resolveWorkspacePath } from "../util/pathSafety.js";

export function createArtifactTools() {
  return [{
    name: "desktop_create_document",
    source: "local",
    description:
      "Create verified DOCX and/or PDF files in the selected workspace from one typed document specification. Use for reports, briefs, proposals, SOPs, and other polished business documents.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative output path without an extension, for example reports/q3-brief."
        },
        formats: {
          type: "array",
          items: { type: "string", enum: DOCUMENT_FORMATS },
          minItems: 1,
          maxItems: 2,
          description: "Output formats. Defaults to both docx and pdf."
        },
        document: {
          type: "object",
          properties: {
            version: { type: "string", enum: ["1"] },
            title: { type: "string" },
            subtitle: { type: "string" },
            author: { type: "string" },
            subject: { type: "string" },
            style: { type: "string", enum: DOCUMENT_STYLES },
            blocks: {
              type: "array",
              minItems: 1,
              maxItems: 300,
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: DOCUMENT_BLOCK_TYPES },
                  level: { type: "integer", minimum: 1, maximum: 3 },
                  text: { type: "string" },
                  label: { type: "string" },
                  style: { type: "string", enum: ["bullets", "numbered"] },
                  items: { type: "array", items: { type: "string" } },
                  headers: { type: "array", items: { type: "string" } },
                  rows: {
                    type: "array",
                    items: { type: "array", items: { type: "string" } }
                  },
                  sources: {
                    type: "array",
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
                required: ["type"],
                additionalProperties: false
              }
            }
          },
          required: ["title", "blocks"],
          additionalProperties: false
        },
        reason: { type: "string", description: "Brief reason the document is being created." }
      },
      required: ["path", "document"],
      additionalProperties: false
    },
    async handler(args, context) {
      return createDocumentArtifacts(args, context);
    }
  }];
}

export async function createDocumentArtifacts(args, context) {
  const spec = normalizeDocumentSpec(args.document);
  const formats = normalizeDocumentFormats(args.formats);
  const root = context.config.safety.workspaceRoot;
  const basePath = normalizedBasePath(args.path);
  const targets = formats.map((format) => {
    const relativePath = `${basePath}.${format}`;
    const absolutePath = resolveWorkspacePath(
      root,
      relativePath,
      context.config.safety.allowOutsideWorkspace
    );
    assertSafeAgentPath(absolutePath, root);
    return { format, relativePath, absolutePath };
  });

  if (
    !context.config.safety.autoApproveWrites &&
    !context.config.safety.autoApproveKinds?.includes("file-write")
  ) {
    const approved = await context.approvals.confirm(
      [
        "AMOS Desktop wants to create document files:",
        "",
        ...targets.map((target) => `• ${target.relativePath}`),
        "",
        `Title: ${spec.title}`,
        args.reason ? `Reason: ${String(args.reason).slice(0, 500)}` : ""
      ].filter(Boolean).join("\n"),
      { kind: "file-write" }
    );
    if (!approved) return { ok: false, denied: true, message: "User denied document creation." };
  }

  const rendered = [];
  for (const target of targets) {
    const buffer = await renderDocumentArtifact(spec, target.format);
    const verification = await verifyArtifact(target.format, buffer, spec.title);
    rendered.push({ ...target, buffer, verification });
  }
  for (const artifact of rendered) {
    await mkdir(dirname(artifact.absolutePath), { recursive: true });
    await writeFile(artifact.absolutePath, artifact.buffer);
  }

  return {
    ok: true,
    contract: "amos.document-spec:1",
    title: spec.title,
    style: spec.style,
    artifacts: rendered.map((artifact) => ({
      path: relative(root, artifact.absolutePath),
      format: artifact.format,
      bytes: artifact.buffer.length,
      sha256: createHash("sha256").update(artifact.buffer).digest("hex"),
      verified: true,
      extracted_characters: artifact.verification.extractedCharacters
    }))
  };
}

async function verifyArtifact(format, buffer, title) {
  if (format === "pdf" && !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Generated PDF did not contain a valid PDF header");
  }
  if (format === "docx" && !(buffer[0] === 0x50 && buffer[1] === 0x4B)) {
    throw new Error("Generated DOCX did not contain a valid ZIP package header");
  }
  const mime = format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const extracted = await extractDocumentText({ name: `artifact.${format}`, mime, buffer });
  if (!extracted.trim() || !extracted.includes(title)) {
    throw new Error(`Generated ${format.toUpperCase()} failed text verification`);
  }
  return { extractedCharacters: extracted.length };
}

function normalizedBasePath(value) {
  const path = String(value || "").trim();
  if (!path) throw new Error("path is required");
  if (extname(path)) throw new Error("Document output path must not include a file extension");
  return path;
}
