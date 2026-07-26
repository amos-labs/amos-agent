import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingTools, parsePatchPaths } from "../src/tools/coding.js";

test("patch paths are workspace-relative and reject traversal", () => {
  assert.deepEqual(
    parsePatchPaths("--- a/src/app.js\n+++ b/src/app.js\n@@ -1 +1 @@\n-old\n+new\n"),
    ["src/app.js"]
  );
  assert.throws(
    () => parsePatchPaths("--- a/../secret\n+++ b/../secret\n"),
    /Unsafe patch path/
  );
});

test("coding tools search and atomically apply a reviewed patch", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-coding-"));
  await writeFile(join(root, "app.js"), "const answer = 41;\n");
  const tools = new Map(createCodingTools().map((tool) => [tool.name, tool]));
  const context = {
    config: {
      safety: {
        workspaceRoot: root,
        allowOutsideWorkspace: false,
        autoApproveWrites: true,
        maxOutputBytes: 24_000
      }
    },
    approvals: { confirm: async () => true }
  };

  const searched = await tools.get("search_files").handler({ query: "answer" }, context);
  assert.equal(searched.matches[0].path, "app.js");
  assert.equal(searched.matches[0].line, 1);

  const applied = await tools.get("apply_patch").handler({
    patch: "--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-const answer = 41;\n+const answer = 42;\n",
    reason: "Correct the answer"
  }, context);
  assert.equal(applied.ok, true);
  assert.equal(await readFile(join(root, "app.js"), "utf8"), "const answer = 42;\n");
});
