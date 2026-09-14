import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";

const tenant = "25deefb7-0e4f-43ad-8b2f-f2f86fac6594";

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
    notifiedApprovalIds: [],
    notifiedMissionDecisionIds: [],
    deliveredApprovalOutcomeIds: []
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

const identity = {
  principal_type: "user",
  sub: "user-1",
  tenant_id: tenant,
  tenant_slug: "amos-labs",
  role: "owner"
};

function fakeRemote({ snapshot }) {
  const calls = [];
  const record = (name, value) => async (args) => {
    calls.push({ name, args });
    return typeof value === "function" ? value(args) : value;
  };
  return {
    calls,
    desktopSnapshot: record("desktopSnapshot", snapshot),
    approvals: record("approvals", {
      available: true,
      decision_mode: "hosted",
      pending_operations: [],
      mission_decisions: []
    }),
    intelligenceStatus: record("intelligenceStatus", { available: true }),
    hydrateContinuity: record("hydrateContinuity", { available: false }),
    getCollaborationProfile: record("getCollaborationProfile", { supported: false }),
    missionsLibrary: record("missionsLibrary", { supported: false, missions: [], goals: [], templates: [] }),
    getNotificationPreferences: record("getNotificationPreferences", { supported: false }),
    // The per-verb fan-out an older platform still needs.
    identity: record("identity", identity),
    connectionsCatalog: record("connectionsCatalog", {
      connections: [{ id: "fanout-connection" }],
      providers: [],
      catalogVersion: 1,
      curated: [],
      tenantDefined: []
    }),
    receiptWindow: record("receiptWindow", { display: [{ id: "fanout-receipt" }], platform: [] }),
    briefingsLibrary: record("briefingsLibrary", {
      supported: true,
      contractVersion: 1,
      templates: [],
      briefings: [{ id: "fanout-briefing" }]
    }),
    automationsLibrary: record("automationsLibrary", { supported: true, automations: [{ id: "fanout-automation" }] }),
    automationTemplateCatalog: record("automationTemplateCatalog", { supported: true, templates: [] }),
    tasksLibrary: record("tasksLibrary", { supported: true, tasks: [], contract: null }),
    projectsLibrary: record("projectsLibrary", {
      supported: true,
      projects: [{ id: "fanout-project" }],
      inbox: [],
      stalledCount: 0,
      projectContract: null,
      runContract: null
    })
  };
}

function controllerFixture(remote) {
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-desktop-snapshot-refresh",
    settingsStore: settingsStore(),
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({
    async status() {
      return { access_token: "desktop-user-token" };
    },
    async companies() {
      return { current_tenant_id: tenant, tenants: [] };
    }
  });
  controller.refreshRemoteClient = () => remote;
  // Local side effects of a refresh that have their own coverage elsewhere.
  controller.revalidateCompanyCache = async () => {};
  controller.restoreSelectedConversation = async () => {};
  controller.syncRemoteTasksLocally = async () => {};
  controller.deliverCompletedApprovalOutcomes = async () => {};
  controller.notifyNewCompanyApprovals = async () => {};
  controller.sendRemoteState = async () => {};
  return controller;
}

const fanoutVerbs = [
  "identity",
  "connectionsCatalog",
  "receiptWindow",
  "briefingsLibrary",
  "automationsLibrary",
  "automationTemplateCatalog",
  "tasksLibrary",
  "projectsLibrary"
];

function snapshotResponse({ since = {}, unchanged = [] } = {}) {
  const surface = (key, label, extra = {}) => ({
    key,
    label,
    available: true,
    locked: null,
    read: true,
    status: "available",
    version: `${key}-v1`,
    unchanged: unchanged.includes(key),
    ...extra
  });
  return {
    supported: true,
    contractVersion: 1,
    snapshotVersion: "snap-1",
    generatedAt: "2026-09-14T20:00:00.000Z",
    client: { principal_type: "user", role: "owner" },
    identity,
    identityLimited: "",
    surfaces: {
      approvals: surface("approvals", "Decisions"),
      connections: surface("connections", "Connections"),
      receipts: surface("receipts", "Proof"),
      briefings: surface("briefings", "Briefings"),
      automations: surface("automations", "Automations", {
        available: false,
        locked: { reason: "capability_disabled", detail: "marketing" },
        read: false
      }),
      tasks: surface("tasks", "Conversations"),
      projects: surface("projects", "Projects")
    },
    sections: {
      connections: {
        library: unchanged.includes("connections")
          ? null
          : { connections: [{ id: "snapshot-connection" }], providers: [], catalogVersion: 2, curated: [], tenantDefined: [] }
      },
      receipts: { library: { display: [{ id: "snapshot-receipt" }], platform: [] } },
      briefings: {
        library: { supported: true, contractVersion: 1, templates: [], briefings: [{ id: "snapshot-briefing" }] }
      },
      automations: { library: null, templates: { supported: false, templates: [] } },
      tasks: { library: { supported: true, tasks: [{ id: "snapshot-task" }], contract: null } },
      projects: {
        library: { supported: true, projects: [{ id: "snapshot-project" }], inbox: [], stalledCount: 0, projectContract: null, runContract: null }
      }
    },
    since: { connections: "connections-v1", receipts: "receipts-v1", ...since }
  };
}

