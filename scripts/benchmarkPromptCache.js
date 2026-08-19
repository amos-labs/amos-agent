#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const model = args[0] && !args[0].startsWith("--") ? args[0] :
  process.env.AMOS_PROMPT_CACHE_MODEL ||
  "mtplx-qwen38-27b-optimized-speed-fp16";
const baseUrl = option("--url") || process.env.AMOS_PROMPT_CACHE_URL ||
  "http://127.0.0.1:18081/v1";
const targetPrefixTokens = boundedInteger(
  option("--prefix-tokens") || process.env.AMOS_PROMPT_CACHE_TOKENS,
  256,
  16_384,
  2_048
);
const maxTokens = boundedInteger(option("--max-tokens"), 8, 128, 16);
const settleMs = boundedInteger(option("--settle-ms"), 0, 5_000, 500);
const output = option("--output");
const contractHash = "amos-prompt-cache-benchmark-v1";
const sharedSession = `amos-benchmark-shared-${randomUUID()}`;
const runMarker = randomUUID();
const baseMessages = benchmarkMessages(runMarker,
  "Return only the identifier of the final record.");

// The unique run marker prevents a prior benchmark's global prefix-bank entry
// from warming the control. The second byte-identical request then measures
// the task-stable session path without changing prompt quality or semantics.
const cold = await request("cold request", baseMessages, sharedSession);
await delay(settleMs);
const warm = await request("warm identical request", baseMessages, sharedSession);
const coldContinuationMessages = continuationMessages(randomUUID());
const coldContinuation = await request(
  "cold appended continuation",
  coldContinuationMessages,
  `amos-benchmark-continuation-cold-${randomUUID()}`
);
const continuationSession = `amos-benchmark-continuation-warm-${randomUUID()}`;
const continuationMarker = randomUUID();
await request(
  "continuation prefix prime",
  benchmarkMessages(continuationMarker, "Acknowledge these records in one word."),
  continuationSession
);
await delay(settleMs);
const warmContinuation = await request(
  "warm appended continuation",
  continuationMessages(continuationMarker),
  continuationSession
);
const report = {
  schema: "amos.prompt-cache-benchmark",
  version: 1,
  createdAt: new Date().toISOString(),
  endpoint: baseUrl,
  model,
  targetPrefixTokens,
  maxTokens,
  settleMs,
  warm,
  cold,
  comparison: {
    latencySpeedup: ratio(cold.elapsedMs, warm.elapsedMs),
    promptEvalSpeedup: ratio(cold.promptStateMs, warm.promptStateMs),
    warmCachedTokens: warm.cachedTokens,
    warmNewPrefillTokens: warm.newPrefillTokens,
    coldCachedTokens: cold.cachedTokens,
    coldNewPrefillTokens: cold.newPrefillTokens
  },
  continuation: {
    warm: warmContinuation,
    cold: coldContinuation,
    comparison: {
      latencySpeedup: ratio(coldContinuation.elapsedMs, warmContinuation.elapsedMs),
      promptEvalSpeedup: ratio(
        coldContinuation.promptStateMs,
        warmContinuation.promptStateMs
      ),
      warmCachedTokens: warmContinuation.cachedTokens,
      warmNewPrefillTokens: warmContinuation.newPrefillTokens,
      coldCachedTokens: coldContinuation.cachedTokens,
      coldNewPrefillTokens: coldContinuation.newPrefillTokens
    }
  }
};

console.log(JSON.stringify(report, null, 2));
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

async function request(label, messages, sessionId) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MTPLX-Session-ID": sessionId,
      "X-AMOS-Prompt-Contract": contractHash
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: 0,
      reasoning_effort: "low",
      max_completion_tokens: maxTokens
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `${label} failed with ${response.status}`);
  }
  const message = payload?.choices?.[0]?.message;
  if (!message) throw new Error(`${label} did not return an assistant message`);
  const stats = payload.mtplx_stats || {};
  return {
    label,
    elapsedMs: Math.round(performance.now() - startedAt),
    inputTokens: finite(payload.usage?.prompt_tokens),
    outputTokens: finite(payload.usage?.completion_tokens),
    sessionCacheHit: stats.session_cache_hit ?? null,
    requestSessionSource: text(stats.request_session_source),
    cacheSource: text(stats.cache_source),
    cacheMissReason: text(stats.cache_miss_reason),
    cachedTokens: finite(stats.cached_tokens),
    newPrefillTokens: finite(stats.new_prefill_tokens),
    promptStateMs: milliseconds(stats.prompt_state_total_time_s),
    ssdCacheHit: stats.ssd_cache_hit ?? null,
    ssdRestoreMs: milliseconds(stats.ssd_restore_s),
    message
  };
}

function syntheticPrefix(targetTokens) {
  const rows = [];
  let chars = 0;
  for (let index = 0; chars < targetTokens * 4; index += 1) {
    const row =
      `record-${String(index).padStart(5, "0")} status=verified owner=amos ` +
      `value=${(index * 17) % 10_000} note=stable-prefix-cache-evidence`;
    rows.push(row);
    chars += row.length + 1;
  }
  return rows.join("\n");
}

function benchmarkMessages(marker, instruction) {
  return [{
    role: "system",
    content: "Use only the supplied synthetic records. Keep the answer terse and exact."
  }, {
    role: "user",
    content: [
      `benchmark-run=${marker}`,
      syntheticPrefix(targetPrefixTokens),
      instruction
    ].join("\n")
  }];
}

function continuationMessages(marker) {
  return [
    ...benchmarkMessages(marker, "Acknowledge these records in one word."),
    { role: "assistant", content: "Acknowledged." },
    { role: "user", content: "Return only the identifier of the final record." }
  ];
}

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function milliseconds(value) {
  const seconds = finite(value);
  return seconds == null ? null : Math.round(seconds * 1_000);
}

function ratio(numerator, denominator) {
  return numerator > 0 && denominator > 0
    ? Number((numerator / denominator).toFixed(2))
    : null;
}

function text(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
