#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  createModelClient,
  resolveModelConfig,
  validateModelConfig
} from "../src/model/providers.js";
import {
  argumentsContain,
  evaluateChoice,
  evaluateJavaScript,
  evaluateToolFinal,
  normalizeAssistantToolMessage,
  toolArguments,
  validatePairedSuite
} from "../src/research/pairedModelQualification.js";

const args = process.argv.slice(2);
const suitePath = readOption(args, "--suite") ||
  new URL("../benchmarks/muse-sonnet-paired-v1.json", import.meta.url);
const suiteBytes = await readFile(suitePath);
const suite = validatePairedSuite(JSON.parse(suiteBytes));
const suiteSha256 = createHash("sha256").update(suiteBytes).digest("hex");
const targetSelection = normalizeTargetSelection(readOption(args, "--targets") || "both");
const output = readOption(args, "--output");
const only = new Set(String(readOption(args, "--only") || "").split(",").map((id) => id.trim()).filter(Boolean));
const maxTokens = boundedInteger(readOption(args, "--max-tokens"), 128, 16_384, 4_096);
const timeoutMs = boundedInteger(readOption(args, "--request-timeout-seconds"), 30, 7_200, 1_800) * 1_000;
const candidate = candidateTarget();
const control = controlTarget();
const targets = targetSelection === "both"
  ? [candidate, control]
  : [targetSelection === "candidate" ? candidate : control];
const selectedCases = suite.cases.filter((testCase) => only.size === 0 || only.has(testCase.id));

if (selectedCases.length === 0) throw new Error("No paired qualification cases selected");

const targetResults = [];
for (const target of targets) {
  console.log(`\n=== ${target.label} ===`);
  const cases = [];
  for (const testCase of selectedCases) {
    const result = await runCase(target, testCase);
    cases.push(result);
    console.log(`  ${result.passed ? "✓" : "✗"} ${testCase.id} (${result.wall_seconds.toFixed(1)}s)`);
  }
  const score = cases.reduce((sum, item) => sum + (item.passed ? item.weight : 0), 0);
  const maximum = cases.reduce((sum, item) => sum + item.weight, 0);
  const criticalFailures = cases.filter((item) => item.critical && !item.passed).map((item) => item.id);
  targetResults.push({
    target: target.publicIdentity,
    score,
    maximum,
    accuracy: score / maximum,
    critical_failures: criticalFailures,
    inference: aggregateInference(cases),
    cases
  });
}

const report = {
  schema: "amos.paired-model-qualification-report",
  version: 1,
  created_at: new Date().toISOString(),
  suite: {
    schema: suite.schema,
    version: suite.version,
    status: suite.status,
    sha256: suiteSha256,
    selected_cases: selectedCases.map((testCase) => testCase.id)
  },
  configuration: { max_tokens: maxTokens, request_timeout_ms: timeoutMs },
  targets: targetResults,
  paired: pairedSummary(targetResults)
};

console.log("\n=== Paired qualification summary ===");
for (const result of targetResults) {
  console.log(`${result.target.label}: ${result.score}/${result.maximum} (${Math.round(result.accuracy * 100)}%)`);
}
if (report.paired) console.log(JSON.stringify(report.paired, null, 2));
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

async function runCase(target, testCase) {
  const started = performance.now();
  const calls = [];
  try {
    let response;
    let evaluation;
    if (testCase.kind === "choice") {
      response = await target.chat({ messages: [{ role: "user", content: testCase.prompt }] });
      calls.push(response);
      evaluation = evaluateChoice(testCase, response.message?.content);
    } else if (testCase.kind === "javascript") {
      response = await target.chat({ messages: [{ role: "user", content: testCase.prompt }] });
      calls.push(response);
      evaluation = evaluateJavaScript(testCase, response.message?.content);
    } else {
      ({ response, evaluation } = await runToolFlow(target, testCase, calls));
    }
    return caseResult(testCase, response, evaluation, calls, started);
  } catch (error) {
    return {
      id: testCase.id,
      category: testCase.category,
      kind: testCase.kind,
      weight: testCase.weight,
      critical: Boolean(testCase.critical || testCase.kind === "tool_flow"),
      passed: false,
      wall_seconds: (performance.now() - started) / 1_000,
      evaluation: { passed: false, error: error.message },
      response: null,
      calls: calls.map(publicCall)
    };
  }
}

