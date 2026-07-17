import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeAgentPath, resolveWorkspacePath, truncateText } from "../src/util/pathSafety.js";

test("resolveWorkspacePath allows paths inside workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "amos-agent-workspace-"));
  assert.equal(resolveWorkspacePath(root, "src/index.js"), join(realpathSync(root), "src/index.js"));
});

test("resolveWorkspacePath rejects paths outside workspace", () => {
  assert.throws(() => resolveWorkspacePath("/tmp/amos-agent-test", "../secret"), /escapes workspace/);
});

test("resolveWorkspacePath allows inside names that start with dots", () => {
  const root = mkdtempSync(join(tmpdir(), "amos-agent-workspace-"));
  assert.equal(resolveWorkspacePath(root, "..safe"), join(realpathSync(root), "..safe"));
});

test("resolveWorkspacePath rejects a symlink escape", () => {
  const root = mkdtempSync(join(tmpdir(), "amos-agent-workspace-"));
  const outside = mkdtempSync(join(tmpdir(), "amos-agent-outside-"));
  symlinkSync(outside, join(root, "escape"));
  assert.throws(() => resolveWorkspacePath(root, "escape/secret.txt"), /symlink/);
});

test("agent file tools reject dotenv and private key paths", () => {
  const root = mkdtempSync(join(tmpdir(), "amos-agent-workspace-"));
  assert.throws(() => assertSafeAgentPath(join(root, ".env.local"), root), /Sensitive credential/);
  assert.throws(() => assertSafeAgentPath(join(root, "deploy.pem"), root), /Sensitive credential/);
});

test("truncateText reports truncated byte count", () => {
  const value = truncateText("abcdef", 3);
  assert.match(value, /abc/);
  assert.match(value, /truncated 3 bytes/);
});
