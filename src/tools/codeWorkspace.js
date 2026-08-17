import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { assertSafeAgentPath, resolveWorkspacePath } from "../util/pathSafety.js";
import { workspaceFocusPath } from "../util/workspaceFocus.js";
import { runProgram } from "./coding.js";

const IGNORED = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".amos-agent",
  ".next",
  "target",
  "vendor"
]);
const MAX_TREE_NODES = 600;
const MAX_TREE_DEPTH = 8;
const MAX_DIFF_LINES = 4_000;
const MAX_FOCUS_BYTES = 200_000;

export function createCodeWorkspaceTool({ present }) {
  if (typeof present !== "function") {
    throw new Error("Code workspace tool requires a present handler");
  }
  return {
    name: "desktop_present_code_workspace",
    source: "desktop",
    description:
      "Present the selected local workspace as a deterministic coding surface with its file tree, Git changes, line-numbered diffs, and an optional focused source file. Use after code changes or when the user asks to inspect code visually. Desktop reads Git and the filesystem directly; never copy model-authored diff content into this tool.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: {
          type: "string",
          enum: ["working", "staged", "all"],
          description: "Which Git changes to show. Defaults to all."
        },
        paths: {
          type: "array",
          maxItems: 20,
          items: { type: "string" },
          description: "Optional safe workspace-relative paths used only to narrow the diff."
        },
        focus_path: {
          type: "string",
          description: "Optional safe workspace-relative text file to display beside the tree and diff."
        }
      }
    },
    async handler(args, context) {
      const root = workspaceFocusPath(context.config.safety);
      const canonicalRoot = resolveWorkspacePath(root, ".", false);
      const scope = ["working", "staged", "all"].includes(args.scope)
        ? args.scope
        : "all";
      const paths = normalizeRequestedPaths(args.paths, canonicalRoot);
      const outputLimit = Number(context.config.safety.maxOutputBytes) || 24_000;
      const runOptions = {
        cwd: canonicalRoot,
        timeoutMs: 20_000,
        maxOutputBytes: outputLimit,
        signal: context.signal
      };
      const [branchResult, statusResult] = await Promise.all([
        runProgram("git", ["branch", "--show-current"], runOptions),
        runProgram(
          "git",
          ["-c", "core.quotePath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
          runOptions
        )
      ]);
      const repository = branchResult.ok || statusResult.ok;
      const branch = branchResult.ok ? branchResult.stdout.trim() || "detached HEAD" : "Not a Git repository";
      const statuses = statusResult.ok ? parseGitStatus(statusResult.stdout) : new Map();
      const tree = await buildFileTree(canonicalRoot, statuses);
      const diffGroups = repository
        ? await collectDiffGroups({
            root: canonicalRoot,
            scope,
            paths,
            statuses,
            runOptions,
            outputLimit
          })
        : [];
      const focus = args.focus_path
        ? await focusedCodeBlock(args.focus_path, canonicalRoot)
        : null;
      const files = diffGroups.flatMap((group) => group.files);
      const additions = files.reduce((total, file) => total + file.additions, 0);
      const deletions = files.reduce((total, file) => total + file.deletions, 0);
      const now = new Date().toISOString();
      const source = {
        kind: "local",
        label: basename(canonicalRoot),
        refreshed_at: now,
        references: [{
          type: "workspace",
          id: branch,
          label: `${basename(canonicalRoot)} · ${branch}`,
          observed_at: now
        }]
      };
      const blocks = [
        {
          id: "code-branch",
          type: "metric",
          label: "Branch",
          value: branch,
          trend: "neutral"
        },
        {
          id: "code-files-changed",
          type: "metric",
          label: "Changed files",
          value: statuses.size,
          trend: statuses.size > 0 ? "up" : "neutral"
        },
        {
          id: "code-lines-changed",
          type: "metric",
          label: "Visible line changes",
          value: `${additions}+ / ${deletions}−`,
          trend: "neutral",
          note: diffGroups.some((group) => group.truncated)
            ? "The rendered diff reached the configured output limit."
            : null
        },
        {
          id: "code-file-tree",
          type: "file_tree",
          title: "Files",
          root_label: basename(canonicalRoot),
          nodes: tree.nodes,
          truncated: tree.truncated
        },
        ...diffGroups.map((group) => ({
          id: `code-diff-${group.scope}`,
          type: "diff",
          title: group.scope === "staged" ? "Staged changes" : "Working changes",
          scope: group.scope,
          files: group.files,
          truncated: group.truncated
        }))
      ];
      if (focus) blocks.push(focus);
      if (diffGroups.length === 0) {
        blocks.push({
          id: "code-no-diff",
          type: "markdown",
          title: "Changes",
          content: repository
            ? "No matching Git changes are present in this workspace."
            : "This workspace is not currently a Git repository, so only its bounded file tree is shown."
        });
      }
      const canvas = await present({
        version: "1",
        title: `${basename(canonicalRoot)} · Coding workspace`,
        subtitle: repository
          ? `${branch} · deterministic local Git and filesystem view`
          : "Deterministic local filesystem view",
        generated_at: now,
        state: "ready",
        source,
        blocks
      });
      return {
        ok: true,
        canvas_id: canvas.id,
        title: canvas.title,
        workspace: canonicalRoot,
        branch: repository ? branch : null,
        changed_files: statuses.size,
        additions,
        deletions,
        tree_nodes: tree.nodes.length,
        truncated: tree.truncated || diffGroups.some((group) => group.truncated)
      };
    }
  };
}

