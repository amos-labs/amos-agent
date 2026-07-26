import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { spawn } from "node:child_process";
import { assertSafeAgentPath, resolveWorkspacePath, truncateText } from "../util/pathSafety.js";
import { safeChildEnvironment } from "./bash.js";

const IGNORED = new Set([".git", "node_modules", "dist", "coverage", ".amos-agent", ".next", "target", "vendor"]);

export function createCodingTools() {
  return [
    {
      name: "search_files",
      source: "local",
      description: "Search text across the local workspace and return matching files, line numbers, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Literal text to find." },
          path: { type: "string", description: "Workspace-relative directory or file. Defaults to ." },
          case_sensitive: { type: "boolean", description: "Default false." },
          max_results: { type: "integer", description: "Default 100, maximum 500." }
        },
        required: ["query"],
        additionalProperties: false
      },
      async handler(args, context) {
        const query = String(args.query || "");
        if (!query) throw new Error("query is required");
        const root = context.config.safety.workspaceRoot;
        const canonicalRoot = resolveWorkspacePath(root, ".", context.config.safety.allowOutsideWorkspace);
        const start = resolveWorkspacePath(root, args.path || ".", context.config.safety.allowOutsideWorkspace);
        const maxResults = boundedNumber(args.max_results, 100, 1, 500);
        const matches = [];
        const budget = { files: 0, maxFiles: 2_000 };
        await searchPath(start, canonicalRoot, query, Boolean(args.case_sensitive), matches, maxResults, budget);
        return {
          query,
          matches,
          scanned_files: budget.files,
          truncated: matches.length >= maxResults || budget.files >= budget.maxFiles
        };
      }
    },
    {
      name: "git_status",
      source: "local",
      description: "Inspect the current workspace's branch and changed files without modifying anything.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async handler(_args, context) {
        return runProgram("git", ["status", "--short", "--branch"], {
          cwd: context.config.safety.workspaceRoot,
          timeoutMs: 15_000,
          maxOutputBytes: context.config.safety.maxOutputBytes
        });
      }
    },
    {
      name: "git_diff",
      source: "local",
      description: "Inspect the current workspace diff. Optionally limit it to safe workspace-relative paths.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Show staged changes instead of unstaged changes." },
          paths: { type: "array", items: { type: "string" }, description: "Optional workspace-relative paths." }
        },
        additionalProperties: false
      },
      async handler(args, context) {
        const root = context.config.safety.workspaceRoot;
        const canonicalRoot = resolveWorkspacePath(root, ".", context.config.safety.allowOutsideWorkspace);
        const paths = (args.paths || []).map((path) => {
          const resolved = resolveWorkspacePath(root, path, context.config.safety.allowOutsideWorkspace);
          assertSafeAgentPath(resolved, root);
          return relative(canonicalRoot, resolved) || ".";
        });
        const command = ["diff"];
        if (args.staged) command.push("--cached");
        if (paths.length > 0) command.push("--", ...paths);
        return runProgram("git", command, {
          cwd: root,
          timeoutMs: 15_000,
          maxOutputBytes: context.config.safety.maxOutputBytes
        });
      }
    },
    {
      name: "apply_patch",
      source: "local",
      description: "Apply a unified text patch atomically inside the local workspace after user approval.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string", description: "Unified diff using a/ and b/ workspace-relative paths." },
          reason: { type: "string", description: "Brief reason for the change." }
        },
        required: ["patch"],
        additionalProperties: false
      },
      async handler(args, context) {
        const patch = String(args.patch || "");
        if (!patch.trim()) throw new Error("patch is required");
        if (Buffer.byteLength(patch) > 512_000) throw new Error("Patch exceeds the 512 KB limit");
        if (patch.includes("GIT binary patch")) throw new Error("Binary patches are not supported");

        const root = context.config.safety.workspaceRoot;
        const paths = parsePatchPaths(patch);
        if (paths.length === 0) throw new Error("Patch did not contain any file paths");
        for (const path of paths) {
          const resolved = resolveWorkspacePath(root, path, context.config.safety.allowOutsideWorkspace);
          assertSafeAgentPath(resolved, root);
        }

        const checked = await runProgram("git", ["apply", "--check", "--recount", "--whitespace=nowarn", "-"], {
          cwd: root,
          input: patch,
          timeoutMs: 20_000,
          maxOutputBytes: context.config.safety.maxOutputBytes
        });
        if (!checked.ok) return { ...checked, phase: "check", files: paths };

        if (!context.config.safety.autoApproveWrites) {
          const approved = await context.approvals.confirm(
            [
              "AMOS wants to apply a local code patch:",
              "",
              ...paths.map((path) => `• ${path}`),
              args.reason ? `\nreason: ${args.reason}` : "",
              `\n${truncateText(patch, 8_000)}`
            ].join("\n")
          );
          if (!approved) return { ok: false, denied: true, message: "User denied code patch.", files: paths };
        }

        const applied = await runProgram("git", ["apply", "--recount", "--whitespace=nowarn", "-"], {
          cwd: root,
          input: patch,
          timeoutMs: 20_000,
          maxOutputBytes: context.config.safety.maxOutputBytes
        });
        return { ...applied, phase: "apply", files: paths };
      }
    }
  ];
}

