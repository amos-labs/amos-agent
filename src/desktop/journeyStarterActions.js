const MAX_STARTER_ACTIONS = 4;

const COMPANY_OUTCOME_STATES = new Set([
  "executed",
  "measured",
  "failed",
  "reverted",
  "rolled_back",
  "canceled",
  "cancelled"
]);

export function selectJourneyStarterActions(state = {}) {
  if (state.connectionMode === "demo") return demoStarterActions();
  if (state.mode?.personal || state.mode?.offline) return personalStarterActions(state);
  return companyStarterActions(state);
}

function companyStarterActions(state) {
  const actions = [];
  const checkpoints = newestFirst(state.taskCheckpoints, "updatedAt");
  const pendingDecisions = array(state.approvals).filter((item) => item.status === "pending");
  const connectedSystems = array(state.connectionsCatalog?.connections).filter(
    (item) => item.status === "connected" && item.usable !== false
  );
  const automations = array(state.automations?.automations);
  const recipes = array(state.browserRecipes?.recipes);
  const automationFailures = array(state.automations?.failures);
  const automationNeedsAttention = automationFailures.length > 0 ||
    automations.some((item) => item.status !== "active" || Number(item.stats?.toolRunsParked || 0) > 0) ||
    recipes.some((item) => item.status !== "ready" || Number(item.runStats?.failed || 0) > 0);
  const automationCount = automations.length + recipes.length;
  const companyOutcomes = array(state.companyReceipts).filter(isCompanyOutcome);
  const briefings = array(state.briefings?.briefings);
  const connectionCatalogAvailable = Boolean(
    state.connectionsCatalog?.supported === true ||
    array(state.connectionsCatalog?.providers).length > 0 ||
    array(state.connectionsCatalog?.curated).length > 0 ||
    array(state.connectionsCatalog?.tenantDefined).length > 0 ||
    connectedSystems.length > 0
  );

  if (
    checkpoints.length > 0 &&
    state.connectionMode === "user" &&
    !state.mode?.offline
  ) {
    actions.push({
      id: "resume-interrupted-work",
      label: "Resume interrupted work",
      type: "resume",
      checkpointId: checkpoints[0].id
    });
  }

  if (pendingDecisions.length > 0) {
    actions.push({
      id: "review-decisions",
      label: `Review ${pendingDecisions.length} ${plural(pendingDecisions.length, "decision")}`,
      type: "view",
      view: "decisions"
    });
  }

  if (connectionCatalogAvailable && connectedSystems.length === 0) {
    actions.push({
      id: "connect-first-system",
      label: "Connect your first system",
      type: "view",
      view: "connections"
    });
  } else if (automationNeedsAttention) {
    actions.push({
      id: "review-automation-issues",
      label: "Review automation issues",
      type: "view",
      view: "automations"
    });
  } else if (connectedSystems.length > 0 && automationCount === 0) {
    actions.push({
      id: "build-first-automation",
      label: "Build your first automation",
      type: "automation_builder"
    });
  } else if (automationCount > 0) {
    actions.push({
      id: "manage-automations",
      label: `Manage ${automationCount} ${plural(automationCount, "automation")}`,
      type: "view",
      view: "automations"
    });
  }

  if (companyOutcomes.length > 0) {
    actions.push({
      id: "review-recent-proof",
      label: "Review recent proof",
      type: "view",
      view: "activity"
    });
  }

  if (briefings.length > 0) {
    actions.push({
      id: "open-briefings",
      label: `Open ${briefings.length} ${plural(briefings.length, "briefing")}`,
      type: "view",
      view: "canvas"
    });
  }

  actions.push(
    runAction(
      "company-briefing",
      "Brief me on what matters",
      "Review the current authoritative company context and give me a concise executive briefing: what changed, what needs attention, what remains uncertain, and the highest-leverage next move."
    ),
    runAction(
      "find-high-impact-workflow",
      "Find a high-impact workflow",
      "Inspect the current company systems, goals, operating context, and repeated work. Identify one high-impact workflow worth improving or automating, explain the business case, and do not activate anything yet."
    )
  );

  return uniqueActions(actions).slice(0, MAX_STARTER_ACTIONS);
}

function demoStarterActions() {
  return [
    runAction(
      "demo-briefing",
      "Brief me on Northwind",
      "Give me an executive briefing on Northwind Labs: what matters, what needs attention, and what I can safely do next."
    ),
    runAction(
      "demo-growth-opportunity",
      "Find a growth opportunity",
      "Inspect Northwind's current growth signals and propose one useful, governed experiment."
    ),
    runAction(
      "demo-approval-flow",
      "Experience an approval flow",
      "Create a useful customer-facing asset for Northwind and walk me through the approval and receipt flow."
    ),
    runAction(
      "demo-proof-trail",
      "Show the proof trail",
      "Show me recent Northwind activity and explain how AMOS proves what changed and why."
    )
  ];
}

function personalStarterActions(state) {
  const actions = [];
  const conversations = array(state.tasks?.tasks).filter((task) => !task.archivedAt && !task.archived);
  if (conversations.length > 0) {
    actions.push({
      id: "open-conversations",
      label: `Open ${conversations.length} ${plural(conversations.length, "conversation")}`,
      type: "view",
      view: "tasks"
    });
  }
  actions.push(
    runAction(
      "project-briefing",
      "Brief this project",
      "Inspect this workspace and give me a concise project briefing: architecture, current state, risks, and the best next task."
    ),
    runAction(
      "explain-architecture",
      "Explain the architecture",
      "Inspect this workspace and explain how the main components fit together, citing the files you used."
    ),
    runAction(
      "find-project-risks",
      "Find the riskiest code",
      "Inspect this project for the highest-leverage reliability, security, and maintainability risks. Do not change anything yet."
    ),
    runAction(
      "small-project-improvement",
      "Improve something small",
      "Inspect this workspace, propose one small high-value improvement, and wait for my approval before changing files."
    )
  );
  return uniqueActions(actions).slice(0, MAX_STARTER_ACTIONS);
}

function runAction(id, label, prompt) {
  return {
    id,
    label,
    type: "run",
    prompt
  };
}

function newestFirst(items, timestampKey) {
  return array(items)
    .filter((item) => item?.id)
    .toSorted((left, right) => (
      Date.parse(right?.[timestampKey] || 0) - Date.parse(left?.[timestampKey] || 0)
    ));
}

function isCompanyOutcome(receipt) {
  return receipt?.effectApplied === true || COMPANY_OUTCOME_STATES.has(
    String(receipt?.lifecycleState || "").toLowerCase()
  );
}

function uniqueActions(actions) {
  const seen = new Set();
  return actions.filter((action) => {
    if (!action?.id || seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function plural(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}