function normalizeRequestedPaths(input, root) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).map((value) => {
    const resolved = resolveWorkspacePath(root, String(value || "."), false);
    assertSafeAgentPath(resolved, root);
    return toProjectPath(relative(root, resolved) || ".");
  });
}

function parseGitStatus(output) {
  const fields = String(output || "").split("\0");
  const statuses = new Map();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field || field.length < 4) continue;
    const code = field.slice(0, 2);
    const path = toProjectPath(field.slice(3));
    let oldPath = null;
    if (code.includes("R") || code.includes("C")) {
      oldPath = toProjectPath(fields[index + 1] || "");
      index += 1;
    }
    if (isIgnoredProjectPath(path) || (oldPath && isIgnoredProjectPath(oldPath))) continue;
    statuses.set(path, { code, status: gitStatusKind(code), oldPath });
  }
  return statuses;
}

function gitStatusKind(code) {
  if (code === "??") return "untracked";
  if (code === "UU" || code.includes("U") || code === "AA" || code === "DD") return "conflicted";
  if (code.includes("R") || code.includes("C")) return "renamed";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  return "modified";
}

async function buildFileTree(root, statuses) {
  const state = { nodes: [], truncated: false, seen: new Set() };
  await visitDirectory(root, root, 0, statuses, state);
  for (const [path, status] of statuses) {
    if (state.nodes.length >= MAX_TREE_NODES) {
      state.truncated = true;
      break;
    }
    if (state.seen.has(path)) continue;
    state.nodes.push({
      path,
      name: basename(path),
      kind: "file",
      depth: Math.min(MAX_TREE_DEPTH, path.split("/").length - 1),
      status: status.status
    });
  }
  return state;
}

async function visitDirectory(directory, root, depth, statuses, state) {
  if (state.nodes.length >= MAX_TREE_NODES) {
    state.truncated = true;
    return;
  }
  if (depth > MAX_TREE_DEPTH) {
    state.truncated = true;
    return;
  }
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const entry of entries) {
    if (state.nodes.length >= MAX_TREE_NODES) {
      state.truncated = true;
      return;
    }
    if (isIgnoredName(entry.name)) continue;
    const absolute = join(directory, entry.name);
    const projectPath = toProjectPath(relative(root, absolute));
    if (entry.isDirectory()) {
      state.nodes.push({
        path: projectPath,
        name: entry.name,
        kind: "directory",
        depth,
        status: directoryStatus(projectPath, statuses)
      });
      state.seen.add(projectPath);
      await visitDirectory(absolute, root, depth + 1, statuses, state);
    } else if (entry.isFile()) {
      state.nodes.push({
        path: projectPath,
        name: entry.name,
        kind: "file",
        depth,
        status: statuses.get(projectPath)?.status || "none"
      });
      state.seen.add(projectPath);
    }
  }
}

