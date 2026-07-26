import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markdownLink = /\[[^\]]+\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return extname(entry.name).toLowerCase() === ".md" ? [path] : [];
  });
}

test("local documentation links resolve to repository files", () => {
  const files = [
    join(root, "README.md"),
    join(root, "SECURITY.md"),
    join(root, "CONTRIBUTING.md"),
    ...markdownFiles(join(root, "docs"))
  ];
  const missing = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(markdownLink)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      const path = decodeURIComponent(target.split("#", 1)[0]);
      if (!path) continue;
      const resolved = resolve(dirname(file), path);
      if (!resolved.startsWith(`${root}/`) || !existsSync(resolved)) {
        missing.push(`${file.slice(root.length + 1)} -> ${target}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
