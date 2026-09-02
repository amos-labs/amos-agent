import { mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { assertSafeAgentPath } from "../util/pathSafety.js";
import { resolveDefaultWorkspacePath } from "../util/workspaceFocus.js";
import { boundedNumber } from "../util/validate.js";

const DEFAULT_IGNORES = new Set([".git", "node_modules", "dist", "coverage", ".amos-agent", ".ssh", ".aws", ".gnupg"]);

function ignoredName(name) {
  const lower = name.toLowerCase();
  return DEFAULT_IGNORES.has(name) || lower === ".env" || lower.startsWith(".env.");
}

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
        const start = resolveDefaultWorkspacePath(context.config.safety, args.path || ".", context.config.safety.allowOutsideWorkspace);
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
        const file = resolveDefaultWorkspacePath(
          context.config.safety,
          args.path,
          context.config.safety.allowOutsideWorkspace
        );
        assertSafeAgentPath(file, context.config.safety.workspaceRoot);
        const maxBytes = boundedNumber(args.max_bytes, context.config.safety.maxOutputBytes, 1, context.config.safety.maxOutputBytes);
        const { text, totalBytes } = await readTextFileBounded(file, maxBytes);
        return {
          path: args.path,
          bytes: totalBytes,
          content: text
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
        const file = resolveDefaultWorkspacePath(
          context.config.safety,
          args.path,
          context.config.safety.allowOutsideWorkspace
        );
        assertSafeAgentPath(file, context.config.safety.workspaceRoot);

        if (
          !context.config.safety.autoApproveWrites &&
          !context.config.safety.autoApproveKinds?.includes("file-write")
        ) {
          const approved = await context.approvals.confirm(
            [
              "AMOS Agent wants to write a file:",
              "",
              args.path,
              "",
              args.reason ? `reason: ${args.reason}` : ""
            ]
              .filter(Boolean)
              .join("\n"),
            { kind: "file-write" }
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

async function readTextFileBounded(file, maxBytes) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    const buffer = Buffer.alloc(Math.min(maxBytes, info.size));
    const { bytesRead } = buffer.length > 0 ? await handle.read(buffer, 0, buffer.length, 0) : { bytesRead: 0 };
    const value = buffer.subarray(0, bytesRead).toString("utf8");
    return {
      totalBytes: info.size,
      text: info.size > bytesRead ? `${value}\n...[truncated ${info.size - bytesRead} bytes]` : value
    };
  } finally {
    await handle.close();
  }
}

async function walk(dir, root, files, maxResults) {
  if (files.length >= maxResults) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= maxResults) return;
    if (ignoredName(entry.name)) continue;
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
