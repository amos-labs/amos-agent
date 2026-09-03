import assert from "node:assert/strict";
import test from "node:test";

import {
  containsInternalVocabulary,
  missionChannelsPhrase,
  missionCompileProblem,
  missionCompletionSentence,
  missionElapsedPhrase,
  missionGoalSentence,
  missionLimitSentence,
  missionNameFromObjective,
  missionPlanCopy,
  missionProgressLine,
  missionStartLabel,
  missionUpdatesSentence
} from "../src/desktop/missionPlan.js";

const GOAL = "Get me 500 VAR and MSP prospects in the US and Canada, no more than 700 credits";

const compiledContract = {
  name: "",
  objective: GOAL,
  completionCondition: { kind: "work_exhausted" },
  operations: ["search_prospects", "get_prospect", "pause_mission"],
  operationGroups: { advancing: ["search_prospects"], observing: ["get_prospect"], control: ["pause_mission"] },
  prohibitions: ["send_email"],
  effectiveLimits: { max_provider_credits: 700, max_cost_microusd: 5_000_000, max_wall_time_seconds: 3600 },
  limitSources: { max_provider_credits: "user", max_cost_microusd: "default", max_wall_time_seconds: "project_cap" },
  defaultedLimits: [],
  admission: { decision: "admitted", family: "prospecting" },
  boundResources: ["Apollo connector"],
  contractSha256: "sha-1-abcdefabcdefabcdef",
  notifications: { channels: ["in_app", "sms"] }
};

test("the Mission name is the goal's first clause", () => {
  assert.equal(missionNameFromObjective(GOAL), "Get me 500 VAR and MSP prospects in the US and Canada");
  assert.equal(missionNameFromObjective("please reconcile last month's books. Then email me."), "Reconcile last month's books");
  assert.equal(missionNameFromObjective(""), "New Mission");
  assert.ok(missionNameFromObjective("x".repeat(200)).length <= 80);
});

test("the plan opens with what AMOS will do, in the user's words", () => {
  assert.equal(
    missionGoalSentence(GOAL),
    "AMOS will get you 500 VAR and MSP prospects in the US and Canada, no more than 700 credits."
  );
  assert.equal(missionGoalSentence("US expansion research."), "AMOS will US expansion research.");
  assert.equal(missionGoalSentence("Find my top ten churn risks"), "AMOS will find your top ten churn risks.");
});

test("stated and guessed limits read differently, and only the guess names its source", () => {
  assert.equal(missionLimitSentence("max_provider_credits", 700), "It will stop at 700 credits.");
  assert.equal(
    missionLimitSentence("max_provider_credits", 300, { guessed: true }),
    "AMOS picked a 300-credit ceiling because you didn't name one — tap to change"
  );
  assert.equal(missionLimitSentence("max_cost_microusd", 5_000_000), "It will spend no more than $5.00.");
  assert.equal(
    missionLimitSentence("max_cost_microusd", 5_000_000, { guessed: true }),
    "AMOS picked a $5.00 spend ceiling because you didn't name one — tap to change"
  );
  assert.equal(missionLimitSentence("max_wall_time_seconds", 3600), "It will stop after 1 hour.");
  assert.equal(
    missionLimitSentence("max_wall_time_seconds", 5400, { guessed: true }),
    "AMOS picked a 90-minute time limit because you didn't name one — tap to change"
  );
  assert.equal(missionLimitSentence("max_tool_calls", 80), "It will take at most 80 actions.");
  assert.equal(
    missionLimitSentence("max_tool_calls", 80, { guessed: true }),
    "AMOS picked an 80-action ceiling because you didn't name one — tap to change"
  );
  assert.equal(missionLimitSentence("max_decisions", 1), "It will ask you at most 1 question.");
  // A stated limit never says where it came from: no "from project cap", no "user".
  assert.doesNotMatch(missionLimitSentence("max_wall_time_seconds", 3600), /project|user|source|default/i);
});

test("Start carries the one question when a budget was guessed", () => {
  assert.equal(missionStartLabel([]), "Start");
  assert.equal(missionStartLabel([{ key: "max_provider_credits", value: 300 }]), "Start with a 300-credit limit");
  assert.equal(missionStartLabel([{ key: "max_cost_microusd", value: 5_000_000 }]), "Start with a $5.00 limit");
  assert.equal(
    missionStartLabel([{ key: "max_provider_credits", value: 300 }, { key: "max_tool_calls", value: 80 }]),
    "Start with these limits"
  );
});

test("updates read as one sentence defaulting to the saved channels", () => {
  assert.equal(missionUpdatesSentence({ channels: ["in_app", "sms"] }), "Updates go to In-app and SMS.");
  assert.equal(missionUpdatesSentence(null), "Updates go to In-app.");
  assert.equal(missionChannelsPhrase({ channels: ["in_app", "sms", "discord"] }), "In-app, SMS, and Discord");
});

