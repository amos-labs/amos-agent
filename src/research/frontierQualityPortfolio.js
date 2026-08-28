import { digestResearchValue } from "./experimentProtocol.js";

export const FRONTIER_QUALITY_PORTFOLIO_SCHEMA =
  "amos.frontier-quality-portfolio";
export const FRONTIER_QUALITY_PORTFOLIO_VERSION = 1;

const CONTROL_ROLES = new Set(["candidate", "frontier_control"]);
const REGIME_KINDS = new Set(["matched_time", "matched_cost", "unconstrained_quality"]);
const SOURCE_KINDS = new Set(["amos_owned", "external"]);
const TRACK_PHASES = new Set(["contract_floor", "frontier_quality", "safety_floor"]);
const DETERMINISM = new Set(["deterministic", "simulator", "blinded_judge"]);
const EXECUTION_STATUSES = new Set(["ready", "planned"]);

export function validateFrontierQualityPortfolio(input) {
  const portfolio = cloneJson(input);
  exactFields(portfolio, "portfolio", [
    "schema",
    "version",
    "id",
    "status",
    "createdAt",
    "objective",
    "controls",
    "regimes",
    "tracks",
    "promotion"
  ]);
  if (
    portfolio.schema !== FRONTIER_QUALITY_PORTFOLIO_SCHEMA ||
    portfolio.version !== FRONTIER_QUALITY_PORTFOLIO_VERSION
  ) {
    throw new Error("Unsupported frontier quality portfolio schema");
  }
  requiredId(portfolio.id, "portfolio.id");
  if (!new Set(["development", "frozen", "retired"]).has(portfolio.status)) {
    throw new Error("portfolio.status must be development, frozen, or retired");
  }
  validDate(portfolio.createdAt, "portfolio.createdAt");
  requiredText(portfolio.objective, "portfolio.objective");

  array(portfolio.controls, "portfolio.controls", 3);
  const controlIds = uniqueIds(portfolio.controls, "portfolio.controls");
  for (const [index, control] of portfolio.controls.entries()) {
    exactFields(control, `portfolio.controls[${index}]`, [
      "id",
      "role",
      "provider",
      "model",
      "scaffold",
      "pinnedConfigRequired"
    ]);
    if (!CONTROL_ROLES.has(control.role)) {
      throw new Error(`Unsupported control role: ${control.role}`);
    }
    for (const field of ["provider", "model", "scaffold"]) {
      requiredText(control[field], `portfolio.controls[${index}].${field}`);
    }
    requiredBoolean(
      control.pinnedConfigRequired,
      `portfolio.controls[${index}].pinnedConfigRequired`
    );
  }
  if (!portfolio.controls.some((control) => control.role === "frontier_control")) {
    throw new Error("At least one frontier control is required");
  }

  array(portfolio.regimes, "portfolio.regimes", 3);
  const regimeIds = uniqueIds(portfolio.regimes, "portfolio.regimes");
  const regimeKinds = new Set();
  for (const [index, regime] of portfolio.regimes.entries()) {
    exactFields(regime, `portfolio.regimes[${index}]`, [
      "id",
      "kind",
      "budgetDimension",
      "required"
    ]);
    if (!REGIME_KINDS.has(regime.kind)) {
      throw new Error(`Unsupported evaluation regime: ${regime.kind}`);
    }
    regimeKinds.add(regime.kind);
    if (regime.budgetDimension !== null) {
      requiredId(regime.budgetDimension, `portfolio.regimes[${index}].budgetDimension`);
    }
    requiredBoolean(regime.required, `portfolio.regimes[${index}].required`);
  }
  for (const kind of REGIME_KINDS) {
    if (!regimeKinds.has(kind)) throw new Error(`Missing evaluation regime: ${kind}`);
  }

  array(portfolio.tracks, "portfolio.tracks", 1);
  uniqueIds(portfolio.tracks, "portfolio.tracks");
  for (const [index, track] of portfolio.tracks.entries()) {
    exactFields(track, `portfolio.tracks[${index}]`, [
      "id",
      "category",
      "phase",
      "source",
      "adapter",
      "primaryMetric",
      "determinism",
      "executionStatus",
      "required",
      "countsTowardFrontierWin"
    ]);
    requiredText(track.category, `portfolio.tracks[${index}].category`);
    if (!TRACK_PHASES.has(track.phase)) {
      throw new Error(`Unsupported track phase: ${track.phase}`);
    }
    requiredId(track.adapter, `portfolio.tracks[${index}].adapter`);
    requiredId(track.primaryMetric, `portfolio.tracks[${index}].primaryMetric`);
    if (!DETERMINISM.has(track.determinism)) {
      throw new Error(`Unsupported track determinism: ${track.determinism}`);
    }
    if (!EXECUTION_STATUSES.has(track.executionStatus)) {
      throw new Error(`Unsupported track execution status: ${track.executionStatus}`);
    }
    requiredBoolean(track.required, `portfolio.tracks[${index}].required`);
    requiredBoolean(
      track.countsTowardFrontierWin,
      `portfolio.tracks[${index}].countsTowardFrontierWin`
    );
    validateSource(track.source, `portfolio.tracks[${index}].source`);
    if (portfolio.status === "frozen" && track.required && track.executionStatus !== "ready") {
      throw new Error("A frozen portfolio cannot contain planned required tracks");
    }
  }

  const frontierTracks = portfolio.tracks.filter(
    (track) => track.required && track.countsTowardFrontierWin
  );
  if (frontierTracks.length < 6) {
    throw new Error("The frontier claim requires at least six required quality tracks");
  }
  if (!frontierTracks.some((track) => track.source.timeSeparated)) {
    throw new Error("The frontier claim requires a time-separated contamination control");
  }
  if (!portfolio.tracks.some((track) => track.phase === "contract_floor" && track.required)) {
    throw new Error("A required production contract floor is missing");
  }
  if (!portfolio.tracks.some((track) => track.phase === "safety_floor" && track.required)) {
    throw new Error("A required safety floor is missing");
  }

  validatePromotion(portfolio.promotion, {
    controlIds,
    regimeIds,
    frontierTrackCount: frontierTracks.length
  });
  return portfolio;
}

