import { createHash } from "node:crypto";
import { digestResearchValue } from "./experimentProtocol.js";

export const BLIND_COMPARISON_BUNDLE_SCHEMA = "amos.blind-comparison-bundle";
export const BLIND_COMPARISON_MAPPING_SCHEMA = "amos.blind-comparison-mapping";
export const BLIND_COMPARISON_JUDGMENT_SCHEMA = "amos.blind-comparison-judgment";
export const BLIND_COMPARISON_RESULT_SCHEMA = "amos.blind-comparison-result";
export const BLIND_COMPARISON_DIMENSIONS = Object.freeze([
  "correctness",
  "evidenceGrounding",
  "completeness",
  "actionability",
  "calibratedUncertainty",
  "concision"
]);

const MINIMUM_SALT_BYTES = 32;

export function prepareBlindComparison({ reports: inputReports, salt, createdAt }) {
  const reports = validateCompatibleReports(inputReports);
  const saltBytes = normalizeSalt(salt);
  const normalizedCreatedAt = validDate(createdAt ?? new Date().toISOString(), "createdAt");
  const controls = [...reports].sort((left, right) =>
    left.control.id.localeCompare(right.control.id));
  const caseKeys = caseMap(reports[0]).keys();
  const cases = [];
  const mappings = [];

  for (const caseKey of [...caseKeys].sort()) {
    const ordered = controls
      .map((report) => ({
        report,
        item: caseMap(report).get(caseKey),
        blindOrder: blindOrder(saltBytes, caseKey, report.control.id)
      }))
      .sort((left, right) =>
        left.blindOrder.localeCompare(right.blindOrder) ||
        left.report.control.id.localeCompare(right.report.control.id));
    const reference = ordered[0].item.run.mission;
    const candidates = ordered.map(({ item }, index) => ({
      candidateId: candidateId(index),
      answer: item.run.result.answer,
      confidence: item.run.result.confidence,
      unresolvedRisks: [...item.run.result.unresolvedRisks]
    }));
    cases.push({
      caseId: caseKey,
      missionId: reference.id,
      repetition: ordered[0].item.repetition,
      objective: reference.objective,
      context: reference.context,
      successCriteria: [...reference.successCriteria],
      candidates
    });
    mappings.push({
      caseId: caseKey,
      candidates: ordered.map(({ report, item }, index) => ({
        candidateId: candidateId(index),
        controlId: report.control.id,
        sourceReportDigest: report.reportDigest,
        runDigest: item.runDigest
      }))
    });
  }

  const bundle = withDigest({
    schema: BLIND_COMPARISON_BUNDLE_SCHEMA,
    version: 1,
    createdAt: normalizedCreatedAt,
    missionManifestId: reports[0].missionManifestId,
    missionManifestDigest: reports[0].missionManifestDigest,
    dataClassification: reports[0].dataClassification,
    candidateCount: reports.length,
    caseCount: cases.length,
    rubric: {
      scoreMinimum: 1,
      scoreMaximum: 5,
      dimensions: [...BLIND_COMPARISON_DIMENSIONS],
      instructions: [
        "Score every candidate independently on every dimension.",
        "Rank every candidate; express a tie as one ranking group containing multiple candidate IDs.",
        "Judge only the supplied mission evidence and answer. Do not infer candidate identity."
      ]
    },
    cases,
    bundleDigest: null
  }, "bundleDigest");
  const mapping = withDigest({
    schema: BLIND_COMPARISON_MAPPING_SCHEMA,
    version: 1,
    createdAt: normalizedCreatedAt,
    bundleDigest: bundle.bundleDigest,
    saltDigest: createHash("sha256").update(saltBytes).digest("hex"),
    sources: controls.map((report) => ({
      controlId: report.control.id,
      mode: report.control.mode,
      model: report.control.model,
      reportDigest: report.reportDigest
    })),
    cases: mappings,
    mappingDigest: null
  }, "mappingDigest");

  return {
    bundle: validateBlindComparisonBundle(bundle),
    mapping: validateBlindComparisonMapping(mapping, bundle)
  };
}

