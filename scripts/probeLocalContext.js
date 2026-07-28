#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const models = readModels(args);
const baseUrl = readOption(args, "--url") ||
  process.env.AMOS_LOCAL_BENCHMARK_URL ||
  "http://127.0.0.1:11435";
const requestedContexts = String(readOption(args, "--contexts") || "32768,65536,131072,262144")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 4_096 && value <= 262_144);

if (models.length === 0 || requestedContexts.length === 0) {
  console.error(
    "Usage: node scripts/probeLocalContext.js <model> [model...] " +
    "[--contexts 32768,65536,131072,262144] [--url URL]"
  );
  process.exit(2);
}

const tags = await request("/api/tags");
const catalog = new Map((tags.models || []).map((model) => [model.name, model]));

for (const model of models) {
  const advertised = Number(catalog.get(model)?.details?.context_length || 0);
  console.log(`\n=== ${model} · advertised ${advertised || "unknown"} ===`);
  for (const contextLength of requestedContexts) {
    if (advertised > 0 && contextLength > advertised) {
      console.log(`SKIP ${contextLength} · exceeds advertised context`);
      continue;
    }
    const started = performance.now();
    try {
      const result = await request("/api/chat", {
        model,
        stream: false,
        think: false,
        keep_alive: "5m",
        messages: [{
          role: "user",
          content: "Reply with exactly: context probe ready"
        }],
        options: {
          temperature: 0,
          num_ctx: contextLength,
          num_predict: 16
        }
      }, 10 * 60_000);
      const processes = await request("/api/ps");
      const process = (processes.models || []).find((item) => item.name === model);
      const seconds = (performance.now() - started) / 1_000;
      console.log(
        `PASS ${contextLength} · ${seconds.toFixed(1)}s · ` +
        `${formatBytes(process?.size_vram)} allocated · ` +
        `${formatBytes(process?.size)} total · ${String(result.message?.content || "").trim()}`
      );
    } catch (error) {
      console.log(`FAIL ${contextLength} · ${String(error?.message || error).slice(0, 240)}`);
    } finally {
      await request("/api/chat", {
        model,
        stream: false,
        keep_alive: 0,
        messages: []
      }).catch(() => {});
    }
  }
}

async function request(path, body = null, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  return bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : "unknown";
}

function readModels(values) {
  const models = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--url" || values[index] === "--contexts") {
      index += 1;
      continue;
    }
    if (!values[index].startsWith("--")) models.push(values[index]);
  }
  return models;
}

function readOption(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : "";
}
