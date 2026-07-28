#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const models = readModels(args);
const imagePath = readOption(args, "--image");
const baseUrl = readOption(args, "--url") ||
  process.env.AMOS_LOCAL_BENCHMARK_URL ||
  "http://127.0.0.1:11435";
const expected = {
  architecture: normalized(readOption(args, "--expect-architecture")),
  memoryGb: Number(readOption(args, "--expect-memory")),
  profile: normalized(readOption(args, "--expect-profile"))
};

if (
  models.length === 0 ||
  !imagePath ||
  !expected.architecture ||
  !Number.isFinite(expected.memoryGb) ||
  !expected.profile
) {
  console.error(
    "Usage: node scripts/benchmarkLocalVision.js <model> [model...] --image PATH " +
    "--expect-architecture ARM64 --expect-memory 64 --expect-profile 'AMOS Local · Capable'"
  );
  process.exit(2);
}

const image = (await readFile(imagePath)).toString("base64");
for (const model of models) {
  const started = performance.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [{
        role: "user",
        content:
          "Inspect this AMOS Desktop screenshot. Return only JSON with exactly these keys: " +
          '{"architecture":"string","memory_gb":0,"recommended_profile":"string"}. ' +
          "Read the values visible in the hardware recommendation card; do not infer them.",
        images: [image]
      }],
      options: {
        temperature: 0,
        num_ctx: 32_768,
        num_predict: 256
      }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Ollama returned HTTP ${response.status}`);
  const parsed = parseJson(payload.message?.content);
  const passed =
    normalized(parsed.architecture) === expected.architecture &&
    Number(parsed.memory_gb) === expected.memoryGb &&
    normalized(parsed.recommended_profile) === expected.profile;
  const seconds = (performance.now() - started) / 1_000;
  const tokensPerSecond = payload.eval_duration > 0
    ? Number(payload.eval_count || 0) / (payload.eval_duration / 1_000_000_000)
    : 0;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${model} · ${seconds.toFixed(1)}s · ` +
    `${tokensPerSecond.toFixed(1)} tok/s · ${JSON.stringify(parsed)}`
  );
}

function parseJson(value) {
  const text = String(value || "").trim();
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
  return JSON.parse(unfenced.slice(start, end + 1));
}

function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function readModels(values) {
  const options = new Set([
    "--image",
    "--url",
    "--expect-architecture",
    "--expect-memory",
    "--expect-profile"
  ]);
  const models = [];
  for (let index = 0; index < values.length; index += 1) {
    if (options.has(values[index])) {
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