export function validateBlindComparisonBundle(input) {
  const bundle = clone(input, "Blind comparison bundle");
  exactFields(bundle, "bundle", [
    "schema", "version", "createdAt", "missionManifestId", "missionManifestDigest",
    "dataClassification", "candidateCount", "caseCount", "rubric", "cases", "bundleDigest"
  ]);
  if (bundle.schema !== BLIND_COMPARISON_BUNDLE_SCHEMA || bundle.version !== 1) {
    throw new Error("Unsupported blind comparison bundle schema");
  }
  validDate(bundle.createdAt, "bundle.createdAt");
  requiredText(bundle.missionManifestId, "bundle.missionManifestId");
  sha256(bundle.missionManifestDigest, "bundle.missionManifestDigest");
  requiredText(bundle.dataClassification, "bundle.dataClassification");
  integer(bundle.candidateCount, 2, 26, "bundle.candidateCount");
  integer(bundle.caseCount, 1, 100000, "bundle.caseCount");
  validateRubric(bundle.rubric);
  if (!Array.isArray(bundle.cases) || bundle.cases.length !== bundle.caseCount) {
    throw new Error("bundle.cases must match bundle.caseCount");
  }
  const caseIds = new Set();
  for (const [index, item] of bundle.cases.entries()) {
    const path = `bundle.cases[${index}]`;
    exactFields(item, path, [
      "caseId", "missionId", "repetition", "objective", "context", "successCriteria", "candidates"
    ]);
    const caseId = requiredText(item.caseId, `${path}.caseId`);
    if (caseIds.has(caseId)) throw new Error("bundle.cases contains duplicate case IDs");
    caseIds.add(caseId);
    requiredText(item.missionId, `${path}.missionId`);
    integer(item.repetition, 1, 100000, `${path}.repetition`);
    requiredText(item.objective, `${path}.objective`);
    requiredText(item.context, `${path}.context`);
    nonemptyTextArray(item.successCriteria, `${path}.successCriteria`);
    if (!Array.isArray(item.candidates) || item.candidates.length !== bundle.candidateCount) {
      throw new Error(`${path}.candidates must match bundle.candidateCount`);
    }
    const candidateIds = new Set();
    for (const [candidateIndex, candidate] of item.candidates.entries()) {
      const candidatePath = `${path}.candidates[${candidateIndex}]`;
      exactFields(candidate, candidatePath, [
        "candidateId", "answer", "confidence", "unresolvedRisks"
      ]);
      const id = requiredText(candidate.candidateId, `${candidatePath}.candidateId`);
      if (id !== candidateId(candidateIndex)) {
        throw new Error(`${candidatePath}.candidateId is not canonical`);
      }
      if (candidateIds.has(id)) throw new Error(`${path}.candidates contains duplicates`);
      candidateIds.add(id);
      requiredText(candidate.answer, `${candidatePath}.answer`);
      nullableConfidence(candidate.confidence, `${candidatePath}.confidence`);
      textArray(candidate.unresolvedRisks, `${candidatePath}.unresolvedRisks`);
    }
  }
  verifyEmbeddedDigest(bundle, "bundleDigest", "Blind comparison bundle");
  return bundle;
}