function isIgnoredName(name) {
  return IGNORED.has(name) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /(?:credential|secret|private[-_.]?key)/i.test(name);
}

function isIgnoredProjectPath(path) {
  return toProjectPath(path).split("/").some(isIgnoredName);
}

function directoryStatus(path, statuses) {
  const matching = [...statuses.entries()]
    .filter(([candidate]) => candidate.startsWith(`${path}/`))
    .map(([, value]) => value.status);
  if (matching.length === 0) return "none";
  for (const status of ["conflicted", "deleted", "added", "renamed", "modified", "untracked"]) {
    if (matching.includes(status)) return status;
  }
  return "modified";
}

async function collectDiffGroups({ root, scope, paths, statuses, runOptions, outputLimit }) {
  const requested = scope === "all" ? ["staged", "working"] : [scope];
  const groups = [];
  for (const kind of requested) {
    const base = ["-c", "core.quotePath=false", "diff"];
    if (kind === "staged") base.push("--cached");
    const pathArgs = paths.length > 0 ? ["--", ...paths] : [];
    const [names, diff] = await Promise.all([
      runProgram("git", [...base, "--name-only", "-z", ...pathArgs], runOptions),
      runProgram("git", [...base, "--no-ext-diff", "--no-color", "--unified=3", ...pathArgs], runOptions)
    ]);
    if (!diff.ok) continue;
    const orderedPaths = names.ok
      ? names.stdout.split("\0").map(toProjectPath).filter(Boolean)
      : [];
    const parsed = parseUnifiedDiff(diff.stdout, orderedPaths, statuses);
    if (kind === "working") {
      const untracked = await collectUntrackedFiles(root, statuses, paths, parsed.lineCount);
      parsed.files.push(...untracked.files);
      parsed.lineCount += untracked.lineCount;
      parsed.truncated ||= untracked.truncated;
    }
    if (parsed.files.length === 0) continue;
    groups.push({
      scope: kind,
      files: parsed.files,
      truncated: parsed.truncated || Buffer.byteLength(diff.stdout) >= outputLimit
    });
  }
  return groups;
}

