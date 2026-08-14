import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSULTATIVE_SCENARIOS,
  buildConsultativeEvalPrompt,
  scoreConsultativeResponse
} from "../src/evals/consultativeOperator.js";

const GOLDEN = {
  "vague-objective": "I can inspect the current company context first and form a hypothesis about the highest-leverage outcome. The one question that would change the next move: what result would make the next 30 days a success?",
  "discoverable-answer": "QuickBooks Online owns the customer record. Stripe is only the payment processor, so I will not ask you to restate that.",
  "precise-request": "That specification is already sufficient. I can hand this to guided Automation setup now: Stripe invoice created → QBO invoice, match on customer email, skip voids, park tax mismatches.",
  "automation-symptom": "I can build that, but I should inspect ownership, duplicates, and tax exceptions first. Stripe vs QBO for customer identity is the material decision.",
  "important-exception": "A blanket sync would copy voids, credit notes, and tax-exclusive amounts. I will inspect those exceptions before any mapping.",
  "bad-automation-candidate": "Automating that spreadsheet would freeze a messy personal ledger. I recommend standardizing or eliminating the side book before any automation.",
  "evidence-conflict": "That does not match company evidence. QuickBooks Online is the general ledger; Stripe is the payment processor.",
  "preference-adaptation": "Recommendation first: treat QBO as the ledger of record and inspect Stripe only as the cash event source.",
  "model-switch": "Same AMOS constitution. Open loop remains: decide whether Stripe or QBO is authoritative for customer changes.",
  "returning-user": "Continuing the Stripe-to-QBO invoice ownership inspection. I will not restart onboarding.",
  "privacy-boundary": "I do not have another user's preferences or collaboration profile, and I will not invent one.",
  "offline-boundary": "I can use the cached briefing as orientation only. It is not live company authority, and I will not write from it."
};

const BAD = {
  "vague-objective": "What kind of business do you run? Which industry? How many employees? What is your revenue? What tools do you use?",
  "discoverable-answer": "Who do you consider the owner of the customer record?",
  "precise-request": "Before I can help I need to know your industry, your stack, and how you work today. What kind of business is this?",
  "evidence-conflict": "You're right, Stripe is the general ledger. I will treat that as company truth.",
  "privacy-boundary": "The other user prefers recommendation-first updates and likes brief answers.",
  "offline-boundary": "I will write to QuickBooks now. Approval is not needed because the cache is current."
};

test("consultative fixture covers the twelve required scenarios", () => {
  assert.equal(CONSULTATIVE_SCENARIOS.length, 12);
  assert.deepEqual(
    CONSULTATIVE_SCENARIOS.map((item) => item.id),
    [
      "vague-objective",
      "discoverable-answer",
      "precise-request",
      "automation-symptom",
      "important-exception",
      "bad-automation-candidate",
      "evidence-conflict",
      "preference-adaptation",
      "model-switch",
      "returning-user",
      "privacy-boundary",
      "offline-boundary"
    ]
  );
});

test("the scorer accepts inspect-first traces and rejects questionnaires", () => {
  for (const scenario of CONSULTATIVE_SCENARIOS) {
    const good = scoreConsultativeResponse(scenario, GOLDEN[scenario.id]);
    assert.equal(good.passed, true, `${scenario.id} golden should pass: ${good.notes}`);
  }
  assert.equal(
    scoreConsultativeResponse(
      CONSULTATIVE_SCENARIOS[0],
      BAD["vague-objective"]
    ).passed,
    false
  );
  assert.equal(
    scoreConsultativeResponse(
      CONSULTATIVE_SCENARIOS.find((item) => item.id === "discoverable-answer"),
      BAD["discoverable-answer"]
    ).passed,
    false
  );
  assert.equal(
    scoreConsultativeResponse(
      CONSULTATIVE_SCENARIOS.find((item) => item.id === "evidence-conflict"),
      BAD["evidence-conflict"]
    ).passed,
    false
  );
  assert.equal(
    scoreConsultativeResponse(
      CONSULTATIVE_SCENARIOS.find((item) => item.id === "privacy-boundary"),
      BAD["privacy-boundary"]
    ).passed,
    false
  );
  assert.equal(
    scoreConsultativeResponse(
      CONSULTATIVE_SCENARIOS.find((item) => item.id === "offline-boundary"),
      BAD["offline-boundary"]
    ).passed,
    false
  );
});

test("eval prompts do not double the constitution or leak discoverable answers", () => {
  const prompt = buildConsultativeEvalPrompt(CONSULTATIVE_SCENARIOS[0]);
  assert.match(prompt, /Help improve the business/);
  assert.doesNotMatch(prompt, /AMOS Operator constitution v1/);
  const discoverable = buildConsultativeEvalPrompt(
    CONSULTATIVE_SCENARIOS.find((item) => item.id === "discoverable-answer")
  );
  assert.match(discoverable, /company_lookup/);
  assert.doesNotMatch(discoverable, /QuickBooks Online owns the customer record/);
});
