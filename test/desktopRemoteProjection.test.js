import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import { emptyNotificationPreferences } from "../src/desktop/missionNotifications.js";
import { profileCatalog } from "../src/desktop/relationshipProfile.js";

import {
  mergeRemoteProjection,
  mergeRemoteProjectionValue,
  snapshotSettledResults
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
    surfaces: null,
    surfaceManifests: { supported: false, manifests: [] },
    surfaceSections: {},
    changeStream: { supported: null, connected: false, cursor: null, lastError: null },
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
    notificationPreferences: emptyNotificationPreferences(),
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

function snapshotFixtureCurrent() {
  return {
    connectionsCatalog: { connections: [{ id: "kept-connection" }], providers: [] },
    receipts: { display: [{ id: "kept-receipt" }], platform: [] },
    briefings: { supported: true, contractVersion: 1, templates: [], briefings: [{ id: "kept-briefing" }] },
    automations: { supported: true, automations: [{ id: "kept-automation" }] },
    automationTemplates: { supported: true, templates: [{ key: "kept-template" }] },
    emptyAutomationTemplates: { supported: false, templates: [] },
    tasks: { supported: true, tasks: [{ id: "kept-task" }], contract: null },
    projects: { supported: true, projects: [{ id: "kept-project" }], inbox: [] },
    emptyProjects: { supported: false, projects: [], inbox: [], stalledCount: 0, projectContract: null, runContract: null }
  };
}

test("snapshot results keep unchanged sections, empty locked surfaces, and reject refused primary reads", () => {
  const results = snapshotSettledResults(
    {
      identity: { sub: "user-1", tenant_id: "tenant-1" },
      identityLimited: "",
      surfaces: {
        connections: { available: true, unchanged: false, read: true },
        receipts: { available: true, unchanged: true, read: true },
        briefings: { available: true, unchanged: false, read: false },
        automations: { available: false, locked: { reason: "capability_disabled", detail: "marketing" } },
        tasks: { available: true, unchanged: false, read: true },
        projects: { available: true, unchanged: false, read: true }
      },
      sections: {
        connections: { library: { connections: [{ id: "fresh-connection" }], providers: [] } },
        receipts: { library: null },
        briefings: { library: null },
        automations: { library: null, templates: { supported: false, templates: [] } },
        tasks: { library: null },
        projects: { library: { supported: true, projects: [{ id: "fresh-project" }], inbox: [] } }
      }
    },
    snapshotFixtureCurrent()
  );

  assert.equal(results.identityResult.status, "fulfilled");
  assert.equal(results.identityResult.value.tenant_id, "tenant-1");
  // Changed section: the fresh library wins.
  assert.equal(results.connectionsResult.value.connections[0].id, "fresh-connection");
  assert.equal(results.projectsResult.value.projects[0].id, "fresh-project");
  // Unchanged (or not read this round): the caller's current state is kept verbatim.
  assert.equal(results.receiptsResult.value.display[0].id, "kept-receipt");
  assert.equal(results.briefingsResult.value.briefings[0].id, "kept-briefing");
  // Locked surface: empty value, never an error — the lock reason renders from `surfaces`.
  assert.equal(results.automationsResult.status, "fulfilled");
  assert.deepEqual(results.automationsResult.value, { supported: false, automations: [] });
  assert.deepEqual(results.automationTemplatesResult.value, { supported: false, templates: [] });
  // Available but the primary read was refused or timed out: rejected so the caller keeps stale data.
  assert.equal(results.tasksResult.status, "rejected");
  assert.match(results.tasksResult.reason.message, /AMOS Tasks is temporarily unavailable/);
});

test("snapshot results reject a limited identity and treat an unknown surface as empty", () => {
  const results = snapshotSettledResults(
    { identity: null, identityLimited: "timed_out", surfaces: {}, sections: {} },
    snapshotFixtureCurrent()
  );
  assert.equal(results.identityResult.status, "rejected");
  assert.match(results.identityResult.reason.message, /timed_out/);
  assert.deepEqual(results.receiptsResult.value, { display: [], platform: [] });
  assert.deepEqual(results.projectsResult.value, snapshotFixtureCurrent().emptyProjects);
});