function parseUnifiedDiff(output, orderedPaths, statuses) {
  const files = [];
  let current = null;
  let hunk = null;
  let oldLine = null;
  let newLine = null;
  let fileIndex = 0;
  let lineCount = 0;
  let truncated = false;
  const finish = () => {
    if (!current) return;
    if (!current.path) current.path = orderedPaths[fileIndex] || "unknown";
    const status = statuses.get(current.path);
    current.status = current.status === "binary" ? "binary" : status?.status || current.status;
    current.old_path ||= status?.oldPath || null;
    if (!isIgnoredProjectPath(current.path) && !isIgnoredProjectPath(current.old_path || "")) {
      files.push(current);
    }
    current = null;
    hunk = null;
    fileIndex += 1;
  };
  const rawLines = String(output || "").split(/\r?\n/);
  if (rawLines.at(-1) === "") rawLines.pop();
  for (const rawLine of rawLines) {
    if (rawLine.startsWith("diff --git ")) {
      finish();
      const path = orderedPaths[fileIndex] || "";
      current = {
        path,
        old_path: null,
        status: statuses.get(path)?.status || "modified",
        additions: 0,
        deletions: 0,
        hunks: []
      };
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("rename from ")) {
      current.old_path = toProjectPath(rawLine.slice("rename from ".length));
      current.status = "renamed";
      continue;
    }
    if (rawLine.startsWith("rename to ")) {
      current.path = toProjectPath(rawLine.slice("rename to ".length));
      continue;
    }
    if (rawLine.startsWith("Binary files ") || rawLine === "GIT binary patch") {
      current.status = "binary";
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(rawLine);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = { header: rawLine, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (lineCount >= MAX_DIFF_LINES) {
      truncated = true;
      continue;
    }
    const prefix = rawLine[0];
    let kind = "meta";
    let lineOld = null;
    let lineNew = null;
    if (prefix === "+") {
      kind = "addition";
      lineNew = newLine;
      newLine += 1;
      current.additions += 1;
    } else if (prefix === "-") {
      kind = "deletion";
      lineOld = oldLine;
      oldLine += 1;
      current.deletions += 1;
    } else if (prefix === " ") {
      kind = "context";
      lineOld = oldLine;
      lineNew = newLine;
      oldLine += 1;
      newLine += 1;
    }
    hunk.lines.push({
      kind,
      old_line: lineOld,
      new_line: lineNew,
      text: kind === "meta" ? rawLine : rawLine.slice(1)
    });
    lineCount += 1;
  }
  finish();
  return { files, lineCount, truncated };
}

async function collectUntrackedFiles(root, statuses, paths, usedLines) {
  const files = [];
  let lineCount = 0;
  let truncated = false;
  const candidates = [...statuses.entries()]
    .filter(([, value]) => value.status === "untracked")
    .map(([path]) => path)
    .filter((path) => matchesRequestedPath(path, paths));
  for (const path of candidates) {
    if (usedLines + lineCount >= MAX_DIFF_LINES) {
      truncated = true;
      break;
    }
    const absolute = resolveWorkspacePath(root, path, false);
    assertSafeAgentPath(absolute, root);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile() || info.size > MAX_FOCUS_BYTES) {
      truncated ||= Boolean(info?.isFile());
      continue;
    }
    const buffer = await readFile(absolute);
    if (buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)) {
      files.push({
        path,
        old_path: null,
        status: "binary",
        additions: 0,
        deletions: 0,
        hunks: []
      });
      continue;
    }
    const sourceLines = buffer.toString("utf8").split(/\r?\n/);
    if (sourceLines.at(-1) === "") sourceLines.pop();
    const available = Math.max(0, MAX_DIFF_LINES - usedLines - lineCount);
    const visible = sourceLines.slice(0, available);
    files.push({
      path,
      old_path: null,
      status: "untracked",
      additions: sourceLines.length,
      deletions: 0,
      hunks: visible.length > 0 ? [{
        header: `@@ -0,0 +1,${sourceLines.length} @@`,
        lines: visible.map((text, index) => ({
          kind: "addition",
          old_line: null,
          new_line: index + 1,
          text
        }))
      }] : []
    });
    lineCount += visible.length;
    truncated ||= visible.length < sourceLines.length;
  }
  return { files, lineCount, truncated };
}

function matchesRequestedPath(path, requested) {
  if (requested.length === 0 || requested.includes(".")) return true;
  return requested.some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

async function focusedCodeBlock(requestedPath, root) {
  const absolute = resolveWorkspacePath(root, requestedPath, false);
  assertSafeAgentPath(absolute, root);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error("focus_path must name a regular workspace file");
  if (info.size > MAX_FOCUS_BYTES) throw new Error("focus_path exceeds the 200 KB display limit");
  const buffer = await readFile(absolute);
  if (buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)) {
    throw new Error("focus_path must be a text file");
  }
  const path = toProjectPath(relative(root, absolute));
  const content = buffer.toString("utf8");
  return {
    id: "code-focused-file",
    type: "code",
    title: `Focused file · ${path}`,
    filename: path,
    language: languageForPath(path),
    start_line: 1,
    content: content.slice(0, 50_000)
  };
}

function languageForPath(path) {
  return ({
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "jsx",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".swift": "swift",
    ".css": "css",
    ".html": "html",
    ".md": "markdown",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml"
  })[extname(path).toLowerCase()] || "text";
}

function toProjectPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}
