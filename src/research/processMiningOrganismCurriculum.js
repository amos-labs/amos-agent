import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { digestResearchValue } from "./experimentProtocol.js";

export const PROCESS_MINING_CURRICULUM_SCHEMA = "amos.process-mining-organism-curriculum";
export const PROCESS_MINING_CURRICULUM_VERSION = 1;

const REQUIRED_COLUMNS = [
  "Case ID",
  "Event Name",
  "Timestamp",
  "Payment Status",
  "Payment Method"
];

const ROLE_BY_EVENT = Object.freeze({
  "Receive Invoice": "interface-scanner",
  "Digitize Invoice": "data-scanner",
  "Verify Info": "state-compiler",
  "Send Invoice to ERP": "state-compiler",
  "Match Invoice": "solver-builder",
  "Dispute Invoice": "skeptic-verifier",
  "Resolve Dispute": "skeptic-verifier",
  "Approve Invoice": "governed-operator",
  "Apply Early Payment Discount": "governed-operator",
  "Process Payment": "governed-operator",
  "Archive Invoice": "evidence-synthesist"
});

const AGENTS = Object.freeze([
  { id: "interface-agent", specialties: ["interface-scanner"] },
  { id: "data-agent", specialties: ["data-scanner"] },
  { id: "state-agent", specialties: ["state-compiler"] },
  { id: "solver-agent", specialties: ["solver-builder"] },
  { id: "skeptic-agent", specialties: ["skeptic-verifier"] },
  { id: "operator-agent", specialties: ["governed-operator"] },
  { id: "evidence-agent", specialties: ["evidence-synthesist"] }
]);

export async function compileProcessMiningOrganismCurriculum({
  csvPath,
  sourceId,
  sourceDigest,
  authorizedForInternalTraining = false,
  maximumCases = { training: 2_000, validation: 500, holdout: 500 }
}) {
  if (authorizedForInternalTraining !== true) {
    throw new Error("Process-mining curriculum requires explicit internal-training authorization");
  }
  const cases = await readCases(csvPath);
  const variantEntries = buildVariantPartitions(cases);
  const partitionByVariant = new Map(variantEntries.map(({ digest, partition }) => [digest, partition]));
  const selected = { training: [], validation: [], holdout: [] };
  for (const processCase of cases.values()) {
    processCase.events.sort((left, right) => left.timestamp - right.timestamp);
    const eventNames = processCase.events.map(({ name }) => name);
    const variantDigest = digestResearchValue(eventNames);
    const partition = partitionByVariant.get(variantDigest);
    selected[partition].push({
      orderingDigest: digestResearchValue({ sourceDigest, caseId: processCase.id }),
      processCase,
      eventNames,
      variantDigest
    });
  }
  const partitions = {};
  for (const partition of ["training", "validation", "holdout"]) {
    const limit = boundedInteger(maximumCases[partition], 1, 100_000, `maximumCases.${partition}`);
    partitions[partition] = selected[partition]
      .sort((left, right) => left.orderingDigest.localeCompare(right.orderingDigest))
      .slice(0, limit)
      .map(({ processCase, eventNames, variantDigest, orderingDigest }) =>
        scenarioFromCase({ processCase, eventNames, variantDigest, orderingDigest })
      );
  }
  const curriculum = {
    schema: PROCESS_MINING_CURRICULUM_SCHEMA,
    version: PROCESS_MINING_CURRICULUM_VERSION,
    source: {
      id: requiredId(sourceId, "sourceId"),
      digest: requiredDigest(sourceDigest, "sourceDigest"),
      rawDataIncluded: false,
      usage: "internal-organism-policy-research-and-training",
      redistributionAllowed: false
    },
    split: {
      unit: "complete-process-variant",
      leakageRule: "a process variant appears in exactly one partition",
      variants: variantEntries,
      caseCounts: Object.fromEntries(
        Object.entries(partitions).map(([partition, scenarios]) => [partition, scenarios.length])
      )
    },
    partitions,
    verifierContract: {
      exactSequenceDigest: true,
      reworkCount: true,
      disputePath: true,
      earlyPaymentPath: true,
      finalArchiveRequired: true
    }
  };
  return { ...curriculum, digest: digestResearchValue(curriculum) };
}