export function validateBlindComparisonMapping(input, inputBundle) {
  const mapping = clone(input, "Blind comparison mapping");
  const bundle = validateBlindComparisonBundle(inputBundle);
  exactFields(mapping, "mapping", [
    "schema", "version", "createdAt", "bundleDigest", "saltDigest", "sources", "cases",
    "mappingDigest"
  ]);
  if (mapping.schema !== BLIND_COMPARISON_MAPPING_SCHEMA || mapping.version !== 1) {
    throw new Error("Unsupported blind comparison mapping schema");
  }
  validDate(mapping.createdAt, "mapping.createdAt");
  if (mapping.createdAt !== bundle.createdAt) {
    throw new Error("Blind comparison mapping timestamp does not match bundle");
  }
  if (mapping.bundleDigest !== bundle.bundleDigest) {
    throw new Error("Blind comparison mapping does not match bundle");
  }
  sha256(mapping.saltDigest, "mapping.saltDigest");
  if (!Array.isArray(mapping.sources) || mapping.sources.length !== bundle.candidateCount) {
    throw new Error("mapping.sources must match bundle.candidateCount");
  }
  const controls = new Set();
  const reports = new Set();
  const reportByControl = new Map();
  for (const [index, source] of mapping.sources.entries()) {
    const path = `mapping.sources[${index}]`;
    exactFields(source, path, ["controlId", "mode", "model", "reportDigest"]);
    const controlId = requiredText(source.controlId, `${path}.controlId`);
    if (controls.has(controlId)) throw new Error("mapping.sources contains duplicate controls");
    controls.add(controlId);
    requiredText(source.mode, `${path}.mode`);
    requiredText(source.model, `${path}.model`);
    sha256(source.reportDigest, `${path}.reportDigest`);
    if (reports.has(source.reportDigest)) throw new Error("mapping.sources contains duplicate reports");
    reports.add(source.reportDigest);
    reportByControl.set(controlId, source.reportDigest);
  }
  if (!Array.isArray(mapping.cases) || mapping.cases.length !== bundle.caseCount) {
    throw new Error("mapping.cases must match bundle.caseCount");
  }
  for (const [index, item] of mapping.cases.entries()) {
    const publicCase = bundle.cases[index];
    const path = `mapping.cases[${index}]`;
    exactFields(item, path, ["caseId", "candidates"]);
    if (item.caseId !== publicCase.caseId) throw new Error(`${path}.caseId does not match bundle`);
    if (!Array.isArray(item.candidates) || item.candidates.length !== bundle.candidateCount) {
      throw new Error(`${path}.candidates must match bundle.candidateCount`);
    }
    const caseControls = new Set();
    for (const [candidateIndex, candidate] of item.candidates.entries()) {
      const publicCandidate = publicCase.candidates[candidateIndex];
      const candidatePath = `${path}.candidates[${candidateIndex}]`;
      exactFields(candidate, candidatePath, [
        "candidateId", "controlId", "sourceReportDigest", "runDigest"
      ]);
      if (candidate.candidateId !== publicCandidate.candidateId) {
        throw new Error(`${candidatePath}.candidateId does not match bundle`);
      }
      if (!controls.has(candidate.controlId)) throw new Error(`${candidatePath}.controlId is unknown`);
      if (caseControls.has(candidate.controlId)) throw new Error(`${path} maps one control more than once`);
      caseControls.add(candidate.controlId);
      if (!reports.has(candidate.sourceReportDigest)) {
        throw new Error(`${candidatePath}.sourceReportDigest is unknown`);
      }
      if (reportByControl.get(candidate.controlId) !== candidate.sourceReportDigest) {
        throw new Error(`${candidatePath} associates a control with the wrong report`);
      }
      sha256(candidate.runDigest, `${candidatePath}.runDigest`);
    }
  }
  verifyEmbeddedDigest(mapping, "mappingDigest", "Blind comparison mapping");
  return mapping;
}

export function validateBlindComparisonJudgment(input, inputBundle) {
  const judgment = clone(input, "Blind comparison judgment");
  const bundle = validateBlindComparisonBundle(inputBundle);
  exactFields(judgment, "judgment", [
    "schema", "version", "bundleDigest", "createdAt", "evaluator", "cases", "judgmentDigest"
  ]);
  if (judgment.schema !== BLIND_COMPARISON_JUDGMENT_SCHEMA || judgment.version !== 1) {
    throw new Error("Unsupported blind comparison judgment schema");
  }
  if (judgment.bundleDigest !== bundle.bundleDigest) {
    throw new Error("Blind comparison judgment does not match bundle");
  }
  validDate(judgment.createdAt, "judgment.createdAt");
  validateEvaluator(judgment.evaluator);
  if (!Array.isArray(judgment.cases) || judgment.cases.length !== bundle.caseCount) {
    throw new Error("judgment.cases must score every bundle case");
  }
  const judgedCases = new Set();
  for (const [index, item] of judgment.cases.entries()) {
    const path = `judgment.cases[${index}]`;
    exactFields(item, path, ["caseId", "scores", "ranking", "notes"]);
    const publicCase = bundle.cases.find((candidate) => candidate.caseId === item.caseId);
    if (!publicCase) throw new Error(`${path}.caseId is unknown`);
    if (judgedCases.has(item.caseId)) throw new Error("judgment.cases contains duplicate cases");
    judgedCases.add(item.caseId);
    const candidateIds = new Set(publicCase.candidates.map((candidate) => candidate.candidateId));
    validateScores(item.scores, candidateIds, path);
    validateRanking(item.ranking, candidateIds, path);
    textArray(item.notes, `${path}.notes`);
  }
  verifyEmbeddedDigest(judgment, "judgmentDigest", "Blind comparison judgment");
  return judgment;
}

