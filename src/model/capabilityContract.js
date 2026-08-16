import { createHash } from "node:crypto";
import {
  MODEL_CAPABILITY_SUITE,
  expectedScenarioNames
} from "./modelCapabilitySuite.js";

export const CAPABILITY_CONTRACT_SCHEMA = "amos.model-capability-contract";
export const CAPABILITY_CONTRACT_VERSION = 1;
export const CAPABILITY_STATUSES = Object.freeze([
  "qualified",
  "conditional",
  "experimental",
  "unqualified"
]);
export const AUTONOMY_LEVELS = Object.freeze(["observe", "draft", "propose", "execute"]);
export const EVIDENCE_TRUST_LEVELS = Object.freeze([
  "release-signed",
  "measured-local",
  "measured-managed"
]);

export function compileCapabilityContracts(report, options = {}) {
  assertQualificationReport(report);
  const reportDigest = digestJson(report);
  const expectedScenarios = expectedScenarioNames(report.suite);
  const partialRun = Boolean(report.only_scenarios) || expectedScenarios.length === 0;

  return report.results.map((result) => {
    const scenarios = normalizeScenarios(result.scenarios);
    const passed = scenarios.filter((scenario) => scenario.passed);
    const failed = scenarios.filter((scenario) => !scenario.passed);
    const capabilities = unionMappedValues(passed, "capabilities");
    const workflows = unionMappedValues(passed, "workflows");
    const scenarioNames = new Set(scenarios.map((scenario) => scenario.name));
    if (scenarioNames.size !== scenarios.length) throw new Error(`Duplicate scenarios for ${result.model}`);
    const complete = !partialRun && expectedScenarios.every((name) => scenarioNames.has(name));
    const score = scenarios.reduce((sum, scenario) => sum + (scenario.passed ? scenario.weight : 0), 0);
    const maximum = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
    if (finiteNumber(result.score, -1) !== score || finiteNumber(result.maximum, -1) !== maximum) {
      throw new Error(`Aggregate score does not match scenario evidence for ${result.model}`);
    }
    const passRate = maximum > 0 ? score / maximum : 0;
    const repetitions = positiveInteger(report.repetitions, 1);
    const status = qualificationStatus({ complete, passRate, repetitions, failed });
    const autonomy = qualifiedAutonomy(capabilities, status);
    const model = requiredText(result.model, "result.model");
    const provider = cleanText(options.provider || report.provider || report.protocol || "unknown");
    const protocol = cleanText(options.protocol || report.protocol || "unknown");
    const deployment = cleanText(options.deployment || "local");

    return validateCapabilityContract({
      schema: CAPABILITY_CONTRACT_SCHEMA,
      version: CAPABILITY_CONTRACT_VERSION,
      id: `${deployment}:${provider}:${model}`,
      identity: {
        provider,
        model,
        protocol,
        deployment,
        runtime: nullableText(options.runtime || report.runtime),
        runtimeVersion: nullableText(options.runtimeVersion || report.runtime_version),
        quantization: nullableText(options.quantization || result.quantization),
        promptVersion: cleanText(options.promptVersion || "benchmark-default"),
        toolSchemaVersion: cleanText(
          options.toolSchemaVersion || report.tool_schema_version || "benchmark-embedded"
        )
      },
      evidence: {
        suite: MODEL_CAPABILITY_SUITE.id,
        suiteVersion: MODEL_CAPABILITY_SUITE.version,
        sourceSchema: report.schema,
        sourceVersion: report.version,
        reportDigest,
        evaluatedAt: normalizeDate(report.created_at),
        trust: options.trust || (deployment === "local" ? "measured-local" : "measured-managed"),
        repetitions,
        complete
      },
      status,
      grants: {
        modalities: ["text"],
        capabilities,
        workflows,
        autonomy
      },
      failures: failed.map((scenario) => ({
        scenario: scenario.name,
        capabilities: mappedValues(scenario.name, "capabilities"),
        detail: cleanText(scenario.detail || "scenario failed").slice(0, 500)
      })),
      limits: {
        contextTokens: positiveInteger(report.context_length, 0)
      },
      performance: {
        score,
        maximum,
        passRate,
        wallSeconds: finiteNumber(result.wallSeconds, 0),
        tokensPerSecond: finiteNumber(result.tokensPerSecond, 0),
        latencyClass: options.latencyClass || inferLatencyClass(result.tokensPerSecond),
        costClass: options.costClass || (deployment === "local" ? "local" : "unknown")
      }
    });
  });
}

