import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  applyDocumentReview,
  finalizeDocumentReview
} from "../artifacts/documentReview.js";
import { extractDocumentText } from "../desktop/attachments.js";
import { assertSafeAgentPath, resolveWorkspacePath } from "../util/pathSafety.js";
import { resolveDefaultWorkspacePath } from "../util/workspaceFocus.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_DOCX_BYTES = 50 * 1024 * 1024;

export function createDocumentReviewTools() {
  return [
    {
      name: "desktop_edit_document",
      source: "local",
      description: "Edit an existing DOCX with exact anchored replacements, true Word tracked changes, and/or true inline comments while preserving unaffected package content.",
      parameters: {
        type: "object",
        properties: {
          source_path: { type: "string", description: "Workspace-relative source DOCX path." },
          output_path: { type: "string", description: "Different workspace-relative output DOCX path." },
          track_changes: { type: "boolean", description: "Create real Word insertions/deletions. Defaults to true." },
          author: { type: "string" },
          edits: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                find: { type: "string" },
                replace: { type: "string" },
                occurrence: { type: "integer", minimum: 1, maximum: 1000 },
                comment: { type: "string" },
                comment_occurrence: { type: "integer", minimum: 1, maximum: 1000 }
              },
              required: ["find", "replace"],
              additionalProperties: false
            }
          },
          comments: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                find: { type: "string" },
                text: { type: "string" },
                occurrence: { type: "integer", minimum: 1, maximum: 1000 }
              },
              required: ["find", "text"],
              additionalProperties: false
            }
          },
          reason: { type: "string" }
        },
        required: ["source_path", "output_path"],
        additionalProperties: false
      },
      handler: (args, context) => editDocument(args, context)
    },
    {
      name: "desktop_finalize_document",
      source: "local",
      description: "Create a clean or alternate DOCX from a reviewed DOCX by accepting, rejecting, or preserving tracked changes and removing or preserving comments.",
      parameters: {
        type: "object",
        properties: {
          source_path: { type: "string" },
          output_path: { type: "string" },
          changes: { type: "string", enum: ["accept", "reject", "preserve"] },
          comments: { type: "string", enum: ["remove", "preserve"] },
          reason: { type: "string" }
        },
        required: ["source_path", "output_path"],
        additionalProperties: false
      },
      handler: (args, context) => finalizeDocument(args, context)
    }
  ];
}

async function editDocument(args, context) {
  if (!(args.edits?.length || args.comments?.length)) {
    throw new Error("Provide at least one exact edit or comment");
  }
  const paths = await documentPaths(args, context);
  const source = await readSource(paths.sourceAbsolute, args.source_path);
  const result = await applyDocumentReview(source, {
    edits: args.edits,
    comments: args.comments,
    trackChanges: args.track_changes !== false,
    author: args.author || "AMOS Desktop"
  });
  await approveReviewWrite(args, context, paths, [
    `${result.edits} exact ${result.edits === 1 ? "edit" : "edits"}`,
    `${result.comments} inline ${result.comments === 1 ? "comment" : "comments"}`,
    args.track_changes === false ? "Clean replacements" : "Word tracked changes"
  ]);
  return writeReviewedDocument(result.buffer, source, paths, result.review, {
    operation: args.track_changes === false ? "edit" : "review"
  });
}

async function finalizeDocument(args, context) {
  const paths = await documentPaths(args, context);
  const source = await readSource(paths.sourceAbsolute, args.source_path);
  const result = await finalizeDocumentReview(source, {
    changes: args.changes || "accept",
    comments: args.comments || "remove"
  });
  await approveReviewWrite(args, context, paths, [
    `Tracked changes: ${result.changes}`,
    `Comments: ${result.comments}`
  ]);
  return writeReviewedDocument(result.buffer, source, paths, result.review, {
    operation: "finalize",
    changes: result.changes,
    comments: result.comments
  });
}

async function documentPaths(args, context) {
  const root = context.config.safety.workspaceRoot;
  const sourcePath = normalizedDocxPath(args.source_path, "source_path");
  const outputPath = normalizedDocxPath(args.output_path, "output_path");
  if (sourcePath === outputPath) throw new Error("output_path must differ from source_path");
  const sourceAbsolute = resolveDefaultWorkspacePath(context.config.safety, sourcePath, false);
  const outputAbsolute = resolveDefaultWorkspacePath(context.config.safety, outputPath, false);
  assertSafeAgentPath(sourceAbsolute, root);
  assertSafeAgentPath(outputAbsolute, root);
  return { root, sourcePath, outputPath, sourceAbsolute, outputAbsolute };
}

async function readSource(path, label) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} is not a regular file`);
  if (info.size > MAX_DOCX_BYTES) throw new Error(`${label} exceeds the 50 MB review limit`);
  return readFile(path);
}

async function approveReviewWrite(args, context, paths, details) {
  if (
    context.config.safety.autoApproveWrites ||
    context.config.safety.autoApproveKinds?.includes("file-write")
  ) return;
  const approved = await context.approvals.confirm([
    "AMOS Desktop wants to write a revised Word document:",
    "",
    `Source: ${paths.sourcePath}`,
    `Output: ${paths.outputPath}`,
    ...details.map((detail) => `• ${detail}`),
    args.reason ? `Reason: ${String(args.reason).slice(0, 500)}` : ""
  ].filter(Boolean).join("\n"), { kind: "file-write" });
  if (!approved) {
    const error = new Error("User denied document revision.");
    error.code = "AMOS_DOCUMENT_REVIEW_DENIED";
    throw error;
  }
}

async function writeReviewedDocument(buffer, source, paths, review, detail) {
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4B)) {
    throw new Error("Revised DOCX did not contain a valid ZIP package header");
  }
  const extracted = await extractDocumentText({
    name: paths.outputPath,
    mime: DOCX_MIME,
    buffer
  });
  if (!extracted.trim()) throw new Error("Revised DOCX failed text verification");
  await mkdir(dirname(paths.outputAbsolute), { recursive: true });
  await writeFile(paths.outputAbsolute, buffer);
  return {
    ok: true,
    contract: "amos.document-review:1",
    ...detail,
    source: {
      path: paths.sourcePath,
      sha256: createHash("sha256").update(source).digest("hex")
    },
    artifact: {
      path: relative(paths.root, paths.outputAbsolute).replaceAll("\\", "/"),
      format: "docx",
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      verified: true,
      extracted_characters: extracted.length
    },
    review
  };
}

function normalizedDocxPath(value, field) {
  const path = String(value || "").trim().replaceAll("\\", "/");
  if (
    !path ||
    path.length > 1_000 ||
    path.startsWith("/") ||
    /^[a-z]:\//i.test(path) ||
    path.split("/").includes("..") ||
    !path.toLowerCase().endsWith(".docx")
  ) {
    throw new Error(`${field} must be a workspace-relative DOCX path`);
  }
  return path;
}
