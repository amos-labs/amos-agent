#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  compareRouterLearningCandidate,
  runRouterLearningEvaluation,
  validateRouterLearningEvaluationInput
} from "../src/research/routerLearningEvaluation.js";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write([
    "Validate a local router evaluation without inference (default):",
    "  node scripts/evaluateRouterLearning.js --cases cases.json --models models.json --environment environment.json --profile profile.json --output plan.json",
    "Execute only against an explicitly selected literal loopback origin:",
    "  add --execute --base-url http://127.0.0.1:11435",
    "Optional: --repetitions 3 --timeout-ms 5000 --partition qualification --frozen-cases",
    "Compare saved reports (JSON array of report file paths):",
    "  --reports reports.json --profile profile.json --baseline MODEL --candidate MODEL --output comparison.json",
    "",
    "Cases: [{id,family,task,expectedClass,messages?}], or a compiler-exported amos.router-learning-cases envelope. Optional messages preserve user/assistant conversation context; task must equal the latest user request. Models: [{id,artifactSha256,artifactBytes?,runtimeDigest?}].",
    "artifactSha256 is a caller-verified GGUF hash. runtimeDigest is the distinct Ollama manifest hash; when provided it is checked before and after evaluation.",
    "Environment: {hardwareId,runtimeVersion,quantization:'Q4_K_M',mode:'warm'|'cold'|'contended'}.",
    "Qualification also needs conditionEvidence:{source:'external-harness',evidenceSha256} and memoryEvidence:{source:'external-runtime-process-tree-rss',evidenceSha256,measurements:[{modelId,artifactSha256,peakRssBytes}]}.",
    "Prepare and measure actual load conditions externally. This evaluator never claims Node's RSS is model memory, and never promotes a model.",
    "Only the current JSON class-only production protocol is evaluated. Alternate class-code outputs require a separately qualified wrapper.",
    "A checksum and --frozen-cases record caller assertions, not a trusted evaluator signature.",
    ""
  ].join("\n"));
} else {
  const outputPath = resolve(required("output"));
  const profile = args.profile ? await readJson(args.profile) : null;
  let output;
  if (args.reports) {
    if (args.execute || args.cases || args.models || args.environment || args["base-url"] || args.repetitions || args["timeout-ms"] || args.partition || args["frozen-cases"]) throw new Error("Comparison cannot be combined with inference options");
    if (!profile) throw new Error("--profile is required for comparison");
    const paths = await readJson(args.reports);
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== "string" || !path)) throw new Error("--reports must contain a JSON array of report file paths");
    const reports = await Promise.all(paths.map((path) => readJson(resolve(dirname(resolve(args.reports)), path))));
    output = compareRouterLearningCandidate({ reports, profile, baselineModelId: required("baseline"), candidateModelId: required("candidate") });
  } else {
    if (args.baseline || args.candidate) throw new Error("--baseline and --candidate require --reports");
    const [caseInput, models, environment] = await Promise.all([readJson(required("cases")), readJson(required("models")), readJson(required("environment"))]);
    let cases = caseInput;
    let partition = args.partition || "development";
    let datasetDigest = null;
    if (!Array.isArray(caseInput)) {
      const keys = ["schema", "version", "partition", "datasetDigest", "cases"];
      if (!caseInput || typeof caseInput !== "object" || caseInput.schema !== "amos.router-learning-cases" || caseInput.version !== 1 || Object.keys(caseInput).length !== keys.length || !keys.every((key) => Object.hasOwn(caseInput, key))) throw new Error("Unsupported cases envelope");
      if (args.partition && args.partition !== caseInput.partition) throw new Error("--partition does not match the cases envelope");
      cases = caseInput.cases;
      partition = caseInput.partition;
      datasetDigest = caseInput.datasetDigest;
    }
    const input = {
      cases, models, environment, profile,
      repetitions: args.repetitions === undefined ? 3 : Number(args.repetitions),
      timeoutMs: args["timeout-ms"] === undefined ? 5000 : Number(args["timeout-ms"]),
      partition, datasetDigest,
      frozenCases: Boolean(args["frozen-cases"]),
      ...(args["base-url"] ? { baseUrl: args["base-url"] } : {})
    };
    const plan = validateRouterLearningEvaluationInput(input);
    if (args.execute) {
      required("base-url");
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try { output = await runRouterLearningEvaluation({ ...input, signal: controller.signal }); }
      finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
    } else {
      output = {
        schema: "amos.router-learning-evaluation-plan", version: 1,
        executed: false, plannedAttempts: cases.length * models.length * plan.repetitions,
        ...plan,
        note: "Validation only. --execute and an explicit --base-url are required for local inference; no model has been contacted."
      };
    }
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output: outputPath, schema: output.schema, executed: output.executed ?? output.schema === "amos.router-learning-evaluation", ...(output.releaseReady !== undefined ? { releaseReady: output.releaseReady } : {}) })}\n`);
}

function required(key) { if (typeof args[key] !== "string" || !args[key]) throw new Error(`--${key} is required`); return args[key]; }
async function readJson(path) { return JSON.parse(await readFile(resolve(path), "utf8")); }
function parseArgs(values) {
  const flags = new Set(["execute", "frozen-cases", "help"]);
  const options = new Set(["cases", "models", "environment", "profile", "output", "base-url", "repetitions", "timeout-ms", "partition", "reports", "baseline", "candidate"]);
  const result = Object.create(null);
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (Object.hasOwn(result, key)) throw new Error(`Repeated option: ${argument}`);
    if (flags.has(key)) result[key] = true;
    else if (options.has(key)) {
      const value = values[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      result[key] = value;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return result;
}
