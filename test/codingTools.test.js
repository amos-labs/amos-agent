import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingTools, parsePatchPaths, runProgram } from "../src/tools/coding.js";

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
        autoApproveWrites: false,
        autoApproveKinds: ["code-patch"],
        maxOutputBytes: 24_000
      }
    },
    approvals: { confirm: async () => assert.fail("approval should not be requested") }
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

test("project inspection produces a bounded briefing without reading secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-project-brief-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "brief-me",
      scripts: { test: "node --test", lint: "eslint ." },
      dependencies: { electron: "1.0.0" }
    })
  );
  await writeFile(join(root, "README.md"), "# Brief Me\nA useful project.\n");
  await writeFile(join(root, ".env"), "TOP_SECRET=never-return-this\n");
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

  const briefing = await tools.get("desktop_inspect_project").handler({}, context);
  assert.equal(briefing.project, "brief-me");
  assert.ok(briefing.stack.includes("Electron"));
  assert.ok(briefing.verification.includes("npm run test"));
  assert.match(briefing.readme.excerpt, /useful project/);
  assert.equal(JSON.stringify(briefing).includes("never-return-this"), false);
});

test("program runner tolerates a short-lived child closing unused stdin", async () => {
  const results = await Promise.all(
    Array.from({ length: 32 }, () =>
      runProgram(process.execPath, ["-e", "process.exit(0)"], {
        cwd: tmpdir(),
        timeoutMs: 5_000,
        maxOutputBytes: 4_096
      })
    )
  );
  assert.equal(results.every((result) => result.ok), true);
});
