import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function resolveWorkspacePath(workspaceRoot, target = ".", allowOutside = false) {
  const resolvedRoot = resolve(workspaceRoot);
  const resolvedTarget = resolve(resolvedRoot, target);

  if (allowOutside) return resolvedTarget;

  if (!isInside(resolvedRoot, resolvedTarget)) {
    throw new Error(`Path escapes workspace: ${target}`);
  }

  const canonicalRoot = realpathSync(resolvedRoot);
  const canonicalTarget = canonicalizePotentialPath(resolvedTarget);
  if (!isInside(canonicalRoot, canonicalTarget)) {
    throw new Error(`Path escapes workspace through a symlink: ${target}`);
  }

  return canonicalTarget;
}

export function assertSafeAgentPath(filePath, workspaceRoot) {
  const rel = relative(realpathSync(resolve(workspaceRoot)), filePath);
  const segments = rel.split(sep);
  const name = basename(filePath).toLowerCase();
  const secretDirectory = segments.some((segment) => [".ssh", ".aws", ".gnupg"].includes(segment.toLowerCase()));
  const secretFile =
    name === ".env" ||
    name.startsWith(".env.") ||
    [".npmrc", ".netrc", ".git-credentials"].includes(name) ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    /^id_(rsa|dsa|ecdsa|ed25519)$/.test(name);
  if (secretDirectory || secretFile) {
    throw new Error(`Sensitive credential path is not available to agent file tools: ${rel}`);
  }
}

function canonicalizePotentialPath(filePath) {
  let current = filePath;
  const missing = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error(`No existing parent for path: ${filePath}`);
    missing.unshift(basename(current));
    current = parent;
  }
  return resolve(realpathSync(current), ...missing);
}

function isInside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function truncateText(text, maxBytes) {
  const buffer = Buffer.from(String(text));
  if (buffer.length <= maxBytes) return String(text);
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n...[truncated ${buffer.length - maxBytes} bytes]`;
}