export function validateCapabilityContract(contract) {
  if (!plainObject(contract)) throw new Error("Capability contract must be an object");
  if (contract.schema !== CAPABILITY_CONTRACT_SCHEMA || contract.version !== CAPABILITY_CONTRACT_VERSION) {
    throw new Error("Unsupported capability contract schema");
  }
  requiredText(contract.id, "contract.id");
  assertObjectFields(contract.identity, "identity", [
    "provider",
    "model",
    "protocol",
    "deployment",
    "promptVersion",
    "toolSchemaVersion"
  ]);
  assertObjectFields(contract.evidence, "evidence", [
    "suite",
    "sourceSchema",
    "trust",
    "evaluatedAt",
    "reportDigest"
  ]);
  if (!positiveInteger(contract.evidence.suiteVersion, 0) ||
      !positiveInteger(contract.evidence.sourceVersion, 0) ||
      !positiveInteger(contract.evidence.repetitions, 0)) {
    throw new Error("Evidence versions and repetitions must be positive integers");
  }
  if (typeof contract.evidence.complete !== "boolean") {
    throw new Error("evidence.complete must be boolean");
  }
  if (!EVIDENCE_TRUST_LEVELS.includes(contract.evidence.trust)) {
    throw new Error(`Unsupported evidence trust: ${contract.evidence.trust}`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(contract.evidence.reportDigest || ""))) {
    throw new Error("evidence.reportDigest must be a SHA-256 digest");
  }
  normalizeDate(contract.evidence.evaluatedAt);
  if (!CAPABILITY_STATUSES.includes(contract.status)) {
    throw new Error(`Unsupported capability status: ${contract.status}`);
  }
  if (!plainObject(contract.grants)) throw new Error("grants must be an object");
  for (const field of ["modalities", "capabilities", "workflows", "autonomy"]) {
    assertUniqueTextArray(contract.grants[field], `grants.${field}`);
  }
  if (!contract.grants.modalities.includes("text")) {
    throw new Error("Every current capability contract must include measured text modality");
  }
  for (const level of contract.grants.autonomy) {
    if (!AUTONOMY_LEVELS.includes(level)) throw new Error(`Unsupported autonomy level: ${level}`);
  }
  assertProgressiveAutonomy(contract.grants.autonomy);
  if (!Array.isArray(contract.failures)) throw new Error("failures must be an array");
  for (const [index, failure] of contract.failures.entries()) {
    assertObjectFields(failure, `failures[${index}]`, ["scenario", "detail"]);
    assertUniqueTextArray(failure.capabilities, `failures[${index}].capabilities`);
  }
  if (contract.status === "qualified" && contract.failures.length > 0) {
    throw new Error("A qualified contract cannot contain failed scenarios");
  }
  if (!plainObject(contract.limits) || !Number.isInteger(contract.limits.contextTokens) ||
      contract.limits.contextTokens < 0) {
    throw new Error("limits.contextTokens must be a non-negative integer");
  }
  if (!plainObject(contract.performance)) throw new Error("performance must be an object");
  const score = Number(contract.performance.score);
  const maximum = Number(contract.performance.maximum);
  const passRate = Number(contract.performance.passRate);
  if (!Number.isFinite(score) || !Number.isFinite(maximum) || score < 0 || maximum < score) {
    throw new Error("performance score is invalid");
  }
  if (!Number.isFinite(passRate) || passRate < 0 || passRate > 1) {
    throw new Error("performance.passRate must be between zero and one");
  }
  requiredText(contract.performance.latencyClass, "performance.latencyClass");
  requiredText(contract.performance.costClass, "performance.costClass");
  return structuredClone(contract);
}

export function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertQualificationReport(report) {
  const supportedSchemas = ["amos.local-model-qualification", "amos.model-qualification"];
  if (!plainObject(report) || !supportedSchemas.includes(report.schema) || report.version !== 1) {
    throw new Error("Expected an AMOS model qualification v1 report");
  }
  if (!Array.isArray(report.results) || report.results.length === 0) {
    throw new Error("Qualification report has no model results");
  }
  normalizeDate(report.created_at);
}

function normalizeScenarios(scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("Model result has no scenarios");
  }
  return scenarios.map((scenario) => {
    if (!plainObject(scenario)) throw new Error("Scenario result must be an object");
    const name = requiredText(scenario.name, "scenario.name");
    const definition = MODEL_CAPABILITY_SUITE.scenarios[name];
    if (!definition) {
      throw new Error(`Unknown capability scenario: ${name}`);
    }
    if (scenario.weight !== definition.weight) {
      throw new Error(`Unexpected weight for capability scenario: ${name}`);
    }
    return { ...scenario, name, passed: scenario.passed === true, weight: definition.weight };
  });
}

function qualificationStatus({ complete, passRate, repetitions, failed }) {
  if (!complete) return "experimental";
  if (passRate < MODEL_CAPABILITY_SUITE.minimumConditionalPassRate) return "unqualified";
  if (failed.length === 0 && repetitions >= MODEL_CAPABILITY_SUITE.minimumQualifiedRepetitions) {
    return "qualified";
  }
  return "conditional";
}

function qualifiedAutonomy(capabilities, status) {
  if (status === "unqualified") return [];
  const available = new Set(capabilities);
  const levels = [];
  for (const level of AUTONOMY_LEVELS) {
    const required = MODEL_CAPABILITY_SUITE.autonomy[level];
    if (!required.every((capability) => available.has(capability))) break;
    levels.push(level);
  }
  return levels;
}

function unionMappedValues(scenarios, field) {
  return [...new Set(scenarios.flatMap((scenario) => mappedValues(scenario.name, field)))].sort();
}

function mappedValues(name, field) {
  return [...(MODEL_CAPABILITY_SUITE.scenarios[name]?.[field] || [])];
}

function inferLatencyClass(tokensPerSecond) {
  const throughput = finiteNumber(tokensPerSecond, 0);
  if (throughput >= 15) return "interactive";
  if (throughput >= 4) return "standard";
  return "background";
}

function assertObjectFields(value, label, fields) {
  if (!plainObject(value)) throw new Error(`${label} must be an object`);
  for (const field of fields) requiredText(value[field], `${label}.${field}`);
}

function assertUniqueTextArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => !cleanText(item))) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
}

function assertProgressiveAutonomy(levels) {
  const indexes = levels.map((level) => AUTONOMY_LEVELS.indexOf(level));
  for (let index = 0; index < indexes.length; index += 1) {
    if (indexes[index] !== index) throw new Error("Autonomy grants must be progressive from observe");
  }
}

function normalizeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Evidence date is invalid");
  return date.toISOString();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function requiredText(value, label) {
  const text = cleanText(value);
  if (!text) throw new Error(`${label} must be a non-empty string`);
  return text;
}

function nullableText(value) {
  return cleanText(value) || null;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
