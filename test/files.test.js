import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTools } from "../src/tools/files.js";

test("read_file returns bounded content while reporting the full size", async () => {
  const root = mkdtempSync(join(tmpdir(), "amos-agent-files-"));
  writeFileSync(join(root, "large.txt"), "x".repeat(5_000));
  const tool = createFileTools().find(({ name }) => name === "read_file");
  const result = await tool.handler(
    { path: "large.txt", max_bytes: 1_024 },
    { config: { safety: { workspaceRoot: root, allowOutsideWorkspace: false, maxOutputBytes: 1_024 } } }
  );

  assert.equal(result.bytes, 5_000);
  assert.match(result.content, /truncated 3976 bytes/);
  assert.ok(Buffer.byteLength(result.content) < 1_100);
});

test("an exact-workspace file-write grant suppresses repeat write approvals", async () => {
  const root = mkdtempSync(join(tmpdir(), "amos-approved-write-"));
  const tool = createFileTools().find(({ name }) => name === "write_file");
  const result = await tool.handler(
    { path: "note.txt", content: "approved locally" },
    {
      config: {
        safety: {
          workspaceRoot: root,
          allowOutsideWorkspace: false,
          autoApproveWrites: false,
          autoApproveKinds: ["file-write"]
        }
      },
      approvals: { confirm: async () => assert.fail("approval should not be requested") }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "approved locally");
});
