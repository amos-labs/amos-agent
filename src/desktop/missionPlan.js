/**
 * Plain-English Mission copy.
 *
 * The one-sentence rule: a Mission is a goal handed to AMOS the way you would hand it to a
 * capable new hire. Everything AMOS compiles from that sentence (operations, limits, admission,
 * checkers, digests) is internal rigor; the user reads the goal, a plain-English plan, the
 * budget, and Start. These pure helpers turn the compiler's record into that copy and are shared
 * by the renderer and its tests so the default view can be checked for internal vocabulary.
 */

import { MISSION_CHANNEL_LABELS, normalizeMissionNotificationChoice } from "./missionNotifications.js";

/** Words a user must never read in the default Missions view. */
export const MISSION_INTERNAL_VOCABULARY = Object.freeze([
  "run contract", "contract", "digest", "family", "checker", "metric", "admission"
]);

const INTERNAL_VOCABULARY_PATTERN = new RegExp(
  `\\b(${MISSION_INTERNAL_VOCABULARY.map((word) => word.replace(" ", "\\s+")).join("|")})s?\\b`,
  "i"
);

export function containsInternalVocabulary(text) {
  return INTERNAL_VOCABULARY_PATTERN.test(String(text || ""));
}

// Limits the user may adjust on a compiled plan, shown in human units and sent back in the
// Platform's units. `noun` phrases the limit as a ceiling ("a 300-credit ceiling").
export const MISSION_LIMIT_FIELDS = Object.freeze({
  max_provider_credits: { label: "Credits", unit: "credits", scale: 1, step: 1, kind: "credits" },
  max_cost_microusd: { label: "Spend", unit: "USD", scale: 1_000_000, step: 0.01, kind: "spend" },
  max_wall_time_seconds: { label: "Time", unit: "minutes", scale: 60, step: 1, kind: "time" },
  max_tool_calls: { label: "Actions", unit: "actions", scale: 1, step: 1, kind: "actions" },
  max_decisions: { label: "Questions", unit: "questions", scale: 1, step: 1, kind: "questions" }
});

const SMALL_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function numberWord(value) {
  const number = Math.round(Number(value));
  return number >= 0 && number < SMALL_NUMBERS.length ? SMALL_NUMBERS[number] : String(number);
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(value)));
}

function formatUsd(microusd) {
  const amount = Number(microusd || 0) / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatMinutes(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value % 86_400 === 0) return `${value / 86_400} day${value === 86_400 ? "" : "s"}`;
  if (value % 3_600 === 0) return `${value / 3_600} hour${value === 3_600 ? "" : "s"}`;
  if (value % 60 === 0) return `${value / 60} minute${value === 60 ? "" : "s"}`;
  return `${value} second${value === 1 ? "" : "s"}`;
}

/** Scaled amount for an editable input, in the field's human unit. */
export function missionLimitInputValue(key, value) {
  const field = MISSION_LIMIT_FIELDS[key];
  const number = Number(value);
  if (!field || !Number.isFinite(number)) return String(value ?? "");
  const scaled = number / field.scale;
  return field.scale === 1_000_000 ? scaled.toFixed(2) : String(Math.round(scaled * 100) / 100);
}

/** "300 credits", "$5.00", "60 minutes", "80 actions", "3 questions". */
export function missionLimitAmount(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  switch (MISSION_LIMIT_FIELDS[key]?.kind) {
    case "credits":
      return `${formatCount(number)} credit${number === 1 ? "" : "s"}`;
    case "spend":
      return formatUsd(number);
    case "time":
      return formatMinutes(number) || `${number} seconds`;
    case "actions":
      return `${formatCount(number)} action${number === 1 ? "" : "s"}`;
    case "questions":
      return `${formatCount(number)} question${number === 1 ? "" : "s"}`;
    default:
      return `${number} ${String(key).replace(/^max_/, "").replaceAll("_", " ")}`;
  }
}

