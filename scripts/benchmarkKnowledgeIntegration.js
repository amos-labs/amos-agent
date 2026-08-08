#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import {
  aggregateIntegrationResults,
  atomicPrompts,
  buildIntegrationPrompt,
  buildWorkspaceIntegrationPrompt,
  buildWorkspacePrompt,
  buildWorkspaceRepairPrompt,
  expandIntegrationCases,
  evaluateAnswer,
  parseWorkspace,
  summarizeCaseResult,
  validateIntegrationSuite,
  workspaceJsonSchema
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
const reasoningEffort = normalizeReasoningEffort(readOption(args, "--reasoning-effort"));
const reasoningBudget = optionalBoundedInteger(
  readOption(args, "--reasoning-budget"),
  0,
  8192
);
const workspaceReasoningEffort = normalizeReasoningEffort(
  readOption(args, "--workspace-reasoning-effort")
) || reasoningEffort;
const workspaceReasoningBudget = optionalBoundedInteger(
  readOption(args, "--workspace-reasoning-budget"),
  0,
  8192
) ?? reasoningBudget;
const workspaceMaxTokens = boundedInteger(
  readOption(args, "--workspace-max-tokens"),
  32,
  8192,
  maxTokens
);
const workspaceMaxRepairs = boundedInteger(
  readOption(args, "--workspace-max-repairs"),
  0,
  3,
  1
);

if (!model) {
  console.error(
    "Usage: npm run benchmark:integration -- MODEL [--arm baseline|elicited|workspace|all] " +
    "[--protocol ollama|openai] [--url URL] [--reasoning-effort none|low|medium|high] " +
    "[--reasoning-budget N] [--workspace-reasoning-effort none|low|medium|high] " +
    "[--workspace-reasoning-budget N] [--workspace-max-tokens N] [--workspace-max-repairs N] " +
    "[--atomic-repetitions N] [--atomic-pass-threshold 0.5-1] " +
    "[--only ID,...] [--output REPORT.json]"
  );
  process.exit(2);
}

const suite = validateIntegrationSuite(JSON.parse(await readFile(suitePath, "utf8")));
const atomicRepetitions = boundedInteger(
  readOption(args, "--atomic-repetitions") || suite.atomic_repetitions,
  1,
  10,
  1
);
const atomicPassThreshold = boundedNumber(
  readOption(args, "--atomic-pass-threshold") || suite.atomic_pass_threshold,
  0.5,
  1,
  1
);
const selectedCases = expandIntegrationCases(suite.cases).filter((item) =>
  only.size === 0 || only.has(item.id) || only.has(item.family_id)
);
if (selectedCases.length === 0) {
  throw new Error(`No benchmark cases matched --only=${[...only].join(",")}`);
}
const results = [];
const atomicFamilies = new Map();

for (const testCase of selectedCases) {
  console.log(`\n=== ${testCase.id} ===`);
  let atomicResults = atomicFamilies.get(testCase.family_id);
  if (!atomicResults) {
    atomicResults = await runAtomicProbes(testCase);
    atomicFamilies.set(testCase.family_id, atomicResults);
  } else {
    console.log(`  ↳ reusing ${atomicResults.length} family-level atomic probe results`);
  }

  const baselineResponse = await chat(testCase.integration.prompt);
  const baseline = {
    response: baselineResponse.content,
    evaluation: evaluateAnswer(baselineResponse.content, testCase.integration),
    timing: baselineResponse.timing
  };
  console.log(`  ${baseline.evaluation.passed ? "✓" : "✗"} baseline integration`);

  let elicited = null;
  if (["elicited", "all"].includes(arm)) {
    const elicitedResponse = await chat(buildIntegrationPrompt(testCase, atomicResults));
    elicited = {
      response: elicitedResponse.content,
      evaluation: evaluateAnswer(elicitedResponse.content, testCase.integration),
      timing: elicitedResponse.timing
    };
    console.log(`  ${elicited.evaluation.passed ? "✓" : "✗"} elicited-note integration`);
  }

  let workspace = null;
  if (["workspace", "all"].includes(arm)) {
    const workspaceRequestOptions = {
      reasoningEffort: workspaceReasoningEffort,
      reasoningBudget: workspaceReasoningBudget,
      maxTokens: workspaceMaxTokens,
      responseFormat: workspaceResponseFormat()
    };
    const constructionAttempts = [];
    let constructionResponse = await chat(
      buildWorkspacePrompt(testCase, atomicResults),
      workspaceRequestOptions
    );
    let parsedWorkspace = parseWorkspace(constructionResponse.content, testCase);
    constructionAttempts.push({
      repair: false,
      response: constructionResponse.content,
      workspace: parsedWorkspace,
      timing: constructionResponse.timing
    });
    for (let repair = 1; !parsedWorkspace.valid && repair <= workspaceMaxRepairs; repair += 1) {
      constructionResponse = await chat(buildWorkspaceRepairPrompt(
        testCase,
        atomicResults,
        constructionResponse.content,
        parsedWorkspace.errors
      ), workspaceRequestOptions);
      parsedWorkspace = parseWorkspace(constructionResponse.content, testCase);
      constructionAttempts.push({
        repair: true,
        repair_number: repair,
        response: constructionResponse.content,
        workspace: parsedWorkspace,
        timing: constructionResponse.timing
      });
    }
    const construction = {
      attempts: constructionAttempts,
      response: constructionResponse.content,
      workspace: parsedWorkspace,
      timing: constructionResponse.timing
    };
    let integration = null;
    if (construction.workspace.valid) {
      const integrationResponse = await chat(
        buildWorkspaceIntegrationPrompt(testCase, constructionResponse.content)
      );
      integration = {
        response: integrationResponse.content,
        evaluation: evaluateAnswer(integrationResponse.content, testCase.integration),
        timing: integrationResponse.timing
      };
    }
    workspace = { construction, integration };
    const workspaceArmPassed = construction.workspace.valid &&
      integration?.evaluation?.passed === true;
    console.log(
      `  ${workspaceArmPassed ? "✓" : "✗"} workspace integration ` +
      `(${construction.workspace.valid ? "valid graph" : "invalid graph"}, ` +
      `${constructionAttempts.length - 1} repair${constructionAttempts.length === 2 ? "" : "s"})`
    );
  }

  results.push({
    id: testCase.id,
    family_id: testCase.family_id,
    variant_id: testCase.variant_id,
    category: testCase.category,
    atomic: atomicResults,
    baseline,
    elicited,
    workspace,
    summary: summarizeCaseResult({ atomicResults, baseline, elicited, workspace })
  });
}