export function unmaskBlindComparison({ bundle: inputBundle, mapping: inputMapping,
  judgment: inputJudgment }) {
  const bundle = validateBlindComparisonBundle(inputBundle);
  const mapping = validateBlindComparisonMapping(inputMapping, bundle);
  const judgment = validateBlindComparisonJudgment(inputJudgment, bundle);
  const totals = new Map(mapping.sources.map((source) => [source.controlId, {
    controlId: source.controlId,
    cases: 0,
    firstPlaceCount: 0,
    rankPoints: 0,
    dimensionTotals: Object.fromEntries(BLIND_COMPARISON_DIMENSIONS.map((name) => [name, 0]))
  }]));

  for (const judgedCase of judgment.cases) {
    const caseMapping = mapping.cases.find((item) => item.caseId === judgedCase.caseId);
    const byCandidate = new Map(caseMapping.candidates.map((item) => [item.candidateId, item.controlId]));
    for (const score of judgedCase.scores) {
      const total = totals.get(byCandidate.get(score.candidateId));
      total.cases += 1;
      for (const dimension of BLIND_COMPARISON_DIMENSIONS) {
        total.dimensionTotals[dimension] += score.dimensions[dimension];
      }
    }
    judgedCase.ranking.forEach((group, rankIndex) => {
      for (const candidateId of group) {
        const total = totals.get(byCandidate.get(candidateId));
        if (rankIndex === 0) total.firstPlaceCount += 1;
        total.rankPoints += bundle.candidateCount - rankIndex;
      }
    });
  }

  const controls = [...totals.values()].map((total) => ({
    controlId: total.controlId,
    cases: total.cases,
    firstPlaceCount: total.firstPlaceCount,
    rankPoints: total.rankPoints,
    dimensionMeans: Object.fromEntries(BLIND_COMPARISON_DIMENSIONS.map((dimension) => [
      dimension,
      Number((total.dimensionTotals[dimension] / total.cases).toFixed(6))
    ]))
  })).sort((left, right) => left.controlId.localeCompare(right.controlId));
  return withDigest({
    schema: BLIND_COMPARISON_RESULT_SCHEMA,
    version: 1,
    bundleDigest: bundle.bundleDigest,
    mappingDigest: mapping.mappingDigest,
    judgmentDigest: judgment.judgmentDigest,
    controls,
    resultDigest: null
  }, "resultDigest");
}

export function finalizeBlindComparisonJudgment(input) {
  return withDigest({ ...clone(input, "Blind comparison judgment"), judgmentDigest: null },
    "judgmentDigest");
}

function validateCompatibleReports(inputReports) {
  if (!Array.isArray(inputReports) || inputReports.length < 2 || inputReports.length > 26) {
    throw new Error("Blind comparison requires between two and 26 reports");
  }
  const reports = inputReports.map((input, index) => validateReport(input, index));
  const reference = reports[0];
  const controls = new Set();
  const referenceCases = caseMap(reference);
  for (const report of reports) {
    if (controls.has(report.control.id)) throw new Error("Blind comparison controls must be unique");
    controls.add(report.control.id);
    for (const field of ["configId", "configDigest", "missionManifestId",
      "missionManifestDigest", "dataClassification", "repetitions"]) {
      if (report[field] !== reference[field]) throw new Error(`Reports disagree on ${field}`);
    }
    const cases = caseMap(report);
    if (cases.size !== referenceCases.size) throw new Error("Reports do not contain the same cases");
    for (const [caseKey, referenceItem] of referenceCases) {
      const item = cases.get(caseKey);
      if (!item) throw new Error(`Report is missing case ${caseKey}`);
      if (digestResearchValue(publicMission(item.run.mission)) !==
          digestResearchValue(publicMission(referenceItem.run.mission))) {
        throw new Error(`Reports disagree on mission ${item.missionId}`);
      }
    }
  }
  return reports;
}

