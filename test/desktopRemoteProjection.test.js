import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";

test("remote state events project every refreshed platform surface into Desktop", async () => {
  const emitted = [];
  const controller = {
    identity: {
      principal_type: "user",
      tenant_id: "tenant-1",
      role: "owner"
    },
    accountStatus: {
      workspaceActive: true
    },
    companyApprovals: [{ id: "approval-1", status: "pending" }],
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
    async companyCacheState() {
      return { available: true };
    },
    async offlineProposalState() {
      return [{ id: "proposal-1" }];
    },
    async taskCheckpointState() {
      return [{ id: "checkpoint-1" }];
    },
    send(channel, payload) {
      emitted.push({ channel, payload });
    }
  };

  await DesktopController.prototype.sendRemoteState.call(controller);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].channel, "remote:changed");
  assert.deepEqual(emitted[0].payload, {
    identity: controller.identity,
    accountStatus: controller.accountStatus,
    approvals: controller.companyApprovals,
    approvalsAvailable: true,
    approvalDecisionMode: "desktop",
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
    companies: controller.companies,
    accounts: { currentAccountId: "legacy", accounts: [] },
    workingContinuity: null,
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
    async openApproval() {
      browserOpenCount += 1;
    }
  };

  const result = await DesktopController.prototype.reviewCompanyApproval.call(
    controller,
    "approval-1"
  );

  assert.deepEqual(result, { mode: "hosted", opened: false });
  assert.equal(browserOpenCount, 0);
});
