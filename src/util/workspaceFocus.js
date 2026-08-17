import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { resolveWorkspacePath } from "./pathSafety.js";

export function workspaceFocusPath(safety = {}) {
  const focus = String(safety?.workspaceFocus || "").trim();
  const root = String(safety?.workspaceRoot || "").trim();
  return focus || root;
}

export function resolveDefaultWorkspacePath(safety = {}, target = ".", allowOutside = false) {
  const root = safety.workspaceRoot;
  const focus = workspaceFocusPath(safety);
  const requested = String(target || ".").trim() || ".";
  if (requested === ".") {
    return resolveWorkspacePath(root, relativeToRoot(root, focus) || ".", allowOutside);
  }
  if (!hasDistinctFocus(root, focus) || preferGrantRelative(root, requested)) {
    return resolveWorkspacePath(root, requested, allowOutside);
  }
  const focusRel = relativeToRoot(root, focus);
  const fromFocus = focusRel && focusRel !== "." ? join(focusRel, requested) : requested;
  return resolveWorkspacePath(root, fromFocus, allowOutside);
}

export function createWorkspaceFocusTool({ persist } = {}) {
  return {
    name: "desktop_focus_workspace",
    source: "desktop",
    description:
      "Bind the active work item inside the current workspace grant. Default local reads, writes, Git, and shell start here. This does not replace or widen the workspace grant.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative folder to focus. Use . to return to the grant root."
        }
      },
      required: ["path"]
    },
    async handler(args, context) {
      const root = context.config.safety.workspaceRoot;
      const requested = String(args.path || ".").trim() || ".";
      const focused = resolveWorkspacePath(
        root,
        requested,
        context.config.safety.allowOutsideWorkspace
      );
      if (!isDirectory(focused)) {
        throw new Error("Workspace focus must be an existing folder inside the grant");
      }
      context.config.safety.workspaceFocus = focused;
      const result = {
        ok: true,
        grant: root,
        focus: focused,
        path: toPosix(relativeToRoot(root, focused) || ".")
      };
      if (typeof persist === "function") {
        await persist(result);
      }
      return result;
    }
  };
}

export function workspaceCommandCwd(safety = {}, paths = []) {
  const root = safety.workspaceRoot;
  const focus = workspaceFocusPath(safety);
  const requested = (Array.isArray(paths) ? paths : []).filter(Boolean);
  if (requested.length === 0) return focus;
  const gitRoots = [...new Set(requested.map((path) => {
    const resolved = resolveDefaultWorkspacePath(safety, path, Boolean(safety.allowOutsideWorkspace));
    return findGitRoot(resolved, root);
  }).filter(Boolean))];
  if (gitRoots.length === 1) return gitRoots[0];
  return isGitRepo(root) ? root : focus;
}

export function findGitRoot(target, stopAt = "") {
  let current = resolve(String(target || ""));
  const stop = resolve(String(stopAt || current));
  while (true) {
    if (isGitRepo(current)) return current;
    if (current === stop) return "";
    const parent = dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

export function isGitRepo(path) {
  return existsSync(join(String(path || ""), ".git"));
}

export function rewritePatchForGitCwd(patch, grantRoot, gitCwd) {
  const prefix = toPosix(relativeToRoot(grantRoot, gitCwd));
  if (!prefix || prefix === ".") return String(patch || "");
  const token = `${prefix}/`;
  return String(patch || "").split(/\r?\n/).map((line) => {
    const match = /^(---|\+\+\+) ([^\t]+)(.*)$/.exec(line);
    if (!match || match[2] === "/dev/null") return line;
    const value = match[2];
    const marked = /^(a|b)\//.test(value);
    const head = marked ? value.slice(0, 2) : "";
    const rest = marked ? value.slice(2) : value;
    if (rest === prefix || rest.startsWith(token)) {
      const next = rest === prefix ? "" : rest.slice(token.length);
      return `${match[1]} ${head}${next}${match[3]}`;
    }
    return line;
  }).join("\n");
}

export function workspaceFocusLabel(path) {
  return basename(String(path || "").trim()) || "";
}

export function canonicalWorkspaceFocus(root, focus) {
  if (!root) return "";
  if (!focus) return resolve(root);
  try {
    return realpathSync(resolve(focus));
  } catch {
    return resolve(focus);
  }
}

export function relativeWorkspacePath(root, target) {
  return toPosix(relativeToRoot(root, target) || ".");
}

function hasDistinctFocus(root, focus) {
  if (!root || !focus) return false;
  return resolve(root) !== resolve(focus);
}

function preferGrantRelative(root, requested) {
  const first = requested.split(/[\\/]/).find(Boolean);
  if (!first || first === ".") return false;
  if (first === "..") return true;
  return existsSync(resolve(root, first));
}

function canonicalPath(value) {
  const resolved = resolve(String(value || ""));
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function relativeToRoot(root, target) {
  if (!root || !target) return ".";
  const rel = relative(canonicalPath(root), canonicalPath(target));
  if (!rel || rel === ".") return ".";
  return rel;
}

function toPosix(value) {
  return String(value || ".").split(sep).join("/");
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