function validateReport(input, index) {
  const report = clone(input, `Report ${index + 1}`);
  if (report.schema !== "amos.swarm-experiment-report" || report.version !== 1) {
    throw new Error(`Report ${index + 1} has an unsupported schema`);
  }
  verifyEmbeddedDigest(report, "reportDigest", `Report ${index + 1}`);
  if (report.status !== undefined && report.status !== "completed") {
    throw new Error(`Report ${index + 1} did not complete`);
  }
  requiredText(report.configId, `reports[${index}].configId`);
  sha256(report.configDigest, `reports[${index}].configDigest`);
  requiredText(report.missionManifestId, `reports[${index}].missionManifestId`);
  sha256(report.missionManifestDigest, `reports[${index}].missionManifestDigest`);
  requiredText(report.dataClassification, `reports[${index}].dataClassification`);
  integer(report.repetitions, 1, 100000, `reports[${index}].repetitions`);
  requiredText(report.control?.id, `reports[${index}].control.id`);
  requiredText(report.control?.mode, `reports[${index}].control.mode`);
  requiredText(report.control?.model, `reports[${index}].control.model`);
  if (!Array.isArray(report.runs) || report.runs.length === 0) {
    throw new Error(`Report ${index + 1} has no runs`);
  }
  for (const [runIndex, item] of report.runs.entries()) {
    const path = `reports[${index}].runs[${runIndex}]`;
    requiredText(item.missionId, `${path}.missionId`);
    integer(item.repetition, 1, report.repetitions, `${path}.repetition`);
    sha256(item.runDigest, `${path}.runDigest`);
    if (digestResearchValue(item.run) !== item.runDigest) throw new Error(`${path}.runDigest mismatch`);
    if (item.run?.status !== "completed") throw new Error(`${path} did not complete`);
    if (item.run.controlId !== report.control.id) throw new Error(`${path} belongs to another control`);
    if (item.run.mission?.id !== item.missionId) throw new Error(`${path}.missionId mismatch`);
    publicMission(item.run.mission);
    requiredText(item.run.result?.answer, `${path}.run.result.answer`);
    nullableConfidence(item.run.result?.confidence, `${path}.run.result.confidence`);
    textArray(item.run.result?.unresolvedRisks, `${path}.run.result.unresolvedRisks`);
  }
  caseMap(report);
  return report;
}

function caseMap(report) {
  const cases = new Map();
  for (const item of report.runs) {
    const key = `${item.missionId}::${String(item.repetition).padStart(6, "0")}`;
    if (cases.has(key)) throw new Error(`Report contains duplicate case ${key}`);
    cases.set(key, item);
  }
  return cases;
}

function publicMission(mission) {
  const result = {
    id: requiredText(mission?.id, "mission.id"),
    objective: requiredText(mission?.objective, "mission.objective"),
    context: requiredText(mission?.context, "mission.context"),
    successCriteria: nonemptyTextArray(mission?.successCriteria, "mission.successCriteria")
  };
  return result;
}

function validateRubric(rubric) {
  exactFields(rubric, "bundle.rubric", [
    "scoreMinimum", "scoreMaximum", "dimensions", "instructions"
  ]);
  if (rubric?.scoreMinimum !== 1 || rubric?.scoreMaximum !== 5) {
    throw new Error("bundle.rubric score range must be 1 through 5");
  }
  if (JSON.stringify(rubric.dimensions) !== JSON.stringify(BLIND_COMPARISON_DIMENSIONS)) {
    throw new Error("bundle.rubric dimensions are unsupported");
  }
  nonemptyTextArray(rubric.instructions, "bundle.rubric.instructions");
}