export function frontierQualityPortfolioDigest(input) {
  return digestResearchValue(validateFrontierQualityPortfolio(input));
}

function validateSource(source, path) {
  exactFields(source, path, [
    "kind",
    "repository",
    "version",
    "license",
    "timeSeparated",
    "pinRequiredBeforeRun"
  ]);
  if (!SOURCE_KINDS.has(source.kind)) {
    throw new Error(`Unsupported benchmark source kind: ${source.kind}`);
  }
  if (source.repository !== null) {
    const repository = requiredText(source.repository, `${path}.repository`);
    if (source.kind === "external" && !repository.startsWith("https://")) {
      throw new Error(`${path}.repository must use https`);
    }
  }
  requiredText(source.version, `${path}.version`);
  requiredText(source.license, `${path}.license`);
  requiredBoolean(source.timeSeparated, `${path}.timeSeparated`);
  requiredBoolean(source.pinRequiredBeforeRun, `${path}.pinRequiredBeforeRun`);
}

function validatePromotion(promotion, { controlIds, regimeIds, frontierTrackCount }) {
  exactFields(promotion, "portfolio.promotion", [
    "frontierControlId",
    "primaryRegimeId",
    "minimumTrackWins",
    "maximumSignificantTrackLosses",
    "confidenceLevel",
    "minimumRepetitions",
    "contractFloor",
    "safetyFloor",
    "matchedRegimeIds",
    "requireBlindJudging",
    "requireIndependentReproduction",
    "prohibitCompositeMasking"
  ]);
  requiredId(promotion.frontierControlId, "portfolio.promotion.frontierControlId");
  if (!controlIds.has(promotion.frontierControlId)) {
    throw new Error("promotion.frontierControlId must reference a declared control");
  }
  requiredId(promotion.primaryRegimeId, "portfolio.promotion.primaryRegimeId");
  if (!regimeIds.has(promotion.primaryRegimeId)) {
    throw new Error("promotion.primaryRegimeId must reference a declared regime");
  }
  positiveInteger(promotion.minimumTrackWins, "portfolio.promotion.minimumTrackWins");
  if (promotion.minimumTrackWins > frontierTrackCount) {
    throw new Error("promotion.minimumTrackWins exceeds the frontier track count");
  }
  nonNegativeInteger(
    promotion.maximumSignificantTrackLosses,
    "portfolio.promotion.maximumSignificantTrackLosses"
  );
  if (
    typeof promotion.confidenceLevel !== "number" ||
    promotion.confidenceLevel < 0.9 ||
    promotion.confidenceLevel >= 1
  ) {
    throw new Error("promotion.confidenceLevel must be at least 0.9 and below 1");
  }
  positiveInteger(promotion.minimumRepetitions, "portfolio.promotion.minimumRepetitions");
  requiredText(promotion.contractFloor, "portfolio.promotion.contractFloor");
  requiredText(promotion.safetyFloor, "portfolio.promotion.safetyFloor");
  array(promotion.matchedRegimeIds, "portfolio.promotion.matchedRegimeIds", 0);
  const matched = new Set(promotion.matchedRegimeIds);
  if (matched.size !== promotion.matchedRegimeIds.length) {
    throw new Error("promotion.matchedRegimeIds must be unique");
  }
  for (const regimeId of matched) {
    if (!regimeIds.has(regimeId)) {
      throw new Error(`Unknown matched evaluation regime: ${regimeId}`);
    }
  }
  for (const field of [
    "requireBlindJudging",
    "requireIndependentReproduction",
    "prohibitCompositeMasking"
  ]) {
    if (promotion[field] !== true) {
      throw new Error(`portfolio.promotion.${field} must be true`);
    }
  }
}

function cloneJson(value) {
  try {
    return structuredClone(value);
  } catch {
    throw new Error("Portfolio must be JSON-compatible");
  }
}

function exactFields(value, path, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.join("\n") !== expected.join("\n")) {
    throw new Error(`${path} fields must be exactly: ${fields.join(", ")}`);
  }
}

function uniqueIds(values, path) {
  const ids = new Set();
  for (const [index, value] of values.entries()) {
    requiredId(value?.id, `${path}[${index}].id`);
    if (ids.has(value.id)) throw new Error(`Duplicate id in ${path}: ${value.id}`);
    ids.add(value.id);
  }
  return ids;
}

function array(value, path, minimum) {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new Error(`${path} must contain at least ${minimum} entries`);
  }
}

function requiredText(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be non-empty text`);
  }
  return value.trim();
}

function requiredId(value, path) {
  const id = requiredText(value, path);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error(`${path} is invalid`);
  return id;
}

function requiredBoolean(value, path) {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
}

function validDate(value, path) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path} must be an ISO date`);
  }
}

function positiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${path} must be a positive integer`);
}

function nonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
}
