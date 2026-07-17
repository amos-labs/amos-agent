import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { resolveWorkspacePath, truncateText } from "../util/pathSafety.js";

const DEFAULT_IGNORES = new Set([".git", "node_modules", "dist", "coverage", ".amos-agent"]);

export function createFileTools() {
  return [
    {
      name: "list_files",
      source: "local",
      description: "List files in the local workspace, skipping common generated folders.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative path. Defaults to ." },
          max_results: { type: "integer", description: "Maximum file paths to return." }
        },
        additionalProperties: false
      },
      async handler(args, context) {
        const root = context.config.safety.workspaceRoot;
        const start = resolveWorkspacePath(root, args.path || ".", context.config.safety.allowOutsideWorkspace);
        const maxResults = Number(args.max_results || 200);
        const files = [];
        await walk(start, root, files, maxResults);
        return { files, truncated: files.length >= maxResults };
      }
    },
    {
      name: "read_file",
      source: "local",
      description: "Read a UTF-8 text file from the local workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          max_bytes: { type: "integer", description: "Maximum bytes to return." }
        },
        required: ["path"],
        additionalProperties: false
      },
      async handler(args, context) {
        const file = resolveWorkspacePath(
          context.config.safety.workspaceRoot,
          args.path,
          context.config.safety.allowOutsideWorkspace
        );
        const maxBytes = Number(args.max_bytes || context.config.safety.maxOutputBytes);
        const text = await readFile(file, "utf8");
        return {
          path: args.path,
          bytes: Buffer.byteLength(text),
          content: truncateText(text, maxBytes)
        };
      }
    },
    {
      name: "write_file",
      source: "local",
      description: "Write a UTF-8 text file in the local workspace after user approval by default.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "Full file content to write." },
          reason: { type: "string", description: "Brief reason this write is needed." }
        },
        required: ["path", "content"],
        additionalProperties: false
      },
      async handler(args, context) {
        const file = resolveWorkspacePath(
          context.config.safety.workspaceRoot,
          args.path,
          context.config.safety.allowOutsideWorkspace
        );

        if (!context.config.safety.autoApproveWrites) {
          const approved = await context.approvals.confirm(
            [
              "AMOS Agent wants to write a file:",
              "",
              args.path,
              "",
              args.reason ? `reason: ${args.reason}` : ""
            ]
              .filter(Boolean)
              .join("\n")
          );
          if (!approved) return { ok: false, denied: true, message: "User denied file write." };
        }

        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, String(args.content), "utf8");
        return {
          ok: true,
          path: args.path,
          bytes: Buffer.byteLength(String(args.content))
        };
      }
    }
  ];
}

async function walk(dir, root, files, maxResults) {
  if (files.length >= maxResults) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= maxResults) return;
    if (DEFAULT_IGNORES.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(full, root, files, maxResults);
    } else if (entry.isFile()) {
      const info = await stat(full);
      files.push({
        path: relative(root, full),
        bytes: info.size
      });
    }
  }
}