function validateEvaluator(evaluator) {
  exactFields(evaluator, "judgment.evaluator", ["id", "version", "kind"]);
  requiredText(evaluator?.id, "judgment.evaluator.id");
  requiredText(evaluator?.version, "judgment.evaluator.version");
  if (!new Set(["human", "model", "hybrid"]).has(evaluator?.kind)) {
    throw new Error("judgment.evaluator.kind is unsupported");
  }
}

function validateScores(scores, candidateIds, path) {
  if (!Array.isArray(scores) || scores.length !== candidateIds.size) {
    throw new Error(`${path}.scores must score every candidate`);
  }
  const scored = new Set();
  for (const [index, score] of scores.entries()) {
    const scorePath = `${path}.scores[${index}]`;
    exactFields(score, scorePath, ["candidateId", "dimensions"]);
    if (!candidateIds.has(score.candidateId)) throw new Error(`${scorePath}.candidateId is unknown`);
    if (scored.has(score.candidateId)) throw new Error(`${path}.scores contains duplicates`);
    scored.add(score.candidateId);
    const keys = Object.keys(score.dimensions ?? {}).sort();
    const expected = [...BLIND_COMPARISON_DIMENSIONS].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      throw new Error(`${scorePath}.dimensions must contain the exact rubric dimensions`);
    }
    for (const dimension of BLIND_COMPARISON_DIMENSIONS) {
      integer(score.dimensions[dimension], 1, 5, `${scorePath}.dimensions.${dimension}`);
    }
  }
}

function validateRanking(ranking, candidateIds, path) {
  if (!Array.isArray(ranking) || ranking.length === 0) {
    throw new Error(`${path}.ranking must contain at least one rank group`);
  }
  const ranked = new Set();
  for (const [index, group] of ranking.entries()) {
    if (!Array.isArray(group) || group.length === 0) {
      throw new Error(`${path}.ranking[${index}] must be a non-empty candidate group`);
    }
    for (const candidateIdValue of group) {
      if (!candidateIds.has(candidateIdValue)) throw new Error(`${path}.ranking contains unknown candidate`);
      if (ranked.has(candidateIdValue)) throw new Error(`${path}.ranking contains duplicate candidate`);
      ranked.add(candidateIdValue);
    }
  }
  if (ranked.size !== candidateIds.size) throw new Error(`${path}.ranking must include every candidate`);
}

function normalizeSalt(value) {
  const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value ?? "");
  if (bytes.length < MINIMUM_SALT_BYTES) {
    throw new Error(`Blind comparison salt must contain at least ${MINIMUM_SALT_BYTES} bytes`);
  }
  return bytes;
}

function blindOrder(salt, caseKey, controlId) {
  return createHash("sha256")
    .update(salt)
    .update("\0")
    .update(caseKey)
    .update("\0")
    .update(controlId)
    .digest("hex");
}

function candidateId(index) {
  return `candidate-${String.fromCharCode(97 + index)}`;
}

function withDigest(value, field) {
  const result = clone(value, "Digest-bound value");
  result[field] = digestResearchValue({ ...result, [field]: null });
  return result;
}

function verifyEmbeddedDigest(value, field, label) {
  sha256(value?.[field], `${label}.${field}`);
  if (digestResearchValue({ ...value, [field]: null }) !== value[field]) {
    throw new Error(`${label} ${field} mismatch`);
  }
}

function clone(value, label) {
  try {
    return structuredClone(value);
  } catch {
    throw new Error(`${label} must be cloneable`);
  }
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} must be a non-empty string`);
  return text;
}

function nonemptyTextArray(value, label) {
  textArray(value, label);
  if (value.length === 0) throw new Error(`${label} must not be empty`);
  return value;
}

function textArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value;
}

function nullableConfidence(value, label) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(`${label} must be null or a number between zero and one`);
  }
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
}

function validDate(value, label) {
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return date.toISOString();
}

function sha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

function exactFields(value, label, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}
