#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  QWEN_RESEARCH_DEFAULT_ENDPOINTS,
  QwenResearchWorker,
  createQwen38AwsResearchEnvironment,
  createQwen38ResearchEnvironment,
  qwenResearchEnvironmentDigest
} from "../src/research/qwenResearchEnvironment.js";
import { digestResearchValue } from "../src/research/experimentProtocol.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const benchmarkScript = join(scriptDirectory, "benchmarkLocalModels.js");
const args = process.argv.slice(2);
const runtime = option("--runtime") || "mtplx";
const outputPath = option("--output");
const baseUrl = option("--url") || QWEN_RESEARCH_DEFAULT_ENDPOINTS[runtime];
const runtimeBinaryPath = option("--runtime-binary");
const suppliedBinaryDigest = option("--runtime-binary-sha256");
const repetitions = integerOption("--repetitions", 3, 1, 20);
const suite = option("--suite") || "all";
const contextTokens = integerOption("--context", 32_768, 4_096, 131_072);
const maxOutputTokens = integerOption("--max-tokens", 768, 32, 4_096);
const requestTimeoutSeconds = integerOption(
  "--request-timeout-seconds",
  600,
  60,
  7_200
);
const only = option("--only");
const probeOnly = args.includes("--probe-only");
const apiKey = process.env.AMOS_LOCAL_BENCHMARK_API_KEY || null;
const modelManifestDigest = option("--model-manifest-sha256");
const reasoningEffort = option("--reasoning-effort") || (runtime === "vllm" ? "low" : "none");
const answerReserveTokens = integerOption(
  "--answer-reserve-tokens",
  reasoningEffort === "none" ? 0 : Math.min(256, maxOutputTokens - 1),
  0,
  maxOutputTokens - 1
);

if (!["ollama", "mtplx", "vllm"].includes(runtime)) {
  fail("--runtime must be ollama, mtplx, or vllm");
}
if (!baseUrl) fail("No endpoint is known for the selected runtime");
if (!outputPath) fail("--output REPORT.json is required");
if (!runtimeBinaryPath && !suppliedBinaryDigest) {
  fail("Provide --runtime-binary PATH or --runtime-binary-sha256 DIGEST");
}
if (suppliedBinaryDigest && !/^[a-f0-9]{64}$/.test(suppliedBinaryDigest)) {
  fail("--runtime-binary-sha256 must be a lowercase SHA-256 digest");
}
if (runtime === "vllm" && !/^[a-f0-9]{64}$/.test(modelManifestDigest)) {
  fail("AWS vLLM requires --model-manifest-sha256 DIGEST");
}

const runtimeBinaryDigest = suppliedBinaryDigest || await hashRegularFile(runtimeBinaryPath);
const environment = runtime === "vllm"
  ? createQwen38AwsResearchEnvironment({
      containerImageDigest: runtimeBinaryDigest,
      modelArtifactManifestDigest: modelManifestDigest,
      maxOutputTokens,
      reasoningEffort
    })
  : createQwen38ResearchEnvironment({
      runtime,
      runtimeBinaryDigest,
      contextTokens,
      maxOutputTokens,
      reasoningEffort
    });
const worker = new QwenResearchWorker({
  environment,
  baseUrl,
  apiKey,
  requestTimeoutMs: requestTimeoutSeconds * 1_000
});
const readiness = await worker.probe();
const sourceRevision = await gitRevision();
const benchmarkScriptDigest = await hashRegularFile(benchmarkScript);

