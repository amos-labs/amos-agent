import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";

const sourceTenant = "25deefb7-0e4f-43ad-8b2f-f2f86fac6594";
const targetTenant = "35deefb7-0e4f-43ad-8b2f-f2f86fac6594";

function settingsStore() {
  let value = {
    operatingMode: "online",
    amosMcpUrl: "https://app.amoslabs.com/mcp",
    provider: "amos-hosted",
    model: "auto",
    baseUrl: "",
    apiKey: "",
    reasoningEffort: "medium",
    workspace: "/tmp",
    notifiedApprovalIds: ["approval-from-source"],
    notifiedMissionDecisionIds: ["mission-decision-from-source"],
    deliveredApprovalOutcomeIds: ["outcome-from-source"]
  };
  return {
    async read() {
      return value;
    },
    async write(next) {
      value = next;
      return value;
    }
  };
}

function controllerFixture() {
  let cacheCleared = false;
  let switchedTo = null;
  const store = settingsStore();
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-company-switch-controller",
    settingsStore: store,
    companyCacheStore: {
      async clear() {
        cacheCleared = true;
      },
      async status() {
        return { status: "empty", available: false };
      }
    },
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({
    async status() {
      return { access_token: "desktop-user-token" };
    },
    async switchCompany(tenantId) {
      switchedTo = tenantId;
    }
  });
  controller.identity = {
    principal_type: "user",
    sub: "source-user",
    tenant_id: sourceTenant,
    tenant_slug: "amos-labs",
    role: "owner"
  };
  controller.companies = {
    currentTenantId: sourceTenant,
    tenants: [
      {
        user_id: "source-user",
        tenant_id: sourceTenant,
        tenant_name: "AMOS Labs",
        tenant_slug: "amos-labs",
        role: "owner"
      },
      {
        user_id: "target-user",
        tenant_id: targetTenant,
        tenant_name: "Smile Wise",
        tenant_slug: "smile-wise",
        role: "owner"
      }
    ]
  };
  controller.canvases.canvases = [{ id: "source-briefing" }];
  controller.activity = [{ id: "source-activity" }];
  controller.refreshRemote = async () => {
    controller.identity = {
      principal_type: "user",
      sub: "target-user",
      tenant_id: targetTenant,
      tenant_slug: "smile-wise",
      role: "owner"
    };
    controller.companies.currentTenantId = targetTenant;
    return controller.state();
  };
  return {
    controller,
    store,
    cacheWasCleared: () => cacheCleared,
    switchedTenant: () => switchedTo
  };
}

test("Desktop switches only to advertised memberships and clears ephemeral company context", async () => {
  const fixture = controllerFixture();

  const state = await fixture.controller.switchCompany(targetTenant);

  assert.equal(fixture.switchedTenant(), targetTenant);
  assert.equal(fixture.cacheWasCleared(), true);
  assert.equal(state.identity.tenant_id, targetTenant);
  assert.equal(state.companies.currentTenantId, targetTenant);
  assert.deepEqual(state.canvases, []);
  assert.equal(state.activity.some((item) => item.summary === "Switched to Smile Wise"), true);
  assert.deepEqual((await fixture.store.read()).notifiedApprovalIds, []);
  assert.deepEqual((await fixture.store.read()).notifiedMissionDecisionIds, []);
  assert.deepEqual((await fixture.store.read()).deliveredApprovalOutcomeIds, []);
});

test("Desktop refuses unadvertised companies and switching during active work", async () => {
  const fixture = controllerFixture();
  await assert.rejects(
    fixture.controller.switchCompany("45deefb7-0e4f-43ad-8b2f-f2f86fac6594"),
    /not available/
  );

  fixture.controller.activeTask = { id: "active-task" };
  await assert.rejects(
    fixture.controller.switchCompany(targetTenant),
    /Finish or stop the current task/
  );
  assert.equal(fixture.switchedTenant(), null);
});