async function runToolFlow(target, testCase, calls) {
  const messages = [{ role: "user", content: testCase.prompt }];
  const sequence = [];
  for (const [index, step] of testCase.steps.entries()) {
    const response = await target.chat({ messages, tools: testCase.tools });
    calls.push(response);
    const toolCalls = response.message?.tool_calls || [];
    const call = toolCalls[0];
    const actualArguments = toolArguments(call);
    const exactArguments =
      argumentsContain(step.arguments, actualArguments) &&
      argumentsContain(actualArguments, step.arguments);
    const matched = toolCalls.length === 1 &&
      call?.function?.name === step.function && exactArguments;
    sequence.push({
      step: index + 1,
      expected_function: step.function,
      actual_function: call?.function?.name || null,
      expected_arguments: step.arguments,
      actual_arguments: actualArguments,
      passed: matched
    });
    if (!matched) {
      return {
        response,
        evaluation: { passed: false, sequence, error: "tool sequence or exact arguments diverged" }
      };
    }
    messages.push(normalizeAssistantToolMessage(response.message), {
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(step.result)
    });
  }
  const response = await target.chat({ messages, tools: testCase.tools });
  calls.push(response);
  const unexpectedCalls = response.message?.tool_calls || [];
  const finalEvaluation = evaluateToolFinal(testCase, response.message?.content);
  return {
    response,
    evaluation: {
      ...finalEvaluation,
      passed: finalEvaluation.passed && unexpectedCalls.length === 0,
      sequence,
      unexpected_final_tools: unexpectedCalls.map((call) => call.function?.name)
    }
  };
}

function caseResult(testCase, response, evaluation, calls, started) {
  return {
    id: testCase.id,
    category: testCase.category,
    kind: testCase.kind,
    weight: testCase.weight,
    critical: Boolean(testCase.critical || testCase.kind === "tool_flow"),
    passed: Boolean(evaluation.passed),
    wall_seconds: (performance.now() - started) / 1_000,
    evaluation,
    response: boundedText(response.message?.content, 16_000),
    calls: calls.map(publicCall)
  };
}

function candidateTarget() {
  const url = String(readOption(args, "--candidate-url") || "http://127.0.0.1:18080").replace(/\/$/, "");
  const model = readOption(args, "--candidate-model") || "muse-glimmer-30b";
  const label = readOption(args, "--candidate-label") || "Muse Glimmer 30B local";
  const reasoningStrength = readOption(args, "--candidate-reasoning-strength") || "low";
  const reasoningDialect = normalizeReasoningDialect(
    readOption(args, "--candidate-reasoning-dialect") || "muse"
  );
  const enableThinking = booleanOption(args, "--candidate-enable-thinking", true);
  const temperature = boundedNumber(readOption(args, "--candidate-temperature"), 0, 2, 1);
  const topP = boundedNumber(readOption(args, "--candidate-top-p"), 0.01, 1, 0.95);
  const topK = boundedInteger(readOption(args, "--candidate-top-k"), 1, 1_000, 64);
  const presencePenaltyValue = readOption(args, "--candidate-presence-penalty");
  const presencePenalty = presencePenaltyValue === undefined
    ? null
    : boundedNumber(presencePenaltyValue, -2, 2, 0);
  return {
    label,
    publicIdentity: {
      id: "candidate",
      label,
      model,
      protocol: "openai-chat-completions",
      reasoning_dialect: reasoningDialect,
      reasoning_strength: reasoningDialect === "muse" ? reasoningStrength : null,
      enable_thinking: reasoningDialect === "qwen" ? enableThinking : null,
      temperature,
      top_p: topP,
      top_k: topK,
      presence_penalty: presencePenalty
    },
    async chat({ messages, tools = [] }) {
      const started = performance.now();
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          max_tokens: maxTokens,
          temperature,
          top_p: topP,
          top_k: topK,
          presence_penalty: presencePenalty ?? undefined,
          chat_template_kwargs: candidateChatTemplateKwargs({
            reasoningDialect,
            reasoningStrength,
            enableThinking
          }),
          stream: false
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `Candidate returned ${response.status}`);
      return {
        message: payload?.choices?.[0]?.message,
        usage: payload?.usage || null,
        timings: payload?.timings || null,
        wall_seconds: (performance.now() - started) / 1_000
      };
    }
  };
}

function normalizeReasoningDialect(value) {
  const normalized = String(value).trim().toLowerCase();
  if (!["muse", "qwen", "none"].includes(normalized)) {
    throw new Error("--candidate-reasoning-dialect must be muse, qwen, or none");
  }
  return normalized;
}

function candidateChatTemplateKwargs({ reasoningDialect, reasoningStrength, enableThinking }) {
  if (reasoningDialect === "muse") return { reasoning_strength: reasoningStrength };
  if (reasoningDialect === "qwen") return { enable_thinking: enableThinking };
  return undefined;
}