const report = {
  schema: "amos.knowledge-integration-report",
  version: 1,
  created_at: new Date().toISOString(),
  diagnostic: suite.status !== "frozen",
  suite: { schema: suite.schema, version: suite.version, status: suite.status },
  model,
  endpoint: baseUrl,
  protocol,
  arm,
  configuration: {
    context_length: contextLength,
    max_tokens: maxTokens,
    reasoning_effort: reasoningEffort,
    reasoning_budget_tokens: reasoningBudget,
    workspace_max_tokens: workspaceMaxTokens,
    workspace_reasoning_effort: workspaceReasoningEffort,
    workspace_reasoning_budget_tokens: workspaceReasoningBudget,
    workspace_max_repairs: workspaceMaxRepairs,
    openai_reasoning_effort_forwarded_to_chat_template: protocol === "openai",
    workspace_json_schema_constrained: protocol === "openai",
    atomic_repetitions: atomicRepetitions,
    atomic_pass_threshold: atomicPassThreshold,
    atomic_results_shared_across_family_variants: true,
    evaluator_feedback_exposed_to_model: false
  },
  summary: aggregateIntegrationResults(results),
  cases: results
};

console.log("\n=== Knowledge integration summary ===");
console.log(JSON.stringify(report.summary, null, 2));
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

async function runAtomicProbes(testCase) {
  const results = [];
  for (const probe of testCase.atomic) {
    const attempts = [];
    for (const prompt of atomicPrompts(probe)) {
      for (let repetition = 0; repetition < atomicRepetitions; repetition += 1) {
        const response = await chat(prompt);
        attempts.push({
          prompt,
          repetition,
          response: response.content,
          evaluation: evaluateAnswer(response.content, probe),
          timing: response.timing
        });
      }
    }
    const passedAttempts = attempts.filter((attempt) => attempt.evaluation.passed).length;
    const passRate = attempts.length > 0 ? passedAttempts / attempts.length : 0;
    const evaluation = {
      passed: passRate >= atomicPassThreshold,
      pass_rate: passRate,
      passed_attempts: passedAttempts,
      total_attempts: attempts.length,
      threshold: atomicPassThreshold
    };
    results.push({ id: probe.id, attempts, evaluation });
    console.log(
      `  ${evaluation.passed ? "✓" : "✗"} atomic ${probe.id}: ` +
      `${passedAttempts}/${attempts.length} (${Math.round(passRate * 100)}%)`
    );
  }
  return results;
}

async function chat(prompt, overrides = {}) {
  const started = performance.now();
  const requestMaxTokens = overrides.maxTokens ?? maxTokens;
  const requestReasoningEffort = overrides.reasoningEffort ?? reasoningEffort;
  const requestReasoningBudget = overrides.reasoningBudget ?? reasoningBudget;
  const endpoint = `${baseUrl.replace(/\/$/, "")}${protocol === "openai" ? "/v1/chat/completions" : "/api/chat"}`;
  const body = protocol === "openai" ? {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: requestMaxTokens,
    reasoning_effort: requestReasoningEffort || undefined,
    reasoning_budget_tokens: requestReasoningBudget ?? undefined,
    chat_template_kwargs: requestReasoningEffort && requestReasoningEffort !== "none"
      ? { reasoning_effort: requestReasoningEffort }
      : undefined,
    response_format: overrides.responseFormat,
    stream: false
  } : {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    think: Boolean(requestReasoningEffort && requestReasoningEffort !== "none"),
    options: { temperature: 0, num_ctx: contextLength, num_predict: requestMaxTokens }
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
  return [
    "--suite", "--url", "--protocol", "--arm", "--output", "--only",
    "--request-timeout-seconds", "--max-tokens", "--context",
    "--reasoning-effort", "--reasoning-budget", "--workspace-reasoning-effort",
    "--workspace-reasoning-budget", "--workspace-max-tokens", "--workspace-max-repairs",
    "--atomic-repetitions", "--atomic-pass-threshold"
  ];
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

function boundedNumber(value, minimum, maximum, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function optionalBoundedInteger(value, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer between ${minimum} and ${maximum}, received: ${value}`);
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeProtocol(value) {
  const normalized = String(value).toLowerCase();
  if (["ollama", "openai"].includes(normalized)) return normalized;
  throw new Error(`Unsupported protocol: ${value}`);
}

function normalizeArm(value) {
  const normalized = String(value).toLowerCase();
  if (normalized === "assisted") return "elicited";
  if (["baseline", "elicited", "workspace", "all"].includes(normalized)) return normalized;
  throw new Error(`Unsupported arm: ${value}`);
}

function normalizeReasoningEffort(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (["none", "low", "medium", "high"].includes(normalized)) return normalized;
  throw new Error(`Unsupported reasoning effort: ${value}`);
}

function workspaceResponseFormat() {
  return {
    type: "json_schema",
    schema: workspaceJsonSchema()
  };
}
