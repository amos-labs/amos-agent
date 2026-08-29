const MAX_STARTER_ACTIONS = 5;

export const AMOS_SAVINGS_AUDIT_PROMPT = [
  "I want an AMOS replacement audit for the apps and SaaS this company currently pays for.",
  "If systems are already connected, use the live catalog. Otherwise ask me which tools we pay for before estimating anything.",
  "For each app, say whether AMOS Platform can absorb the workflow by connecting the system, automating it, or hosting a replacement app.",
  "Give a conservative savings case only from costs I provide or from connected receipts. Do not invent dollar amounts.",
  "Do not claim a system is connected unless the catalog shows it. Do not activate, migrate, or disconnect anything."
].join(" ");

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

  if (connectedSystems.length > 0) {
    if (automationNeedsAttention) {
      actions.push({
        id: "review-automation-issues",
        label: "Review automation issues",
        type: "view",
        view: "automations"
      });
    } else if (automationCount === 0) {
      actions.push({
        id: "build-first-automation",
        label: "Build your first automation",
        type: "automation_builder"
      });
    } else {
      actions.push({
        id: "manage-automations",
        label: `Manage ${automationCount} ${plural(automationCount, "automation")}`,
        type: "view",
        view: "automations"
      });
    }
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
      "business-attention",
      "Tell me what needs attention",
      "Review the authoritative company context, connected systems, and anything I attach. Tell me what changed, what needs attention now, what remains uncertain, and the highest-leverage next move. If there is not enough evidence, ask for the single most useful source instead of guessing.",
      "Find the important signal and recommend the next move."
    ),
    runAction(
      "business-operating-plan",
      "Build my operating plan",
      "Use the company context and anything I attach to build a practical operating plan: the goal, current position, biggest constraints, prioritized moves, owners, measures, and the next seven days. Label assumptions and do not invent company facts.",
      "Turn company evidence into a prioritized plan."
    ),
    runAction(
      "business-prospects",
      "Find my best prospects",
      "Use the company context and anything I attach to define the highest-fit buyer, identify a bounded first prospecting segment, and prepare a research-backed outreach plan. Do not buy data, reveal personal data, or contact anyone without the required approval.",
      "Define the buyer and prepare a governed prospecting move."
    ),
    runAction(
      "business-revenue-review",
      "Review revenue and cash",
      "Review the authoritative finance, billing, and sales evidence available to AMOS or in anything I attach. Explain revenue, cash, collections, anomalies, and the most important follow-up. Reconcile conflicting figures explicitly and never invent missing amounts.",
      "Explain what the numbers say and what to do next."
    ),
    runAction(
      "business-follow-up",
      "Turn work into follow-up",
      "Review the meetings, messages, documents, tasks, and company context available to AMOS or in anything I attach. Produce a concise list of decisions, owners, deadlines, risks, and ready-to-review follow-up drafts. Do not send anything without the required approval.",
      "Extract decisions and prepare the follow-through."
    )
  );

  return uniqueActions(actions).slice(0, MAX_STARTER_ACTIONS);
}

function demoStarterActions() {
  return [
    runAction(
      "demo-briefing",
      "Tell me what needs attention",
      "Give me an executive briefing on Northwind Labs: what matters, what needs attention, and what I can safely do next.",
      "Find the important signal in a live sample company."
    ),
    runAction(
      "demo-growth-opportunity",
      "Find a growth opportunity",
      "Inspect Northwind's current growth signals and propose one useful, governed experiment.",
      "Use real sample data to recommend a bounded experiment."
    ),
    runAction(
      "demo-approval-flow",
      "Create a customer follow-up",
      "Create a useful customer-facing follow-up for Northwind and walk me through the approval and receipt flow.",
      "Make a deliverable, then show how approval protects it."
    ),
    runAction(
      "demo-proof-trail",
      "Show the proof trail",
      "Show me recent Northwind activity and explain how AMOS proves what changed and why.",
      "See the evidence behind completed work."
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
      "workspace-attention",
      "Tell me what needs attention",
      "Inspect this workspace and anything I attach. Give me a concise briefing on what matters, what is unfinished or risky, and the best next task. Cite the evidence you used and ask for one useful source if the workspace is empty.",
      "Find the signal in the work already on this computer."
    ),
    runAction(
      "workspace-plan",
      "Build a plan from my files",
      "Inspect this workspace and anything I attach, then turn the evidence into a practical plan with priorities, dependencies, risks, and the next seven days. Cite the files you used and label assumptions.",
      "Turn documents, spreadsheets, and project files into action."
    ),
    runAction(
      "workspace-follow-up",
      "Find decisions and follow-ups",
      "Review this workspace and anything I attach. Extract decisions, commitments, owners, deadlines, open questions, and ready-to-review follow-up drafts. Do not send anything.",
      "Make sure decisions and commitments do not get lost."
    ),
    runAction(
      "workspace-research",
      "Research an opportunity",
      "Use the public web, this workspace, and anything I attach to research one opportunity I describe. Separate evidence from inference, cite sources, and recommend a concrete next move.",
      "Research the market and bring back a decision-ready answer."
    ),
    runAction(
      "workspace-deliverable",
      "Create the next deliverable",
      "Inspect this workspace and anything I attach, identify the highest-value deliverable that can be completed safely now, and create it. Explain what you verified and wait for approval before consequential actions.",
      "Move from discussion to a finished, reviewable artifact."
    )
  );
  return uniqueActions(actions).slice(0, MAX_STARTER_ACTIONS);
}

function runAction(id, label, prompt, description = "") {
  return {
    id,
    label,
    type: "run",
    prompt,
    description
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
