import test from "node:test";
import assert from "node:assert/strict";
import { runBash, safeChildEnvironment } from "../src/tools/bash.js";

test("bash child environment excludes provider and AMOS secrets", () => {
  const value = safeChildEnvironment({
    PATH: "/bin",
    HOME: "/tmp/home",
    MOONSHOT_API_KEY: "model-secret",
    AMOS_API_KEY: "amos-secret",
    DATABASE_URL: "postgres://secret"
  });
  assert.deepEqual(value, { PATH: "/bin", HOME: "/tmp/home" });
});

test("bash captures only bounded output", async () => {
  const result = await runBash("printf '%02000d' 0", {
    cwd: process.cwd(),
    bashPath: "/bin/bash",
    timeoutMs: 2_000,
    maxOutputBytes: 1_024
  });
  assert.equal(result.ok, true);
  assert.match(result.stdout, /truncated 976 bytes/);
  assert.ok(Buffer.byteLength(result.stdout) < 1_100);
});

test("bash timeout terminates the process group promptly", async () => {
  const start = Date.now();
  const result = await runBash("sleep 5", {
    cwd: process.cwd(),
    bashPath: "/bin/bash",
    timeoutMs: 100,
    maxOutputBytes: 1_024
  });
  assert.equal(result.timed_out, true);
  assert.ok(Date.now() - start < 1_500);
});

test("bash cancellation terminates the process group promptly", async () => {
  const controller = new AbortController();
  const start = Date.now();
  const pending = runBash("sleep 5", {
    cwd: process.cwd(),
    bashPath: "/bin/bash",
    timeoutMs: 5_000,
    maxOutputBytes: 1_024,
    signal: controller.signal
  });

  setTimeout(() => controller.abort(), 50);
  const result = await pending;

  assert.equal(result.canceled, true);
  assert.equal(result.ok, false);
  assert.ok(Date.now() - start < 1_500);
});
