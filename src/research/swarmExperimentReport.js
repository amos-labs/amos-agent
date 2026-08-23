import { digestResearchValue } from "./experimentProtocol.js";

export const SWARM_EXPERIMENT_REPORT_STATUSES = Object.freeze([
  "completed",
  "failed"
]);

export function swarmExperimentFailure(error, {
  missionId,
  repetition,
  failedAt = new Date().toISOString()
} = {}) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    failedAt: validDate(failedAt, "failedAt"),
    missionId: requiredText(missionId, "missionId"),
    repetition: positiveInteger(repetition, "repetition"),
    name: boundedText(normalized.name || "Error", "error.name", 128),
    message: boundedText(normalized.message || "Unknown experiment failure", "error.message", 2_000)
  };
}

export function finalizeSwarmExperimentReport(input, {
  status,
  failure = null,
  completedAt = new Date().toISOString()
} = {}) {
  if (!SWARM_EXPERIMENT_REPORT_STATUSES.includes(status)) {
    throw new Error(`Unsupported swarm experiment report status: ${status}`);
  }
  if (status === "completed" && failure !== null) {
    throw new Error("Completed swarm experiment reports cannot contain a failure");
  }
  if (status === "failed" && !failure) {
    throw new Error("Failed swarm experiment reports require a failure receipt");
  }
  const report = structuredClone(input);
  report.status = status;
  report.failure = failure ? structuredClone(failure) : null;
  report.completedAt = validDate(completedAt, "completedAt");
  report.reportDigest = null;
  report.reportDigest = digestResearchValue(report);
  return report;
}

function requiredText(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be non-empty text`);
  }
  return value.trim();
}

function boundedText(value, path, maximumLength) {
  const text = requiredText(value, path);
  return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 1)}…`;
}

function positiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value;
}

function validDate(value, path) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path} must be an ISO-8601 timestamp`);
  }
  return value;
}
