import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { digestResearchValue } from "./experimentProtocol.js";

export const AMOS_SYSTEM_TRAINING_EXAMPLE_SCHEMA = "amos.system-training-example";
export const AMOS_NATIVE_DATASET_SCHEMA = "amos.native-qwen-dataset";
export const AMOS_NATIVE_DATASET_VERSION = 1;

const TARGET_KINDS = new Set([
  "tool-call",
  "typed-artifact",
  "recovery-transition",
  "approval-boundary",
  "state-transition",
  "verified-synthesis"
]);

export function createAmosSystemTrainingExample(input) {
  const source = jsonObject(input, "training example");
  const example = {
    schema: AMOS_SYSTEM_TRAINING_EXAMPLE_SCHEMA,
    version: AMOS_NATIVE_DATASET_VERSION,
    id: requiredId(source.id, "training example.id"),
    sourceEpisodeId: requiredId(
      source.sourceEpisodeId,
      "training example.sourceEpisodeId"
    ),
    taskFamily: requiredId(source.taskFamily, "training example.taskFamily"),
    role: requiredId(source.role, "training example.role"),
    input: {
      system: requiredText(source.input?.system, "training example.input.system", 100_000),
      user: requiredText(source.input?.user, "training example.input.user", 100_000)
    },
    target: {
      kind: enumValue(source.target?.kind, TARGET_KINDS, "training example.target.kind"),
      content: requiredText(
        source.target?.content,
        "training example.target.content",
        100_000
      )
    },
    correction: normalizeCorrection(source.correction),
    safeguards: normalizeSafeguards(source.safeguards)
  };
  return { ...example, digest: digestResearchValue(example) };
}

export function validateAmosSystemTrainingExample(input) {
  const candidate = jsonObject(input, "training example");
  const expected = createAmosSystemTrainingExample(candidate);
  if (candidate.schema !== AMOS_SYSTEM_TRAINING_EXAMPLE_SCHEMA) {
    throw new Error(`training example.schema must be ${AMOS_SYSTEM_TRAINING_EXAMPLE_SCHEMA}`);
  }
  if (candidate.version !== AMOS_NATIVE_DATASET_VERSION) {
    throw new Error(`training example.version must be ${AMOS_NATIVE_DATASET_VERSION}`);
  }
  if (candidate.digest !== expected.digest) {
    throw new Error("AMOS system training example digest does not match its contents");
  }
  return expected;
}

export async function compileAmosNativeTrainingDataset({
  store,
  plan,
  minimums = null
}) {
  if (!store || typeof store.listEpisodes !== "function" || typeof store.readBlob !== "function") {
    throw new Error("An open swarm learning store is required");
  }
  const trainingPlan = normalizePlan(plan, minimums);
  const episodes = (await store.listEpisodes())
    .filter((episode) => episode.trainingEligibility.eligible)
    .filter((episode) => episode.dataPolicy.trainingApproved)
    .filter((episode) => episode.dataPolicy.permittedUses.includes("training"))
    .sort((left, right) => left.id.localeCompare(right.id));

  const examples = [];
  const sourceEpisodes = new Map();
  for (const episode of episodes) {
    const references = episode.traces
      .filter(({ kind, status, digest }) =>
        kind === "amos-system-training-example" && status === "collected" && digest
      )
      .sort((left, right) => left.digest.localeCompare(right.digest));
    for (const reference of references) {
      const parsed = JSON.parse((await store.readBlob(reference.digest)).toString("utf8"));
      const example = validateAmosSystemTrainingExample(parsed);
      if (example.sourceEpisodeId !== episode.id) {
        throw new Error(
          `Training example ${example.id} belongs to ${example.sourceEpisodeId}, not ${episode.id}`
        );
      }
      examples.push(example);
      sourceEpisodes.set(episode.digest, episode);
    }
  }

  const uniqueExamples = deduplicateExamples(examples);
  const splits = splitByMissionFamily(uniqueExamples);
  const files = buildDatasetFiles(splits);
  const counts = {
    episodes: sourceEpisodes.size,
    publicBenchmarkEpisodes: [...sourceEpisodes.values()]
      .filter((episode) => episode.dataPolicy.sourceClass === "public-benchmark").length,
    taskFamilies: new Set(uniqueExamples.map(({ taskFamily }) => taskFamily)).size,
    examples: uniqueExamples.length,
    trainingExamples: splits.training.length,
    validationExamples: splits.validation.length,
    holdoutExamples: splits.holdout.length,
    preferencePairs: uniqueExamples.filter(({ correction }) => correction !== null).length
  };
  const blockers = qualificationBlockers(counts, trainingPlan.minimums);
  const manifestBase = {
    schema: AMOS_NATIVE_DATASET_SCHEMA,
    version: AMOS_NATIVE_DATASET_VERSION,
    planId: trainingPlan.id,
    status: blockers.length === 0 ? "qualified" : "blocked",
    baseModel: trainingPlan.baseModel,
    sourceEpisodeDigests: [...sourceEpisodes.keys()].sort(),
    sourceExampleDigests: uniqueExamples.map(({ digest }) => digest).sort(),
    counts,
    minimums: trainingPlan.minimums,
    blockers,
    evaluationExclusions: [...new Set([...sourceEpisodes.values()].flatMap((episode) =>
      episode.dataPolicy.contaminationTags.filter((tag) => tag.startsWith("exclude-eval:"))
    ))].sort(),
    splitUnit: "mission-family",
    files: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, {
      path: file.path,
      sha256: file.sha256,
      rows: file.rows
    }])),
    safeguards: {
      publicBenchmarksExcluded: counts.publicBenchmarkEpisodes === 0,
      publicBenchmarkTrainingRequiresTaskLevelLicense: true,
      publicBenchmarkEvaluationReuseForbidden: true,
      trainingApprovalRequired: true,
      hiddenReasoningExcluded: true,
      credentialsExcluded: true,
      tenantFactsExcluded: true,
      sourceSplitsDisjointByMissionFamily: true
    }
  };
  const manifest = { ...manifestBase, digest: digestResearchValue(manifestBase) };
  return {
    ready: blockers.length === 0,
    manifest,
    contents: Object.fromEntries(
      Object.entries(files).map(([name, file]) => [name, file.contents])
    )
  };
}