test("Desktop switches independently authenticated accounts and clears every live boundary", async () => {
  const store = settingsStore();
  let activeAccountId = "account-1";
  let activeApprovalKeyId = "";
  let cacheCleared = false;
  const accountStore = {
    async list() {
      return {
        currentAccountId: activeAccountId,
        accounts: [
          { id: "account-1", label: "AMOS Labs", tenantSlug: "amos-labs" },
          { id: "account-2", label: "Smile Wise", tenantSlug: "smile-wise" }
        ]
      };
    },
    async activate(id) {
      activeAccountId = id;
    },
    async activeApprovalKeyId() {
      return activeAccountId === "account-1"
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222";
    }
  };
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-account-switch-controller",
    settingsStore: store,
    accountStore,
    decisionKeyStore: {
      async activate(id) { activeApprovalKeyId = id; }
    },
    taskCheckpointStore: {
      async list() {
        return [
          { id: "task-source", source: { subjectId: "source-user", tenantId: sourceTenant } },
          { id: "task-target", source: { subjectId: "target-user", tenantId: targetTenant } }
        ];
      }
    },
    offlineProposalStore: {
      async list() {
        return [
          { id: "draft-source", source: { subjectId: "source-user", tenantId: sourceTenant } },
          { id: "draft-target", source: { subjectId: "target-user", tenantId: targetTenant } }
        ];
      }
    },
    companyCacheStore: {
      async clear() { cacheCleared = true; },
      async status() { return { status: "empty", available: false }; }
    },
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({
    async status() { return { access_token: `${activeAccountId}-token` }; }
  });
  controller.identity = { principal_type: "user", tenant_id: sourceTenant };
  controller.companyApprovals = [{ id: "source-approval" }];
  controller.attachments.items = new Map([["source-attachment", { id: "source-attachment" }]]);
  controller.canvases.canvases = [{ id: "source-canvas" }];
  controller.canvasResults.results = [{ id: "source-result" }];
  controller.activity = [{ id: "source-activity" }];
  controller.refreshRemote = async () => {
    controller.identity = {
      principal_type: "user",
      tenant_id: targetTenant,
      tenant_slug: "smile-wise",
      user: { id: "target-user", name: "Rick Barkley", email: "rick@smilewise.com" }
    };
  };

  const state = await controller.switchAccount("account-2");

  assert.equal(activeAccountId, "account-2");
  assert.equal(activeApprovalKeyId, "22222222-2222-4222-8222-222222222222");
  assert.equal(cacheCleared, true);
  assert.equal(state.identity.tenant_id, targetTenant);
  assert.deepEqual(state.approvals, []);
  assert.deepEqual(state.attachments, []);
  assert.deepEqual(state.canvases, []);
  assert.deepEqual(controller.canvasResults.results, []);
  assert.deepEqual(state.taskCheckpoints.map((item) => item.id), ["task-target"]);
  assert.deepEqual(state.offlineProposals.map((item) => item.id), ["draft-target"]);
  assert.equal(state.activity.some((item) => item.summary === "Switched to Smile Wise"), true);

  controller.activeTask = { id: "active" };
  await assert.rejects(controller.switchAccount("account-1"), /Finish or stop/);
  assert.equal(activeAccountId, "account-2");
});

test("Desktop authenticates a second login identity with a distinct approval key", async () => {
  const store = settingsStore();
  const legacyKey = {
    id: "11111111-1111-4111-8111-111111111111",
    publicKey: "a".repeat(43)
  };
  const secondKey = {
    id: "22222222-2222-4222-8222-222222222222",
    publicKey: "b".repeat(43)
  };
  let associatedLegacyKey = "";
  let addedApprovalKey = "";
  let loginApprovalKey = null;
  const accountStore = {
    async list() {
      return {
        currentAccountId: "account-1",
        accounts: [{ id: "account-1", label: "AMOS Labs" }]
      };
    },
    async activeApprovalKeyId() { return ""; },
    async setActiveApprovalKeyId(id) { associatedLegacyKey = id; },
    async add(_credentials, _profile, options) { addedApprovalKey = options.approvalKeyId; },
    async updateActiveProfile() {}
  };
  const decisionKeyStore = {
    async getDefault() { return legacyKey; },
    async create() { return secondKey; },
    async remove() { throw new Error("the successful key must not be removed"); }
  };
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-add-account-controller",
    settingsStore: store,
    accountStore,
    decisionKeyStore,
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = (_settings, options = {}) => options.store
    ? {
        async login(input) {
          loginApprovalKey = input.desktopApprovalKey;
          return { access_token: "nuvola-token", refresh_token: "nuvola-refresh" };
        }
      }
    : { async status() { return { access_token: "amos-token" }; } };
  controller.desktopInstallId = async () => "installation-1";
  controller.refreshRemote = async () => {
    controller.identity = {
      principal_type: "user",
      sub: "nuvola-user",
      tenant_id: targetTenant,
      tenant_slug: "nuvola",
      role: "owner"
    };
  };
  controller.recordAcquisitionEvent = async () => {};

  await controller.addAccount();

  assert.equal(associatedLegacyKey, legacyKey.id);
  assert.deepEqual(loginApprovalKey, secondKey);
  assert.equal(addedApprovalKey, secondKey.id);
});

test("selecting the current account returns Personal mode to its online company", async () => {
  const store = settingsStore();
  await store.write({ ...await store.read(), operatingMode: "personal" });
  let activated = false;
  let refreshed = false;
  const accountStore = {
    async list() {
      return {
        currentAccountId: "account-1",
        accounts: [{ id: "account-1", label: "AMOS Labs", tenantSlug: "amos-labs" }]
      };
    },
    async activate() { activated = true; }
  };
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-current-account-controller",
    settingsStore: store,
    accountStore,
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({
    async status() { return { access_token: "account-1-token" }; }
  });
  controller.refreshRemote = async () => {
    refreshed = true;
    controller.identity = {
      principal_type: "user",
      sub: "source-user",
      tenant_id: sourceTenant,
      tenant_slug: "amos-labs"
    };
  };

  const state = await controller.switchAccount("account-1");

  assert.equal(activated, false);
  assert.equal(refreshed, true);
  assert.equal((await store.read()).operatingMode, "online");
  assert.equal(state.mode.personal, false);
  assert.equal(state.identity.tenant_id, sourceTenant);
});
