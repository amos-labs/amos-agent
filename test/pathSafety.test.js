import test from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspacePath, truncateText } from "../src/util/pathSafety.js";

test("resolveWorkspacePath allows paths inside workspace", () => {
  const root = "/tmp/amos-agent-test";
  assert.equal(resolveWorkspacePath(root, "src/index.js"), "/tmp/amos-agent-test/src/index.js");
});

test("resolveWorkspacePath rejects paths outside workspace", () => {
  assert.throws(() => resolveWorkspacePath("/tmp/amos-agent-test", "../secret"), /escapes workspace/);
});

test("resolveWorkspacePath allows inside names that start with dots", () => {
  const root = "/tmp/amos-agent-test";
  assert.equal(resolveWorkspacePath(root, "..safe"), "/tmp/amos-agent-test/..safe");
});

test("truncateText reports truncated byte count", () => {
  const value = truncateText("abcdef", 3);
  assert.match(value, /abc/);
  assert.match(value, /truncated 3 bytes/);
});
