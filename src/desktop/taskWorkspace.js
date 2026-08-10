import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const defaultExecFile = promisify(execFileCallback);

export async function inspectTaskWorkspace(localPath, { execFile = defaultExecFile } = {}) {
  const requested = resolveRequiredPath(localPath);
  const root = await git(execFile, ["-C", requested, "rev-parse", "--show-toplevel"]);
  const repositoryRoot = await realpath(root);
  const [branch, commit, status, repository] = await Promise.all([
    git(execFile, ["-C", repositoryRoot, "branch", "--show-current"]),
    git(execFile, ["-C", repositoryRoot, "rev-parse", "HEAD"]),
    git(execFile, ["-C", repositoryRoot, "status", "--porcelain=v1"]),
    optionalGit(execFile, ["-C", repositoryRoot, "remote", "get-url", "origin"])
  ]);
  return {
    localPath: repositoryRoot,
    label: basename(repositoryRoot),
    repository,
    branch: branch || "detached",
    commit,
    dirty: Boolean(status)
  };
}

/**
 * Creates a sibling Git worktree at the current commit. Uncommitted parent
 * changes are never copied, cleaned, stashed, reset, or discarded.
 */
export async function createTaskWorktree(
  localPath,
  { name = "task", id = "", execFile = defaultExecFile } = {}
) {
  const parent = await inspectTaskWorkspace(localPath, { execFile });
  const suffix = safeSlug(id).slice(-8) || Math.random().toString(36).slice(2, 10);
  const slug = safeSlug(name).slice(0, 40) || "task";
  const container = join(dirname(parent.localPath), ".amos-worktrees");
  const target = join(container, `${basename(parent.localPath)}-${slug}-${suffix}`);
  const branch = `amos/fork-${slug}-${suffix}`.slice(0, 120);
  await assertMissing(target);
  await mkdir(container, { recursive: true, mode: 0o700 });
  await git(execFile, [
    "-C",
    parent.localPath,
    "worktree",
    "add",
    "-b",
    branch,
    target,
    parent.commit
  ]);
  const created = await inspectTaskWorkspace(target, { execFile });
  return {
    ...created,
    branch,
    parent: {
      localPath: parent.localPath,
      branch: parent.branch,
      commit: parent.commit,
      dirty: parent.dirty
    },
    warning: parent.dirty
      ? "Uncommitted changes remain only in the parent workspace and were not copied."
      : "The worktree starts from the parent workspace's current commit."
  };
}

export function portableTaskWorkspace(workspace = {}) {
  return {
    label: cleanText(workspace.label, 160),
    repository: portableRepository(workspace.repository),
    branch: cleanText(workspace.branch, 300),
    commit: /^[a-f0-9]{7,64}$/i.test(String(workspace.commit || ""))
      ? String(workspace.commit)
      : "",
    dirty: workspace.dirty === true
  };
}

async function git(execFile, args) {
  try {
    const result = await execFile("git", args, {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    return String(result?.stdout || "").trim();
  } catch (error) {
    const detail = cleanText(error?.stderr || error?.message, 800);
    throw new Error(`Could not prepare the AMOS task workspace${detail ? `: ${detail}` : ""}`);
  }
}

async function optionalGit(execFile, args) {
  try {
    return await git(execFile, args);
  } catch {
    return "";
  }
}

async function assertMissing(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("The AMOS task worktree destination already exists");
}

function resolveRequiredPath(value) {
  const text = cleanText(value, 4_096);
  if (!text) throw new Error("Choose a local Git workspace before creating a worktree");
  return resolve(text);
}

function safeSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function portableRepository(value) {
  const raw = cleanText(value, 500);
  if (!raw || raw.startsWith("/") || raw.startsWith("\\\\") || /^[a-z]:[\\/]/i.test(raw)) {
    return "";
  }
  if (raw.includes("://")) {
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:", "ssh:"].includes(parsed.protocol) || !parsed.hostname) return "";
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(raw)) return raw;
  return /^[A-Za-z0-9._/-]+$/.test(raw) ? raw : "";
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}