export async function writeAmosNativeTrainingDataset(outputPath, dataset) {
  if (!dataset?.ready) throw new Error("An unqualified AMOS-native dataset cannot be written");
  const output = resolve(outputPath);
  await mkdir(output, { recursive: true, mode: 0o700 });
  for (const [name, contents] of Object.entries(dataset.contents)) {
    const expected = dataset.manifest.files[name];
    if (!expected || sha256(contents) !== expected.sha256) {
      throw new Error(`Dataset file ${name} does not match its manifest`);
    }
    await writeImmutable(join(output, expected.path), contents);
  }
  await writeImmutable(
    join(output, "dataset-manifest.json"),
    `${JSON.stringify(dataset.manifest, null, 2)}\n`
  );
  const stored = JSON.parse(await readFile(join(output, "dataset-manifest.json"), "utf8"));
  if (stored.digest !== dataset.manifest.digest) {
    throw new Error("Stored AMOS-native dataset manifest failed verification");
  }
  return { output, manifest: stored };
}

function normalizeCorrection(input) {
  if (input === null || input === undefined) return null;
  const correction = jsonObject(input, "training example.correction");
  return {
    rejectedContent: requiredText(
      correction.rejectedContent,
      "training example.correction.rejectedContent",
      100_000
    ),
    verifierSignal: requiredText(
      correction.verifierSignal,
      "training example.correction.verifierSignal",
      20_000
    )
  };
}

function normalizeSafeguards(input) {
  const safeguards = jsonObject(input, "training example.safeguards");
  const normalized = {
    credentialsRemoved: safeguards.credentialsRemoved === true,
    tenantFactsRemoved: safeguards.tenantFactsRemoved === true,
    hiddenReasoningExcluded: safeguards.hiddenReasoningExcluded === true,
    independentVerifierSelected: safeguards.independentVerifierSelected === true,
    licensedForTraining: safeguards.licensedForTraining === true
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (!value) throw new Error(`training example.safeguards.${key} must be true`);
  }
  return normalized;
}

function normalizePlan(plan, overrides) {
  const value = jsonObject(plan, "adapter training plan");
  if (value.schema !== "amos.swarm-substrate-adapter-training") {
    throw new Error("Unsupported AMOS-native adapter training plan");
  }
  const planMinimums = {
    trainingExamples: boundedInteger(
      value.data?.minimumTrainingEpisodes,
      "minimumTrainingEpisodes"
    ),
    validationExamples: boundedInteger(
      value.data?.minimumValidationEpisodes,
      "minimumValidationEpisodes"
    ),
    holdoutExamples: boundedInteger(
      value.data?.minimumHoldoutEpisodes,
      "minimumHoldoutEpisodes"
    ),
    taskFamilies: boundedInteger(value.data?.minimumTaskFamilies, "minimumTaskFamilies")
  };
  const minimumValues = overrides ? { ...planMinimums, ...overrides } : planMinimums;
  for (const [key, value] of Object.entries(minimumValues)) {
    minimumValues[key] = boundedInteger(value, `minimums.${key}`);
  }
  return {
    id: requiredId(value.id, "adapter training plan.id"),
    baseModel: requiredText(value.base?.model, "adapter training plan.base.model", 1_000),
    minimums: minimumValues
  };
}

