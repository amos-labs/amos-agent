import assert from "node:assert/strict";
import test from "node:test";

import {
  AMOS_SAVINGS_AUDIT_PROMPT,
  selectJourneyStarterActions
} from "../src/desktop/journeyStarterActions.js";

test("company quick actions follow deterministic journey state", () => {
  const actions = selectJourneyStarterActions({
    connectionMode: "user",
    mode: { personal: false, offline: false },
    approvals: [{ id: "approval-1", status: "pending" }],
    taskCheckpoints: [],
    connectionsCatalog: {
      providers: [{ provider: "quickbooks" }],
      connections: []
    },
    companyReceipts: [{ lifecycleState: "executed", effectApplied: true }],
    briefings: { briefings: [{ id: "briefing-1" }] }
  });

  assert.deepEqual(
    actions.map((action) => action.id),
    ["review-decisions", "connect-first-system", "amos-savings-audit", "review-recent-proof", "open-briefings"]
  );
  assert.equal(actions[0].label, "Review 1 decision");
  assert.equal(actions[1].label, "Connect your company");
  assert.equal(actions[2].label, "See what AMOS could replace");
  assert.equal(actions[0].type, "view");
});

test("the newest interrupted checkpoint becomes an exact resume action", () => {
  const actions = selectJourneyStarterActions({
    connectionMode: "user",
    mode: { personal: false, offline: false },
    taskCheckpoints: [
      { id: "older", updatedAt: "2026-08-15T10:00:00.000Z" },
      { id: "newer", updatedAt: "2026-08-16T10:00:00.000Z" }
    ],
    connectionsCatalog: {
      providers: [{ provider: "quickbooks" }],
      connections: [{ id: "qbo", status: "connected", usable: true }]
    },
    automations: {
      automations: [{ id: "sync", status: "paused" }],
      failures: []
    }
  });

  assert.deepEqual(actions[0], {
    id: "resume-interrupted-work",
    label: "Resume interrupted work",
    type: "resume",
    checkpointId: "newer"
  });
  assert.equal(actions[1].id, "review-automation-issues");
});

test("a connected company with no automation gets a typed builder action", () => {
  const actions = selectJourneyStarterActions({
    connectionMode: "user",
    mode: { personal: false, offline: false },
    connectionsCatalog: {
      connections: [{ id: "stripe", status: "connected", usable: true }]
    },
    automations: { automations: [], failures: [] },
    browserRecipes: { recipes: [] }
  });

  assert.equal(actions[0].id, "build-first-automation");
  assert.equal(actions[0].type, "automation_builder");
  assert.equal(actions[1].id, "company-briefing");
});

test("personal workspaces surface existing conversations before project prompts", () => {
  const actions = selectJourneyStarterActions({
    mode: { personal: true, offline: false },
    tasks: {
      tasks: [
        { id: "active", status: "active" },
        { id: "archived", archived: true }
      ]
    }
  });

  assert.equal(actions.length, 5);
  assert.deepEqual(actions[0], {
    id: "connect-business-systems",
    label: "Connect your company",
    type: "connect_platform"
  });
  assert.equal(actions[1].id, "amos-savings-audit");
  assert.deepEqual(actions[2], {
    id: "open-conversations",
    label: "Open 1 conversation",
    type: "view",
    view: "tasks"
  });
  assert.equal(actions[3].type, "run");
});

test("the AMOS savings audit never invents a dollar amount", () => {
  assert.match(AMOS_SAVINGS_AUDIT_PROMPT, /Do not invent dollar amounts/);
  assert.match(AMOS_SAVINGS_AUDIT_PROMPT, /Do not claim a system is connected unless the catalog shows it/);
});

test("demo quick actions remain bounded code-owned requests", () => {
  const actions = selectJourneyStarterActions({ connectionMode: "demo" });

  assert.equal(actions.length, 4);
  assert.ok(actions.every((action) => action.type === "run"));
  assert.ok(actions.every((action) => action.id && action.label && action.prompt));
});
