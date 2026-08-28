import { validateSwarmBudget } from "./swarmExperiment.js";

export const SWARM_EXPERIMENT_CONFIG_SCHEMA = "amos.swarm-experiment-config";
export const SWARM_DEVELOPMENT_MISSIONS_SCHEMA = "amos.swarm-development-missions";

export function validateSwarmExperimentConfig(input) {
  const config = clone(input, "Swarm experiment config");
  if (config.schema !== SWARM_EXPERIMENT_CONFIG_SCHEMA || config.version !== 1) {
    throw new Error("Unsupported swarm experiment config schema");
  }
  requiredText(config.id, "config.id");
  if (config.status !== "development") throw new Error("Swarm v0 config must remain development");
  requiredText(config.portfolioId, "config.portfolioId");
  if (!Array.isArray(config.controls) || config.controls.length !== 3) {
    throw new Error("Swarm v0 requires exactly three controls");
  }
  const ids = new Set();
  for (const [index, control] of config.controls.entries()) {
    const path = `config.controls[${index}]`;
    const id = requiredText(control.id, `${path}.id`);
    if (ids.has(id)) throw new Error("Swarm control IDs must be unique");
    ids.add(id);
    if (!["direct", "swarm"].includes(control.mode)) throw new Error(`${path}.mode is unsupported`);
    requiredText(control.model, `${path}.model`);
    if (!["generic", "qwen"].includes(control.dialect)) throw new Error(`${path}.dialect is unsupported`);
    if (control.reasoningEffort !== null) requiredText(control.reasoningEffort, `${path}.reasoningEffort`);
    requiredText(control.endpointEnv, `${path}.endpointEnv`);
    const endpoint = new URL(control.defaultEndpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error(`${path}.defaultEndpoint is invalid`);
    if (control.apiKeyEnv !== null) requiredText(control.apiKeyEnv, `${path}.apiKeyEnv`);
  }
  for (const expected of ["qwen-direct", "qwen-swarm"]) {
    if (!ids.has(expected)) throw new Error(`Missing required swarm control: ${expected}`);
  }
  const frontierControls = config.controls.filter((control) =>
    !["qwen-direct", "qwen-swarm"].includes(control.id));
  if (frontierControls.length !== 1 || frontierControls[0].mode !== "direct" ||
      frontierControls[0].dialect !== "generic") {
    throw new Error("Swarm v0 requires exactly one generic direct frontier control");
  }
  validateSwarmBudget(config.budget);
  const required = config.comparison?.requiredControlIds;
  if (!Array.isArray(required) || required.length !== ids.size || required.some((id) => !ids.has(id))) {
    throw new Error("comparison.requiredControlIds must include every control");
  }
  if (config.comparison.blindJudgeRequired !== true) {
    throw new Error("Swarm comparison requires blind judging");
  }
  integer(config.comparison.minimumRepetitions, 3, 100, "comparison.minimumRepetitions");
  return config;
}

export function validateSwarmDevelopmentMissions(input) {
  const manifest = clone(input, "Swarm development missions");
  if (manifest.schema !== SWARM_DEVELOPMENT_MISSIONS_SCHEMA || manifest.version !== 1) {
    throw new Error("Unsupported swarm development mission schema");
  }
  requiredText(manifest.id, "missions.id");
  if (manifest.dataClassification !== "development-visible") {
    throw new Error("Swarm v0 missions must be labeled development-visible");
  }
  if (!Array.isArray(manifest.missions) || manifest.missions.length < 3) {
    throw new Error("Swarm v0 requires at least three development missions");
  }
  const ids = new Set();
  for (const [index, mission] of manifest.missions.entries()) {
    const path = `missions.missions[${index}]`;
    const id = requiredText(mission.id, `${path}.id`);
    if (ids.has(id)) throw new Error("Development mission IDs must be unique");
    ids.add(id);
    requiredText(mission.objective, `${path}.objective`);
    requiredText(mission.context, `${path}.context`);
    if (!Array.isArray(mission.successCriteria) || mission.successCriteria.length < 2) {
      throw new Error(`${path}.successCriteria requires at least two criteria`);
    }
    mission.successCriteria.forEach((criterion, criterionIndex) =>
      requiredText(criterion, `${path}.successCriteria[${criterionIndex}]`));
  }
  return manifest;
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

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