test("the default plan view contains none of the internal vocabulary; the rest sits in details", () => {
  const copy = missionPlanCopy({
    objective: GOAL,
    contract: compiledContract,
    notifications: { channels: ["in_app", "sms"] },
    aiNextStep: "Review the Run Contract's guessed spend limit"
  });
  assert.equal(copy.goal, `AMOS will get you 500 VAR and MSP prospects in the US and Canada, no more than 700 credits.`);
  assert.equal(copy.using, "It will use Apollo connector.");
  assert.deepEqual(copy.limits.map((limit) => [limit.key, limit.guessed]), [
    ["max_provider_credits", false],
    ["max_cost_microusd", true],
    ["max_wall_time_seconds", false]
  ]);
  assert.equal(copy.limits[0].sentence, "It will stop at 700 credits.");
  assert.equal(copy.limits[1].sentence, "AMOS picked a $5.00 spend ceiling because you didn't name one — tap to change");
  assert.equal(copy.limits[1].editable, true);
  assert.equal(copy.limits[2].sentence, "It will stop after 1 hour.");
  assert.equal(copy.updates, "Updates go to In-app and SMS.");
  assert.equal(copy.startLabel, "Start with a $5.00 limit");
  assert.equal(copy.requiresConfirmation, true);
  const defaultView = [copy.goal, copy.using, ...copy.limits.map((limit) => limit.sentence), copy.updates, copy.startLabel].join("\n");
  assert.equal(containsInternalVocabulary(defaultView), false, defaultView);
  // Operations, prohibitions, admission, and the digest are present only behind the disclosure,
  // labeled plainly.
  const labels = copy.details.map(([label]) => label);
  assert.deepEqual(labels, [
    "Done when", "Moves it forward", "Looks things up", "Pauses or stops", "Never", "Uses", "Checks", "Fingerprint", "Suggested next step"
  ]);
  assert.ok(copy.details.some(([, value]) => value === "search prospects"));
  assert.ok(copy.details.some(([, value]) => value === "sha-1-abcdefabcd"));
  assert.equal(containsInternalVocabulary(labels.join("\n")), false);
});

test("a limit listed in defaulted_limits is a guess even without a limit source", () => {
  const copy = missionPlanCopy({
    objective: GOAL,
    contract: { effectiveLimits: { max_provider_credits: 300 }, limitSources: {}, defaultedLimits: ["max_provider_credits"] }
  });
  assert.equal(copy.limits[0].guessed, true);
  assert.equal(copy.startLabel, "Start with a 300-credit limit");
  const stated = missionPlanCopy({
    objective: GOAL,
    contract: { effectiveLimits: { max_provider_credits: 700 }, limitSources: { max_provider_credits: "user" } }
  });
  assert.equal(stated.limits[0].guessed, false);
  assert.equal(stated.startLabel, "Start");
  assert.equal(stated.requiresConfirmation, false);
});

test("completion reads as a sentence, never as a kind name", () => {
  assert.equal(missionCompletionSentence({ kind: "work_exhausted" }), "When the approved work runs out.");
  assert.equal(missionCompletionSentence({ kind: "owner_acceptance" }), "When you accept the result.");
  assert.equal(
    missionCompletionSentence({ kind: "metric_threshold", metric: "saved_prospects", operator: ">=", target: 500 }),
    "When saved prospects >= 500."
  );
  assert.equal(missionCompletionSentence(null), "When the plan's finish line is reached.");
});

test("a compiler rejection becomes one plain sentence", () => {
  assert.equal(
    missionCompileProblem("InvalidParams: The Run Contract is not executable: no allowed operation can advance it. No Mission was created."),
    "The plan is not executable: no allowed operation can advance it."
  );
  assert.equal(missionCompileProblem("objective is required"), "Objective is required.");
  assert.equal(missionCompileProblem(""), "AMOS couldn't turn that into a plan yet.");
  assert.equal(containsInternalVocabulary(missionCompileProblem("InvalidParams: contract digest mismatch. Retry.")), true, "only the Run Contract phrase is rewritten; anything else stays the compiler's words");
});

test("progress reads like a status text from a person", () => {
  const now = Date.parse("2026-09-03T15:00:00.000Z");
  const mission = {
    status: "running",
    startedAt: "2026-09-03T12:10:00.000Z",
    progress: { done: 212, target: 500 },
    contract: { usedProviderCredits: 140, maxProviderCredits: 700, usedCostMicrousd: 1_200_000 }
  };
  assert.equal(missionProgressLine(mission, { now }), "212 of 500 so far, 140 credits used, about three hours in");
  assert.equal(
    missionProgressLine({ ...mission, progress: { done: 0, target: 500 }, contract: { usedProviderCredits: 0, maxProviderCredits: 700 } }, { now }),
    "0 of 500 so far, 0 credits used, about three hours in"
  );
  // No credits ceiling: spend stands in. No progress fields at all: the caller falls back.
  assert.equal(
    missionProgressLine({ status: "running", startedAt: "2026-09-03T14:35:00.000Z", contract: { usedCostMicrousd: 1_250_000 } }, { now }),
    "$1.25 spent, about 25 minutes in"
  );
  assert.equal(missionProgressLine({ status: "running", contract: {} }, { now }), "");
  assert.equal(missionProgressLine(null), "");
  // A finished Mission says how long it took instead of how long it has been going.
  assert.equal(
    missionProgressLine({
      status: "completed",
      startedAt: "2026-09-03T09:00:00.000Z",
      finishedAt: "2026-09-03T11:05:00.000Z",
      progress: { done: 500, target: 500, unit: "prospects" },
      contract: { usedProviderCredits: 640, maxProviderCredits: 700 }
    }, { now }),
    "500 of 500 prospects so far, 640 credits used, took about two hours"
  );
  assert.equal(missionElapsedPhrase(30_000), "less than a minute");
  assert.equal(missionElapsedPhrase(2 * 86_400_000), "about two days");
});
