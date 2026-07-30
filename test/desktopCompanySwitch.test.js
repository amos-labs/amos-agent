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
    notifiedApprovalIds: ["approval-from-source"]
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