async function readCases(csvPath) {
  const rows = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
  let columns = null;
  const cases = new Map();
  for await (const line of rows) {
    if (!line.trim()) continue;
    const values = parseDelimitedLine(line);
    if (columns === null) {
      columns = new Map(values.map((name, index) => [name, index]));
      for (const column of REQUIRED_COLUMNS) {
        if (!columns.has(column)) throw new Error(`Process log is missing ${column}`);
      }
      continue;
    }
    const caseId = requiredText(values[columns.get("Case ID")], "Case ID");
    const eventName = requiredText(values[columns.get("Event Name")], "Event Name");
    if (!Object.hasOwn(ROLE_BY_EVENT, eventName)) {
      throw new Error(`Unsupported process event ${eventName}`);
    }
    const processCase = cases.get(caseId) || { id: caseId, events: [] };
    processCase.events.push({
      name: eventName,
      timestamp: parseTimestamp(values[columns.get("Timestamp")]),
      paymentStatus: requiredText(values[columns.get("Payment Status")], "Payment Status"),
      paymentMethod: requiredText(values[columns.get("Payment Method")], "Payment Method")
    });
    cases.set(caseId, processCase);
  }
  if (cases.size === 0) throw new Error("Process log contains no cases");
  return cases;
}

function buildVariantPartitions(cases) {
  const variants = new Map();
  for (const processCase of cases.values()) {
    processCase.events.sort((left, right) => left.timestamp - right.timestamp);
    const names = processCase.events.map(({ name }) => name);
    const digest = digestResearchValue(names);
    variants.set(digest, (variants.get(digest) || 0) + 1);
  }
  if (variants.size < 3) {
    throw new Error("Variant-level training, validation, and holdout require at least three variants");
  }
  const ranked = [...variants.entries()].sort(([left], [right]) => left.localeCompare(right));
  const trainingCount = Math.max(1, Math.floor(ranked.length * 0.7));
  const validationCount = Math.max(1, Math.floor(ranked.length * 0.2));
  return ranked.map(([digest, caseCount], index) => ({
    digest,
    caseCount,
    partition: index < trainingCount
      ? "training"
      : index < trainingCount + validationCount
        ? "validation"
        : "holdout"
  }));
}

function scenarioFromCase({ processCase, eventNames, variantDigest, orderingDigest }) {
  const seen = new Map();
  const phases = processCase.events.map((event, index) => {
    const occurrence = (seen.get(event.name) || 0) + 1;
    seen.set(event.name, occurrence);
    const repeated = occurrence > 1;
    return {
      id: `phase-${String(index + 1).padStart(2, "0")}`,
      role: ROLE_BY_EVENT[event.name],
      difficulty: Math.min(0.95, 0.42 + (repeated ? 0.18 : 0) +
        (["Dispute Invoice", "Resolve Dispute"].includes(event.name) ? 0.12 : 0)),
      artifactRisk: ["Digitize Invoice", "Match Invoice", "Send Invoice to ERP"].includes(event.name)
        ? 0.12
        : 0.04,
      contextRisk: eventNames.length > 9 ? 0.1 : 0.04,
      providerRisk: 0.02
    };
  });
  const uniqueEvents = new Set(eventNames);
  return {
    id: `ap-${orderingDigest.slice(0, 20)}`,
    phases,
    agents: structuredClone(AGENTS),
    processSignals: {
      variantDigest,
      eventSequenceDigest: digestResearchValue(eventNames),
      eventCount: eventNames.length,
      reworkCount: eventNames.length - uniqueEvents.size,
      disputePath: uniqueEvents.has("Dispute Invoice"),
      earlyPaymentPath: uniqueEvents.has("Apply Early Payment Discount"),
      finalArchivePresent: eventNames.at(-1) === "Archive Invoice",
      paymentStatus: processCase.events.at(-1).paymentStatus,
      paymentMethod: processCase.events.at(-1).paymentMethod
    }
  };
}

function parseDelimitedLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ";" && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("Process log contains an unterminated quoted field");
  fields.push(value.replace(/\r$/, ""));
  return fields;
}

function parseTimestamp(value) {
  const match = String(value ?? "").trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/
  );
  if (!match) throw new Error(`Unsupported process timestamp ${value}`);
  const [, day, month, year, hour, minute] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} must not be empty`);
  return text;
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new Error(`${label} is invalid`);
  return id;
}

function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} must be a SHA-256 digest`);
  return digest;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
