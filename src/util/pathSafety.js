import { isAbsolute, resolve, relative, sep } from "node:path";

export function resolveWorkspacePath(workspaceRoot, target = ".", allowOutside = false) {
  const resolvedRoot = resolve(workspaceRoot);
  const resolvedTarget = resolve(resolvedRoot, target);

  if (allowOutside) return resolvedTarget;

  const rel = relative(resolvedRoot, resolvedTarget);
  const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));

  if (!inside) {
    throw new Error(`Path escapes workspace: ${target}`);
  }

  return resolvedTarget;
}

export function truncateText(text, maxBytes) {
  const buffer = Buffer.from(String(text));
  if (buffer.length <= maxBytes) return String(text);
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n...[truncated ${buffer.length - maxBytes} bytes]`;
}
