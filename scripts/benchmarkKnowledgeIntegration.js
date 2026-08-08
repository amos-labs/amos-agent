#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import {
  aggregateIntegrationResults,
  buildIntegrationPrompt,
  expandIntegrationCases,
  evaluateAnswer,
  summarizeCaseResult
} from "../src/research/knowledgeIntegration.js";

const args = process.argv.slice(2);
const model = positional(args)[0];
const suitePath = readOption(args, "--suite") ||
  new URL("../benchmarks/knowledge-integration-v0.json", import.meta.url);
const baseUrl = readOption(args, "--url") ||
  process.env.AMOS_LOCAL_BENCHMARK_URL ||
  "http://127.0.0.1:11435";
const protocol = normalizeProtocol(readOption(args, "--protocol") || "ollama");
const arm = normalizeArm(readOption(args, "--arm") || "all");
const output = readOption(args, "--output");
const only = new Set((readOption(args, "--only") || "").split(",").filter(Boolean));
const timeoutMs = boundedInteger(readOption(args, "--request-timeout-seconds"), 30, 7200, 600) * 1000;
const maxTokens = boundedInteger(readOption(args, "--max-tokens"), 32, 4096, 768);
const contextLength = boundedInteger(readOption(args, "--context"), 4096, 131072, 32768);

if (!model) {
  console.error(
    "Usage: npm run benchmark:integration -- MODEL [--arm baseline|assisted|all] " +
    "[--protocol ollama|openai] [--url URL] [--only ID,...] [--output REPORT.json]"
  );
  process.exit(2);
}

const suite = JSON.parse(await readFile(suitePath, "utf8"));
const selectedCases = expandIntegrationCases(suite.cases).filter((item) =>
  only.size === 0 || only.has(item.id) || only.has(item.family_id)
);
const results = [];

for (const testCase of selectedCases) {
  console.log(`\n=== ${testCase.id} ===`);
  const atomicResults = [];
  for (const probe of testCase.atomic) {
    const response = await chat(probe.prompt);
    const evaluation = evaluateAnswer(response.content, probe);
    atomicResults.push({ id: probe.id, response: response.content, evaluation, timing: response.timing });
    console.log(`  ${evaluation.passed ? "✓" : "✗"} atomic ${probe.id}: ${evaluation.label || "invalid"}`);
  }

  const baselineResponse = await chat(testCase.integration.prompt);
  const baseline = {
    response: baselineResponse.content,
    evaluation: evaluateAnswer(baselineResponse.content, testCase.integration),
    timing: baselineResponse.timing
  };
  console.log(`  ${baseline.evaluation.passed ? "✓" : "✗"} baseline integration`);

  let assisted = null;
  if (arm !== "baseline") {
    const assistedResponse = await chat(buildIntegrationPrompt(testCase, atomicResults));
    assisted = {
      response: assistedResponse.content,
      evaluation: evaluateAnswer(assistedResponse.content, testCase.integration),
      timing: assistedResponse.timing
    };
    console.log(`  ${assisted.evaluation.passed ? "✓" : "✗"} assisted integration`);
  }

  results.push({
    id: testCase.id,
    family_id: testCase.family_id,
    variant_id: testCase.variant_id,
    category: testCase.category,
    atomic: atomicResults,
    baseline,
    assisted,
    summary: summarizeCaseResult({ atomicResults, baseline, assisted })
  });
}

const report = {
  schema: "amos.knowledge-integration-report",
  version: 0,
  created_at: new Date().toISOString(),
  diagnostic: true,
  suite: { schema: suite.schema, version: suite.version, status: suite.status },
  model,
  endpoint: baseUrl,
  protocol,
  arm,
  summary: aggregateIntegrationResults(results),
  cases: results
};

console.log("\n=== Knowledge integration summary ===");
console.log(JSON.stringify(report.summary, null, 2));
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

async function chat(prompt) {
  const started = performance.now();
  const endpoint = `${baseUrl.replace(/\/$/, "")}${protocol === "openai" ? "/v1/chat/completions" : "/api/chat"}`;
  const body = protocol === "openai" ? {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: maxTokens,
    stream: false
  } : {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    think: false,
    options: { temperature: 0, num_ctx: contextLength, num_predict: maxTokens }
  };
  const payload = await postJson(endpoint, body, timeoutMs);
  const choice = protocol === "openai" ? payload?.choices?.[0] : null;
  const message = protocol === "openai" ? choice?.message : payload?.message;
  const content = message?.content;
  const reasoning = message?.reasoning_content || message?.reasoning || "";
  return {
    content: String(content || ""),
    timing: {
      wall_seconds: (performance.now() - started) / 1000,
      prompt_tokens: payload?.prompt_eval_count || payload?.usage?.prompt_tokens || null,
      completion_tokens: payload?.eval_count || payload?.usage?.completion_tokens || null,
      finish_reason: choice?.finish_reason || payload?.done_reason || null,
      reasoning_characters: String(reasoning).length
    }
  };
}

async function postJson(url, body, requestTimeoutMs) {
  const target = new URL(url);
  const serialized = JSON.stringify(body);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(serialized)
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let payload;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          reject(new Error(`Endpoint returned invalid JSON (HTTP ${response.statusCode})`));
          return;
        }
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(payload?.error?.message || payload?.error || `HTTP ${response.statusCode}`));
          return;
        }
        resolve(payload);
      });
    });
    const timeout = setTimeout(() => request.destroy(new Error("Model request timed out")), requestTimeoutMs);
    request.once("close", () => clearTimeout(timeout));
    request.once("error", reject);
    request.end(serialized);
  });
}

function positional(values) {
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    if (optionNames().includes(values[index])) {
      index += 1;
    } else if (!values[index].startsWith("--")) {
      result.push(values[index]);
    }
  }
  return result;
}

function optionNames() {
  return ["--suite", "--url", "--protocol", "--arm", "--output", "--only", "--request-timeout-seconds", "--max-tokens", "--context"];
}

function readOption(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : "";
}

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeProtocol(value) {
  const normalized = String(value).toLowerCase();
  if (["ollama", "openai"].includes(normalized)) return normalized;
  throw new Error(`Unsupported protocol: ${value}`);
}

function normalizeArm(value) {
  const normalized = String(value).toLowerCase();
  if (["baseline", "assisted", "all"].includes(normalized)) return normalized;
  throw new Error(`Unsupported arm: ${value}`);
}