/** "a 300-credit", "a $5.00 spend", "a 60-minute", "an 80-action", "a 3-question" — for "… ceiling". */
export function missionLimitCeilingPhrase(key, value) {
  const number = Number(value);
  const field = MISSION_LIMIT_FIELDS[key];
  if (!field || !Number.isFinite(number)) return `a ${missionLimitAmount(key, value)}`;
  const article = (word) => (/^(8|11|18|80|800|8,|11,|18,)/.test(word) ? "an" : "a");
  switch (field.kind) {
    case "credits": {
      const count = formatCount(number);
      return `${article(count)} ${count}-credit`;
    }
    case "spend":
      return `a ${formatUsd(number)} spend`;
    case "time": {
      const text = formatMinutes(number).replace(/s$/, "").replace(" ", "-") || `${number}-second`;
      return `${article(text)} ${text}`;
    }
    case "actions": {
      const count = formatCount(number);
      return `${article(count)} ${count}-action`;
    }
    case "questions": {
      const count = formatCount(number);
      return `${article(count)} ${count}-question`;
    }
    default:
      return `a ${missionLimitAmount(key, value)}`;
  }
}

/**
 * One limit as a sentence. A limit the user (or a Project cap, plan, or policy) stated reads as
 * a boundary; a limit AMOS guessed says so and invites a change.
 */
export function missionLimitSentence(key, value, { guessed = false } = {}) {
  if (guessed) {
    const what = MISSION_LIMIT_FIELDS[key]?.kind === "time"
      ? `${missionLimitCeilingPhrase(key, value)} time limit`
      : `${missionLimitCeilingPhrase(key, value)} ceiling`;
    return `AMOS picked ${what} because you didn't name one — tap to change`;
  }
  switch (MISSION_LIMIT_FIELDS[key]?.kind) {
    case "credits":
      return `It will stop at ${missionLimitAmount(key, value)}.`;
    case "spend":
      return `It will spend no more than ${missionLimitAmount(key, value)}.`;
    case "time":
      return `It will stop after ${missionLimitAmount(key, value)}.`;
    case "actions":
      return `It will take at most ${missionLimitAmount(key, value)}.`;
    case "questions":
      return `It will ask you at most ${missionLimitAmount(key, value)}.`;
    default:
      return `It will stop at ${missionLimitAmount(key, value)}.`;
  }
}