if (probeOnly) {
  const report = baselineReport({
    sourceRevision,
    benchmarkScriptDigest,
    environment,
    readiness,
    suite,
    repetitions: 0,
    runs: []
  });
  await atomicWriteJson(outputPath, report);
  printSummary(report, outputPath);
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "amos-qwen-baseline-"));
const runs = [];
try {
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const rawOutputPath = join(temporaryDirectory, `qualification-${repetition}.json`);
    console.log(`\n=== Qwen research baseline ${repetition}/${repetitions} (${runtime}) ===`);
    const benchmarkArguments = [
      benchmarkScript,
      environment.model.servedModelId,
      "--suite",
      suite,
      "--url",
      baseUrl,
      "--protocol",
      environment.runtime.protocol,
      "--context",
      String(contextTokens),
      "--max-tokens",
      String(maxOutputTokens),
      "--answer-reserve-tokens",
      String(answerReserveTokens),
      "--request-timeout-seconds",
      String(requestTimeoutSeconds),
      "--reasoning-effort",
      reasoningEffort,
      "--output",
      rawOutputPath
    ];
    if (only) benchmarkArguments.push("--only", only);
    await run(process.execPath, benchmarkArguments, repositoryRoot);
    const qualification = JSON.parse(await readFile(rawOutputPath, "utf8"));
    validateQualificationReport(qualification, environment);
    runs.push({
      repetition,
      reportDigest: digestResearchValue(qualification),
      qualification
    });
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const report = baselineReport({
  sourceRevision,
  benchmarkScriptDigest,
  environment,
  readiness,
  suite,
  repetitions,
  runs
});
await atomicWriteJson(outputPath, report);
printSummary(report, outputPath);

function baselineReport({
  sourceRevision,
  benchmarkScriptDigest,
  environment,
  readiness,
  suite,
  repetitions,
  runs
}) {
  const results = runs.map((run) => run.qualification.results[0]);
  return {
    schema: "amos.qwen-research-baseline-report",
    version: 1,
    createdAt: new Date().toISOString(),
    sourceRevision,
    benchmarkScriptDigest,
    dataClassification: {
      partition: "development",
      reason: "Existing qualification fixtures are visible in the repository and cannot serve as sealed evidence"
    },
    environment,
    environmentDigest: qwenResearchEnvironmentDigest(environment),
    readiness,
    suite,
    repetitions,
    aggregate: {
      completedRuns: runs.length,
      meanScore: mean(results.map((result) => result.score)),
      meanMaximum: mean(results.map((result) => result.maximum)),
      meanWallSeconds: mean(results.map((result) => result.wallSeconds)),
      meanGenerationTokensPerSecond: mean(
        results.map((result) => result.timing?.generationTokensPerSecond)
      ),
      allRunsPerfect: results.length > 0 && results.every(
        (result) => result.score === result.maximum
      )
    },
    runs
  };
}

function validateQualificationReport(report, environment) {
  if (report?.schema !== "amos.local-model-qualification" || report?.version !== 1) {
    throw new Error("Benchmark did not produce an AMOS local-model qualification report");
  }
  if (report.protocol !== environment.runtime.protocol) {
    throw new Error("Benchmark protocol does not match the pinned research environment");
  }
  if (!Array.isArray(report.results) || report.results.length !== 1) {
    throw new Error("Each baseline repetition must contain exactly one model result");
  }
  if (report.results[0].model !== environment.model.servedModelId) {
    throw new Error("Benchmark model does not match the pinned research environment");
  }
  if (report.answer_reserve_tokens !== answerReserveTokens) {
    throw new Error("Benchmark answer reserve does not match the requested scaffold budget");
  }
}

async function hashRegularFile(path) {
  if (!path) throw new Error("A file path is required for hashing");
  const resolved = resolve(path);
  const metadata = await stat(resolved);
  if (!metadata.isFile()) throw new Error(`Expected a regular file: ${resolved}`);
  const hash = createHash("sha256");
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(resolved);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", resolveHash);
  });
  return hash.digest("hex");
}

async function atomicWriteJson(path, value) {
  const destination = resolve(path);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, destination);
}

async function gitRevision() {
  let output = "";
  await new Promise((resolveGit, rejectGit) => {
    const child = spawn("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => { errorOutput += String(chunk); });
    child.once("error", rejectGit);
    child.once("exit", (code) => {
      if (code === 0) resolveGit();
      else rejectGit(new Error(`git rev-parse failed: ${errorOutput.trim()}`));
    });
  });
  const revision = output.trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Git returned an invalid source revision");
  return revision;
}

async function run(command, commandArguments, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArguments, {
      cwd,
      stdio: "inherit",
      env: process.env
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`Qwen baseline exited with ${signal || code || "unknown status"}`));
    });
  });
}

function mean(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (finite.length === 0) return null;
  return Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(3));
}

function printSummary(report, path) {
  console.log("\n=== Qwen research baseline report ===");
  console.log(`Environment: ${report.environmentDigest}`);
  console.log(`Runs: ${report.aggregate.completedRuns}/${report.repetitions}`);
  if (report.aggregate.completedRuns > 0) {
    console.log(`Mean score: ${report.aggregate.meanScore}/${report.aggregate.meanMaximum}`);
    console.log(`Mean wall time: ${report.aggregate.meanWallSeconds}s`);
    console.log(`Mean decode: ${report.aggregate.meanGenerationTokensPerSecond} tok/s`);
  }
  console.log(`Report: ${resolve(path)}`);
  console.log(`Report digest: ${digestResearchValue(report)}`);
}

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function integerOption(name, fallback, minimum, maximum) {
  const raw = option(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function fail(message) {
  console.error(
    `${message}\n\n` +
    "Usage: node scripts/runQwenResearchBaseline.js " +
    "--runtime mtplx|ollama|vllm --runtime-binary PATH --output REPORT.json " +
    "[--url URL] [--model-manifest-sha256 DIGEST] [--repetitions 3] " +
    "[--suite all] [--reasoning-effort none|low|medium|xhigh] " +
    "[--answer-reserve-tokens 256] [--probe-only]"
  );
  process.exit(2);
}