function booleanOption(values, name, fallback) {
  const raw = readOption(values, name);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function controlTarget() {
  const provider = readOption(args, "--control-provider") || "bedrock";
  const model = readOption(args, "--control-model") || "anthropic.claude-sonnet-5";
  const region = readOption(args, "--control-region") || "us-east-1";
  const reasoningEffort = readOption(args, "--control-reasoning-effort") || "medium";
  const env = {
    ...process.env,
    AMOS_MODEL_PROVIDER: provider,
    AMOS_MODEL: model,
    AMOS_MODEL_REASONING_EFFORT: reasoningEffort,
    AMOS_MODEL_MAX_COMPLETION_TOKENS: String(maxTokens),
    AMOS_MODEL_REQUEST_TIMEOUT_MS: String(timeoutMs),
    AWS_REGION: region
  };
  if (provider === "bedrock") env.AMOS_BEDROCK_AUTH_MODE = readOption(args, "--control-auth-mode") || "sigv4";
  const config = resolveModelConfig(env);
  const missing = validateModelConfig(config);
  if (missing.length > 0 && ["control", "both"].includes(targetSelection)) {
    throw new Error(`Control model configuration is missing: ${missing.join(", ")}`);
  }
  const client = createModelClient(config);
  return {
    label: "Claude Sonnet 5 control",
    publicIdentity: {
      id: "control",
      label: "Claude Sonnet 5 control",
      provider: config.provider,
      deployment: config.deployment,
      model: config.model,
      protocol: config.protocol,
      region: config.awsRegion,
      reasoning_effort: config.reasoningEffort
    },
    async chat(input) {
      const started = performance.now();
      const response = await client.chat(input);
      return { ...response, wall_seconds: (performance.now() - started) / 1_000 };
    }
  };
}

function publicCall(call) {
  return {
    wall_seconds: call.wall_seconds,
    usage: call.usage || null,
    timings: call.timings ? {
      prompt_n: call.timings.prompt_n ?? null,
      prompt_ms: call.timings.prompt_ms ?? null,
      predicted_n: call.timings.predicted_n ?? null,
      predicted_ms: call.timings.predicted_ms ?? null
    } : null,
    tool_calls: (call.message?.tool_calls || []).map((item) => ({
      name: item.function?.name,
      arguments: toolArguments(item)
    }))
  };
}

function aggregateInference(cases) {
  const calls = cases.flatMap((testCase) => testCase.calls || []);
  const wallSeconds = calls.reduce((sum, call) => sum + Number(call.wall_seconds || 0), 0);
  const inputTokens = calls.reduce((sum, call) => sum + usageNumber(call.usage, "input_tokens", "prompt_tokens"), 0);
  const outputTokens = calls.reduce((sum, call) => sum + usageNumber(call.usage, "output_tokens", "completion_tokens"), 0);
  const predictedTokens = calls.reduce((sum, call) => sum + Number(call.timings?.predicted_n || 0), 0);
  const predictedMs = calls.reduce((sum, call) => sum + Number(call.timings?.predicted_ms || 0), 0);
  return {
    calls: calls.length,
    request_wall_seconds: wallSeconds,
    input_tokens: inputTokens || null,
    output_tokens: outputTokens || predictedTokens || null,
    local_decode_tokens_per_second: predictedMs > 0 ? predictedTokens / (predictedMs / 1_000) : null
  };
}

function pairedSummary(results) {
  if (results.length !== 2) return null;
  const candidateResult = results.find((result) => result.target.id === "candidate");
  const controlResult = results.find((result) => result.target.id === "control");
  const candidateCases = new Map(candidateResult.cases.map((item) => [item.id, item]));
  const pairs = controlResult.cases.map((controlCase) => {
    const candidateCase = candidateCases.get(controlCase.id);
    return {
      id: controlCase.id,
      candidate_passed: candidateCase.passed,
      control_passed: controlCase.passed
    };
  });
  return {
    candidate_score_delta: candidateResult.score - controlResult.score,
    candidate_only_passes: pairs.filter((item) => item.candidate_passed && !item.control_passed).map((item) => item.id),
    control_only_passes: pairs.filter((item) => !item.candidate_passed && item.control_passed).map((item) => item.id),
    both_passed: pairs.filter((item) => item.candidate_passed && item.control_passed).map((item) => item.id),
    both_failed: pairs.filter((item) => !item.candidate_passed && !item.control_passed).map((item) => item.id)
  };
}

function usageNumber(usage, primary, fallback) {
  return Number(usage?.[primary] ?? usage?.[fallback] ?? usage?.raw?.[primary] ?? 0);
}

function normalizeTargetSelection(value) {
  const normalized = String(value).trim().toLowerCase();
  if (["candidate", "control", "both"].includes(normalized)) return normalized;
  throw new Error(`Unsupported --targets value: ${value}`);
}

function readOption(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : "";
}

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Expected integer for ${value}`);
  return Math.min(maximum, Math.max(minimum, parsed));
}

function boundedNumber(value, minimum, maximum, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number for ${value}`);
  return Math.min(maximum, Math.max(minimum, parsed));
}

function boundedText(value, maximum) {
  const text = String(value || "");
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…`;
}