test("Desktop refreshes from one snapshot and skips the per-verb fan-out when the platform supports it", async () => {
  const remote = fakeRemote({ snapshot: () => snapshotResponse() });
  const controller = controllerFixture(remote);

  const state = await controller.refreshRemoteInner({ notify: false });

  assert.deepEqual(remote.calls.filter((call) => fanoutVerbs.includes(call.name)), []);
  assert.deepEqual(remote.calls[0], { name: "desktopSnapshot", args: { since: null } });
  assert.equal(controller.identity.tenant_id, tenant);
  assert.equal(controller.connectionsCatalog.connections[0].id, "snapshot-connection");
  assert.equal(controller.companyReceipts[0].id, "snapshot-receipt");
  assert.equal(controller.briefings.briefings[0].id, "snapshot-briefing");
  assert.equal(controller.tasks.tasks[0].id, "snapshot-task");
  assert.equal(controller.projects.projects[0].id, "snapshot-project");
  // A locked surface empties its state and surfaces the reason for the renderer.
  assert.deepEqual(controller.automations, { supported: false, automations: [] });
  assert.equal(state.surfaces.automations.available, false);
  assert.equal(state.surfaces.automations.locked.detail, "marketing");
  assert.deepEqual(controller.snapshotSince, { connections: "connections-v1", receipts: "receipts-v1" });
  assert.equal(controller.remoteStatus.error, null);
});

test("Desktop sends the held versions back and keeps state for sections the platform marks unchanged", async () => {
  let round = 0;
  const remote = fakeRemote({
    snapshot: () => {
      round += 1;
      return round === 1 ? snapshotResponse() : snapshotResponse({ unchanged: ["connections"] });
    }
  });
  const controller = controllerFixture(remote);

  await controller.refreshRemoteInner({ notify: false });
  await controller.refreshRemoteInner({ notify: false });

  const snapshotCalls = remote.calls.filter((call) => call.name === "desktopSnapshot");
  assert.equal(snapshotCalls.length, 2);
  assert.deepEqual(snapshotCalls[1].args, {
    since: { connections: "connections-v1", receipts: "receipts-v1" }
  });
  assert.equal(controller.connectionsCatalog.connections[0].id, "snapshot-connection");
  assert.equal(controller.connectionsCatalog.catalogVersion, 2);
  assert.deepEqual(remote.calls.filter((call) => fanoutVerbs.includes(call.name)), []);
});

test("Desktop falls back to the per-verb reads on a platform without desktop_snapshot", async () => {
  const remote = fakeRemote({ snapshot: { supported: false } });
  const controller = controllerFixture(remote);

  const state = await controller.refreshRemoteInner({ notify: false });

  const fanout = remote.calls.filter((call) => fanoutVerbs.includes(call.name)).map((call) => call.name);
  assert.deepEqual(fanout.sort(), [...fanoutVerbs].sort());
  assert.equal(controller.identity.tenant_id, tenant);
  assert.equal(controller.connectionsCatalog.connections[0].id, "fanout-connection");
  assert.equal(controller.companyReceipts[0].id, "fanout-receipt");
  assert.equal(controller.briefings.briefings[0].id, "fanout-briefing");
  assert.equal(controller.automations.automations[0].id, "fanout-automation");
  assert.equal(controller.projects.projects[0].id, "fanout-project");
  assert.equal(state.surfaces, null);
  assert.equal(controller.snapshotSince, null);
  assert.equal(controller.remoteStatus.error, null);
});

test("Desktop falls back and reports the error when the snapshot itself fails", async () => {
  const remote = fakeRemote({
    snapshot: async () => {
      throw new Error("load discovery entitlements: connection refused");
    }
  });
  const controller = controllerFixture(remote);

  await controller.refreshRemoteInner({ notify: false });

  const fanout = remote.calls.filter((call) => fanoutVerbs.includes(call.name));
  assert.equal(fanout.length, fanoutVerbs.length);
  assert.equal(controller.connectionsCatalog.connections[0].id, "fanout-connection");
  assert.match(controller.remoteStatus.error, /connection refused/);
});

test("Desktop clears snapshot versions at every company boundary", async () => {
  const remote = fakeRemote({ snapshot: () => snapshotResponse() });
  const controller = controllerFixture(remote);
  await controller.refreshRemoteInner({ notify: false });
  assert.ok(controller.snapshotSince);
  assert.ok(controller.surfaces);

  controller.clearEphemeralCompanyBoundary();

  assert.equal(controller.snapshotSince, null);
  assert.equal(controller.surfaces, null);
});