/** The first clause of the goal, as a Mission name. Editable later once the Platform allows renames. */
export function missionNameFromObjective(objective) {
  const text = String(objective || "").replace(/\s+/g, " ").trim();
  if (!text) return "New Mission";
  const clause = text.split(/[,;:.!?\n]| — | - | and then | then /i)[0].trim();
  const name = (clause || text).replace(/^(please|hey amos|amos,?)\s+/i, "");
  const capped = name.length > 80 ? `${name.slice(0, 77).trimEnd()}…` : name;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

/** "AMOS will get you 500 VAR and MSP prospects in the US and Canada, no more than 700 credits." */
export function missionGoalSentence(objective) {
  const text = String(objective || "").replace(/\s+/g, " ").trim().replace(/[.!\s]+$/, "");
  if (!text) return "AMOS will work on your goal.";
  let phrase = text.replace(/^(please|hey amos|amos,?)\s+/i, "");
  // Lowercase a leading imperative ("Get me…") but leave acronyms and names alone ("US…").
  if (/^[A-Z][a-z]/.test(phrase)) phrase = phrase.charAt(0).toLowerCase() + phrase.slice(1);
  phrase = phrase
    .replace(/^(\w+) me\b/, "$1 you")
    .replace(/\bmy\b/g, "your")
    .replace(/\bMy\b/g, "Your");
  return `AMOS will ${phrase}.`;
}

/** "In-app and SMS" / "In-app, SMS, and Discord". */
export function missionChannelsPhrase(choice) {
  const normalized = normalizeMissionNotificationChoice(choice);
  const labels = (normalized?.channels || ["in_app"]).map((channel) => MISSION_CHANNEL_LABELS[channel] || channel);
  if (labels.length <= 1) return labels[0] || "In-app";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

/** "Updates go to In-app and SMS." */
export function missionUpdatesSentence(choice) {
  return `Updates go to ${missionChannelsPhrase(choice)}.`;
}

/** "Start", "Start with a 300-credit limit", "Start with these limits". */
export function missionStartLabel(guessedLimits = []) {
  const guessed = Array.isArray(guessedLimits) ? guessedLimits.filter((limit) => limit && limit.key) : [];
  if (guessed.length === 0) return "Start";
  if (guessed.length > 1) return "Start with these limits";
  const [limit] = guessed;
  const phrase = missionLimitCeilingPhrase(limit.key, limit.value).replace(/ spend$/, "");
  return `Start with ${phrase} limit`;
}

/**
 * The plan a compiled Mission renders by default plus the rows tucked behind "Details for the
 * curious". `contract` is the controller's compiled record (effectiveLimits, limitSources,
 * defaultedLimits, operationGroups, prohibitions, boundResources, admission, contractSha256).
 */
export function missionPlanCopy({ objective = "", contract = null, notifications = null, aiNextStep = "" } = {}) {
  const record = contract && typeof contract === "object" ? contract : {};
  const goal = missionGoalSentence(record.objective || objective);
  const resources = Array.isArray(record.boundResources) ? record.boundResources.filter(Boolean) : [];
  const using = resources.length > 0
    ? `It will use ${resources.length === 1 ? resources[0] : `${resources.slice(0, -1).join(", ")} and ${resources.at(-1)}`}.`
    : "";
  const sources = record.limitSources && typeof record.limitSources === "object" ? record.limitSources : {};
  const defaulted = new Set(Array.isArray(record.defaultedLimits) ? record.defaultedLimits : []);
  const limits = Object.entries(record.effectiveLimits && typeof record.effectiveLimits === "object" ? record.effectiveLimits : {})
    .map(([key, value]) => {
      const guessed = String(sources[key] || "") === "default" || defaulted.has(key);
      return {
        key,
        value,
        guessed,
        editable: guessed && Boolean(MISSION_LIMIT_FIELDS[key]),
        sentence: missionLimitSentence(key, value, { guessed }),
        amount: missionLimitAmount(key, value),
        label: MISSION_LIMIT_FIELDS[key]?.label || key.replace(/^max_/, "").replaceAll("_", " "),
        unit: MISSION_LIMIT_FIELDS[key]?.unit || "",
        inputValue: missionLimitInputValue(key, value)
      };
    });
  const guessed = limits.filter((limit) => limit.guessed);
  const updates = missionUpdatesSentence(notifications || record.notifications);
  const details = [];
  const completion = record.completionCondition && typeof record.completionCondition === "object" ? record.completionCondition : null;
  if (completion?.kind) details.push(["Done when", missionCompletionSentence(completion)]);
  const groups = record.operationGroups && typeof record.operationGroups === "object" ? record.operationGroups : {};
  const operations = [
    ["Moves it forward", groups.advancing],
    ["Looks things up", groups.observing],
    ["Pauses or stops", groups.control]
  ].filter(([, verbs]) => Array.isArray(verbs) && verbs.length > 0);
  if (operations.length > 0) {
    for (const [label, verbs] of operations) details.push([label, verbs.map(humanizeVerb).join(", ")]);
  } else if (Array.isArray(record.operations) && record.operations.length > 0) {
    details.push(["Allowed actions", record.operations.map(humanizeVerb).join(", ")]);
  }
  if (Array.isArray(record.prohibitions) && record.prohibitions.length > 0) {
    details.push(["Never", record.prohibitions.map(humanizeVerb).join(", ")]);
  }
  if (resources.length > 0) details.push(["Uses", resources.join(", ")]);
  const admission = record.admission && typeof record.admission === "object" ? Object.entries(record.admission) : [];
  if (admission.length > 0) {
    details.push(["Checks", admission.map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join(" · ")]);
  }
  if (record.contractSha256) details.push(["Fingerprint", String(record.contractSha256).slice(0, 16)]);
  if (aiNextStep) details.push(["Suggested next step", String(aiNextStep)]);
  return {
    goal,
    using,
    limits,
    guessed,
    updates,
    startLabel: missionStartLabel(guessed),
    requiresConfirmation: guessed.length > 0,
    details
  };
}

function humanizeVerb(verb) {
  return String(verb || "").replace(/^amos_/, "").replaceAll("_", " ");
}

/** "When the approved work runs out" — never the compiler's kind names. */
export function missionCompletionSentence(condition) {
  const kind = String(condition?.kind || "");
  if (kind === "work_exhausted") return "When the approved work runs out.";
  if (kind === "owner_acceptance") return "When you accept the result.";
  if (kind === "metric_threshold") {
    const what = humanizeVerb(condition.metric || "the measured value");
    return `When ${what} ${condition.operator || "reaches"} ${condition.target ?? "its target"}.`;
  }
  return "When the plan's finish line is reached.";
}

/**
 * The compiler's rejection as one sentence a business owner can act on. Error-code prefixes
 * ("InvalidParams:") and the "No Mission was created." boilerplate are dropped.
 */
export function missionCompileProblem(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim()
    .replace(/^(invalid ?params|invalid_params|validation ?error|error|compiler ?error)\s*[:—-]\s*/i, "")
    .replace(/\brun contract\b/gi, "plan")
    .replace(/\bno mission was created\.?/gi, "")
    .trim();
  if (!text) return "AMOS couldn't turn that into a plan yet.";
  const [first] = text.split(/(?<=[.!?])\s+/);
  const sentence = first.trim().replace(/^[a-z]/, (letter) => letter.toUpperCase());
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** "about three hours" for 2h40m; "about 40 minutes"; "a couple of minutes". */
export function missionElapsedPhrase(milliseconds) {
  const ms = Number(milliseconds);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = ms / 60_000;
  if (minutes < 1) return "less than a minute";
  if (minutes < 3) return "a couple of minutes";
  if (minutes < 60) return `about ${Math.round(minutes / 5) * 5 || 5} minutes`;
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.round(hours);
    return `about ${numberWord(rounded)} hour${rounded === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `about ${numberWord(days)} day${days === 1 ? "" : "s"}`;
}

const ACTIVE_MISSION_STATUSES = new Set(["authorized", "running", "active", "waiting_decision", "paused"]);

/**
 * "212 of 500 so far, 140 credits used, about three hours in" from a projected Mission. Every
 * part is optional; an empty string means the caller should fall back to the status reason.
 */
export function missionProgressLine(mission, { now = Date.now() } = {}) {
  if (!mission || typeof mission !== "object") return "";
  const parts = [];
  const progress = mission.progress && typeof mission.progress === "object" ? mission.progress : {};
  const done = finiteOrNull(progress.done ?? progress.current ?? progress.completed ?? progress.count);
  const target = finiteOrNull(progress.target ?? progress.total ?? progress.goal);
  const unit = String(progress.unit || progress.label || "").trim();
  if (done !== null && target !== null && target > 0) {
    parts.push(`${formatCount(done)} of ${formatCount(target)}${unit ? ` ${unit}` : ""} so far`);
  } else if (done !== null && done > 0) {
    parts.push(`${formatCount(done)}${unit ? ` ${unit}` : ""} so far`);
  }
  const contract = mission.contract && typeof mission.contract === "object" ? mission.contract : {};
  const credits = finiteOrNull(contract.usedProviderCredits);
  const cost = finiteOrNull(contract.usedCostMicrousd);
  if (credits !== null && (credits > 0 || finiteOrNull(contract.maxProviderCredits))) {
    parts.push(`${formatCount(credits)} credit${credits === 1 ? "" : "s"} used`);
  } else if (cost !== null && cost > 0) {
    parts.push(`${formatUsd(cost)} spent`);
  }
  const started = Date.parse(mission.startedAt || "") || Date.parse(mission.createdAt || "") || 0;
  const status = String(mission.status || "");
  if (started > 0) {
    if (ACTIVE_MISSION_STATUSES.has(status)) {
      const elapsed = missionElapsedPhrase(Number(now) - started);
      if (elapsed && parts.length > 0) parts.push(`${elapsed} in`);
      else if (elapsed) parts.push(`${elapsed === "less than a minute" ? "just started" : `${elapsed} in`}`);
    } else {
      const finished = Date.parse(mission.finishedAt || "") || 0;
      const elapsed = finished > started ? missionElapsedPhrase(finished - started) : "";
      if (elapsed) parts.push(`took ${elapsed}`);
    }
  }
  return parts.join(", ");
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