export function parsePatchPaths(patch) {
  const paths = new Set();
  for (const line of String(patch).split(/\r?\n/)) {
    const match = /^(?:---|\+\+\+) ([^\t]+)(?:\t.*)?$/.exec(line);
    if (!match || match[1] === "/dev/null") continue;
    let value = match[1];
    if (value.startsWith("\"") || value.includes("\\\"")) {
      throw new Error("Quoted patch paths are not supported");
    }
    value = value.replace(/^[ab]\//, "");
    if (!value || value.startsWith("/") || value.split("/").includes("..")) {
      throw new Error(`Unsafe patch path: ${value}`);
    }
    paths.add(value);
  }
  return [...paths];
}

async function searchPath(start, root, query, caseSensitive, matches, maxResults, budget) {
  if (matches.length >= maxResults || budget.files >= budget.maxFiles) return;
  const info = await stat(start);
  if (info.isFile()) {
    budget.files += 1;
    await searchFile(start, root, query, caseSensitive, matches, maxResults);
    return;
  }
  const entries = await readdir(start, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= maxResults || budget.files >= budget.maxFiles) return;
    if (IGNORED.has(entry.name) || entry.name === ".env" || entry.name.startsWith(".env.")) continue;
    const path = `${start}/${entry.name}`;
    if (entry.isDirectory()) await searchPath(path, root, query, caseSensitive, matches, maxResults, budget);
    else if (entry.isFile()) {
      budget.files += 1;
      await searchFile(path, root, query, caseSensitive, matches, maxResults);
    }
  }
}

async function searchFile(path, root, query, caseSensitive, matches, maxResults) {
  const info = await stat(path);
  if (info.size > 2_000_000) return;
  const buffer = await readFile(path);
  if (buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)) return;
  const needle = caseSensitive ? query : query.toLowerCase();
  const lines = buffer.toString("utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
    const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
    if (!haystack.includes(needle)) continue;
    matches.push({
      path: relative(root, path),
      line: index + 1,
      text: lines[index].slice(0, 500)
    });
  }
}

function runProgram(command, args, { cwd, input = "", timeoutMs, maxOutputBytes }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: safeChildEnvironment(process.env),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;
    const limit = boundedNumber(maxOutputBytes, 24_000, 1_024, 1_048_576);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, boundedNumber(timeoutMs, 15_000, 100, 600_000));

    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]).subarray(0, limit);
    });
    child.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, Buffer.from(chunk)]).subarray(0, limit);
    });
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("close", (code, signal) => finish({
      ok: code === 0 && !timedOut,
      exit_code: code,
      signal,
      timed_out: timedOut,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8")
    }));
    child.stdin.end(input);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }
  });
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), min), max);
}