function deduplicateExamples(examples) {
  const byDigest = new Map();
  const byId = new Map();
  for (const example of examples) {
    if (byId.has(example.id) && byId.get(example.id) !== example.digest) {
      throw new Error(`Training example id ${example.id} has conflicting contents`);
    }
    byId.set(example.id, example.digest);
    byDigest.set(example.digest, example);
  }
  return [...byDigest.values()].sort((left, right) => left.digest.localeCompare(right.digest));
}

function splitByMissionFamily(examples) {
  const families = new Map();
  for (const example of examples) {
    const family = families.get(example.taskFamily) || [];
    family.push(example);
    families.set(example.taskFamily, family);
  }
  const ordered = [...families.entries()].sort(([left], [right]) =>
    sha256(left).localeCompare(sha256(right))
  );
  const trainingFamilyCount = ordered.length < 3
    ? ordered.length
    : Math.max(1, Math.floor(ordered.length * 0.6));
  const validationFamilyCount = ordered.length < 3
    ? 0
    : Math.max(1, Math.floor(ordered.length * 0.2));
  const splits = { training: [], validation: [], holdout: [] };
  for (const [index, [, familyExamples]] of ordered.entries()) {
    const split = index < trainingFamilyCount
      ? "training"
      : index < trainingFamilyCount + validationFamilyCount
        ? "validation"
        : "holdout";
    splits[split].push(...familyExamples);
  }
  for (const values of Object.values(splits)) {
    values.sort((left, right) => left.digest.localeCompare(right.digest));
  }
  return splits;
}

function buildDatasetFiles(splits) {
  const files = {};
  for (const [split, examples] of Object.entries(splits)) {
    const rows = examples.map(sftRow);
    const contents = jsonLines(rows);
    files[`${split}Sft`] = {
      path: `${split}.sft.jsonl`,
      rows: rows.length,
      contents,
      sha256: sha256(contents)
    };
    const preferenceRows = examples.filter(({ correction }) => correction).map(preferenceRow);
    const preferenceContents = jsonLines(preferenceRows);
    files[`${split}Preference`] = {
      path: `${split}.preference.jsonl`,
      rows: preferenceRows.length,
      contents: preferenceContents,
      sha256: sha256(preferenceContents)
    };
  }
  return files;
}

function sftRow(example) {
  return {
    messages: [
      { role: "system", content: example.input.system },
      { role: "user", content: example.input.user },
      { role: "assistant", content: example.target.content }
    ],
    metadata: {
      exampleId: example.id,
      exampleDigest: example.digest,
      sourceEpisodeId: example.sourceEpisodeId,
      taskFamily: example.taskFamily,
      role: example.role,
      targetKind: example.target.kind
    }
  };
}

function preferenceRow(example) {
  return {
    prompt: [
      { role: "system", content: example.input.system },
      { role: "user", content: example.input.user }
    ],
    chosen: [{ role: "assistant", content: example.target.content }],
    rejected: [{ role: "assistant", content: example.correction.rejectedContent }],
    metadata: {
      exampleId: example.id,
      exampleDigest: example.digest,
      verifierSignal: example.correction.verifierSignal
    }
  };
}

function qualificationBlockers(counts, minimums) {
  const blockers = [];
  for (const split of ["training", "validation", "holdout"]) {
    const countKey = `${split}Examples`;
    if (counts[countKey] < minimums[countKey]) {
      blockers.push(`${split}-examples:${counts[countKey]}/${minimums[countKey]}`);
    }
  }
  if (counts.taskFamilies < minimums.taskFamilies) {
    blockers.push(`task-families:${counts.taskFamilies}/${minimums.taskFamilies}`);
  }
  return blockers;
}

function jsonLines(rows) {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeImmutable(path, contents) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await readFile(path, "utf8") !== contents) {
      throw new Error(`Immutable AMOS-native training artifact differs: ${path}`);
    }
  } finally {
    await handle?.close();
  }
}

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value);
}

function requiredId(value, label) {
  const id = requiredText(value, label, 500);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
}

function requiredText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function enumValue(value, values, label) {
  if (!values.has(value)) throw new Error(`${label} is unsupported`);
  return value;
}

function boundedInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 1_000_000) {
    throw new Error(`${label} must be an integer from 0 to 1000000`);
  }
  return number;
}
