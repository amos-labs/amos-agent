import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import { profileCatalog } from "../src/desktop/relationshipProfile.js";

import {
  mergeRemoteProjection,
  mergeRemoteProjectionValue
} from "../src/desktop/remoteProjection.js";

test("remote state events project every refreshed platform surface into Desktop", async () => {
  const emitted = [];
  const controller = {
    identity: { principal_type: "user", tenant_id: "tenant-1", role: "owner" },
    accountStatus: { workspaceActive: true },
    companyApprovals: [{ id: "approval-1", status: "pending" }],
    missionDecisions: [{ id: "mission-decision-1", mission_id: "mission-1" }],
    companyReceipts: [{ id: "receipt-1", operation: "create_ad" }],
    approvalsAvailable: true,
    approvalDecisionMode: "desktop",
    connectionsCatalog: {
      connections: [{ id: "connection-1", provider: "microsoft_graph" }],
      providers: [{ provider: "microsoft_graph", displayName: "Microsoft 365" }]
    },
    briefings: {
      supported: true,
      contractVersion: 1,
      templates: [{ key: "daily_company_brief", title: "Daily company brief" }],
      briefings: [{ id: "briefing-1", title: "Daily company brief" }]
    },
    tasks: { supported: true, tasks: [{ id: "task-1", title: "Plan" }] },
    projects: {
      supported: true,
      projects: [{ id: "project-1", name: "Launch" }],
      inbox: [{ id: "run-1", status: "running" }],
      stalledCount: 0
    },
    activeTaskRecordId: "task-1",
    companies: {
      currentTenantId: "tenant-1",
      tenants: [{ tenant_id: "tenant-1", tenant_name: "AMOS Labs" }]
    },
    workingContinuity: null,
    remoteStatus: {
      syncing: false,
      lastSyncedAt: "2026-07-30T12:00:00.000Z",
      error: null,
      paused: false
    },
    async companyCacheState() { return { available: true }; },
    async offlineProposalState() { return [{ id: "proposal-1" }]; },
    async taskCheckpointState() { return [{ id: "checkpoint-1" }]; },
    send(channel, payload) { emitted.push({ channel, payload }); }
  };

  await DesktopController.prototype.sendRemoteState.call(controller);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].channel, "remote:changed");
  assert.deepEqual(emitted[0].payload, {
    identity: controller.identity,
    accountStatus: controller.accountStatus,
    approvals: controller.companyApprovals,
    missionDecisions: controller.missionDecisions,
    approvalsAvailable: true,
    approvalDecisionMode: "desktop",
    pendingInputs: [],
    companyReceipts: controller.companyReceipts,
    connectionsCatalog: controller.connectionsCatalog,
    briefings: controller.briefings,
    automations: { supported: false, automations: [] },
    automationTemplates: {
      supported: false,
      catalogVersion: 0,
      blueprints: [],
      templates: [],
      installationContract: "",
      standingGrantContract: { supported: false, defaultMode: "per_run", fallback: "" },
      operatorSetupContract: { primarySurface: "", sequence: [] }
    },
    automationSetup: null,
    browserRecipes: { supported: false, recipes: [] },
    tasks: controller.tasks,
    projects: controller.projects,
    missions: {
      supported: false,
      missions: [],
      optimizationMissions: [],
      templates: [],
      count: 0,
      scheduler: null,
      stale: false,
      refreshError: ""
    },
    companies: controller.companies,
    accounts: { currentAccountId: "legacy", accounts: [] },
    workingContinuity: null,
    relationshipProfile: {
      catalog: profileCatalog(),
      profile: null,
      available: false
    },
    activeContextKey: "active",
    activeTaskRecordId: "task-1",
    remoteStatus: controller.remoteStatus,
    companyCache: { available: true },
    offlineProposals: [{ id: "proposal-1" }],
    taskCheckpoints: [{ id: "checkpoint-1" }]
  });
});

test("Desktop review never silently opens hosted approval from an unbound session", async () => {
  let browserOpenCount = 0;
  const controller = {
    companyApprovals: [{ id: "approval-1", status: "pending" }],
    approvalDecisionMode: "hosted",
    async openApproval() { browserOpenCount += 1; }
  };

  const result = await DesktopController.prototype.reviewCompanyApproval.call(
    controller,
    "approval-1"
  );

  assert.deepEqual(result, { mode: "hosted", opened: false });
  assert.equal(browserOpenCount, 0);
});

test("remote libraries retain the last successful projection during a rollout gap", () => {
  const current = { supported: true, missions: [{ id: "mission-1" }], count: 1 };
  const merged = mergeRemoteProjectionValue(
    current,
    { supported: false, missions: [], count: 0 },
    { supported: false, missions: [], count: 0 },
    "AMOS Missions"
  );
  assert.equal(merged.supported, true);
  assert.equal(merged.stale, true);
  assert.equal(merged.missions[0].id, "mission-1");
  assert.match(merged.refreshError, /last successfully synced data/);
});

test("remote libraries retain the last successful projection after a rejected refresh", () => {
  const errors = [];
  const merged = mergeRemoteProjection({
    current: { supported: true, projects: [{ id: "project-1" }] },
    result: { status: "rejected", reason: new Error("temporary upstream error") },
    empty: { supported: false, projects: [] },
    label: "AMOS Projects",
    errors
  });
  assert.equal(merged.stale, true);
  assert.equal(merged.projects[0].id, "project-1");
  assert.deepEqual(errors, ["temporary upstream error"]);
});

test("a new successful projection replaces stale remote data", () => {
  const merged = mergeRemoteProjectionValue(
    { supported: true, briefings: [{ id: "old" }], stale: true },
    { supported: true, briefings: [{ id: "new" }] },
    { supported: false, briefings: [] },
    "AMOS Briefings"
  );
  assert.equal(merged.stale, false);
  assert.equal(merged.briefings[0].id, "new");
});
