import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./pinnedTokenizerWorker.py", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");

// Research-only local CPU counter for #267's {identity,count} contract. Asset
// and runtime pins identify the implementation; serving parity is separate
// evidence, never implied by this constructor or its identity string.
export async function createPinnedTokenizerCounter({
  pythonExecutable, tokenizerDirectory, manifestPath, limits, signal = null,
  spawnImpl = spawn
}) {
  if (![pythonExecutable, tokenizerDirectory, manifestPath].every(p => typeof p === "string" && isAbsolute(p)) ||
      typeof spawnImpl !== "function" || (signal !== null && !(signal instanceof AbortSignal))) {
    throw new Error("Explicit absolute tokenizer/runtime paths required");
  }
  const bounds = {};
  for (const [name, maximum] of Object.entries({ startupTimeoutMs: 300_000, countTimeoutMs: 300_000, maxPendingCounts: 32, maxRequestBytes: 8_388_608 })) {
    const value = limits?.[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid explicit counter limit: ${name}`);
    bounds[name] = value;
  }
  const [manifest, source] = await Promise.all([readFile(manifestPath), readFile(workerPath)]);
  const manifestSha256 = sha(manifest), workerSha256 = sha(source);
  const identity = `pinned-tokenizer-v1:${sha(`${manifestSha256}\n${workerSha256}`)}`;
  let child = null, closed = false, failure = null, ready = false, sequence = 0;
  let startupTimer = null, killTimer = null, buffer = Buffer.alloc(0);
  const pending = new Map();
  let readyResolve, readyReject;
  const initialized = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const settle = (entry, error, value) => {
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener("abort", entry.onAbort);
    pending.delete(entry.id);
    if (error) entry.reject(error); else entry.resolve(value);
  };
  const fail = code => {
    if (closed) return;
    closed = true;
    failure = new Error(code);
    clearTimeout(startupTimer);
    signal?.removeEventListener("abort", externalAbort);
    readyReject(failure);
    for (const entry of pending.values()) settle(entry, failure);
    if (child) {
      killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      killTimer.unref();
      child.stdin.destroy();
      child.kill("SIGTERM");
    }
  };
  const externalAbort = () => fail("tokenizer_counter_aborted");
  const processLine = line => {
    let message;
    try { message = JSON.parse(line); } catch { return fail("tokenizer_protocol_error"); }
    if (!message || typeof message !== "object") return fail("tokenizer_protocol_error");
    if (!ready) {
      if (message.type !== "ready" || message.manifestSha256 !== manifestSha256 || message.workerSha256 !== workerSha256) {
        return fail("tokenizer_startup_binding_failed");
      }
      ready = true;
      clearTimeout(startupTimer);
      readyResolve();
      return;
    }
    const entry = pending.get(message.id);
    if (!entry || message.type !== "count" || !Number.isSafeInteger(message.inputTokens) || message.inputTokens < 0) {
      return fail("tokenizer_count_response_invalid");
    }
    settle(entry, null, message.inputTokens);
  };
  signal?.addEventListener("abort", externalAbort, { once: true });
  if (signal?.aborted) externalAbort();
  else {
    startupTimer = setTimeout(() => fail("tokenizer_startup_timeout"), bounds.startupTimeoutMs);
    try {
      child = spawnImpl(pythonExecutable, [workerPath, tokenizerDirectory, manifestPath, String(bounds.maxRequestBytes), manifestSha256], {
        stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", TOKENIZERS_PARALLELISM: "false", PYTHONDONTWRITEBYTECODE: "1" }
      });
      child.on("error", () => fail("tokenizer_worker_error"));
      child.on("exit", () => { fail("tokenizer_worker_exit"); clearTimeout(killTimer); });
      child.stdin.on("error", () => fail("tokenizer_input_error"));
      child.stdout.on("error", () => fail("tokenizer_output_error"));
      child.stderr.on("data", () => {}); // Drain diagnostics; never retain request/path content.
      child.stderr.on("error", () => fail("tokenizer_diagnostic_error"));
      child.stdout.on("data", chunk => {
        if (closed) return;
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        if (buffer.length > 65_536) return fail("tokenizer_response_limit");
        let newline;
        while (!closed && (newline = buffer.indexOf(10)) !== -1) {
          const line = buffer.subarray(0, newline).toString("utf8");
          buffer = buffer.subarray(newline + 1);
          processLine(line);
        }
      });
    } catch { fail("tokenizer_spawn_failed"); }
  }
  await initialized;
  return Object.freeze({
    identity,
    close: () => fail("tokenizer_counter_closed"),
    count(body, { signal: countSignal = null } = {}) {
      if (closed) return Promise.reject(failure);
      if (countSignal !== null && !(countSignal instanceof AbortSignal)) return Promise.reject(new Error("Invalid count signal"));
      if (countSignal?.aborted) return Promise.reject(new Error("tokenizer_count_aborted"));
      if (pending.size >= bounds.maxPendingCounts) {
        fail("tokenizer_pending_limit");
        return Promise.reject(failure);
      }
      const id = ++sequence;
      let wire;
      try { wire = JSON.stringify({ id, body }) + "\n"; } catch {
        fail("tokenizer_request_invalid"); return Promise.reject(failure);
      }
      if (Buffer.byteLength(wire) > bounds.maxRequestBytes) {
        fail("tokenizer_request_limit"); return Promise.reject(failure);
      }
      return new Promise((resolve, reject) => {
        const entry = { id, resolve, reject, signal: countSignal, onAbort: () => fail("tokenizer_count_aborted") };
        entry.timer = setTimeout(() => fail("tokenizer_count_timeout"), bounds.countTimeoutMs);
        pending.set(id, entry);
        countSignal?.addEventListener("abort", entry.onAbort, { once: true });
        try { child.stdin.write(wire); } catch { fail("tokenizer_input_error"); }
      });
    }
  });
}
