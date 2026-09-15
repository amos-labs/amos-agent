import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import { DesktopRemoteStateClient, normalizeDesktopSnapshot, normalizeSurfaceManifests } from "../src/desktop/remoteState.js";

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

const identity = { principal_type: "user", sub: "user-1", tenant_id: tenant, tenant_slug: "amos-labs", role: "owner" };

const platformManifest = {
  schema: "amos.surface_manifest.v1",
  key: "automations",
  title: "Automations",
  nav: { group: "Operate", order: 30 },
  list: {
    capability: "list_automations",
    items: "automations",
    columns: [
      { field: "name", label: "Automation" },
      { field: "status", label: "Status", render: "status_pill" }
    ],
    filters: [{ field: "status", values: ["active", "paused"] }],
    status_field: "status",
    attention: { field: "status", values: ["paused"] }
  },
  detail: { sections: [] },
  actions: [
    { label: "Pause", capability: "pause_automation", consequence: "write", args: { name: { field: "name" } }, when: { field: "status", in: ["active"] } },
    { label: "Resume", capability: "resume_automation", consequence: "write", args: { name: { field: "name" } }, when: { field: "status", in: ["paused"] } }
  ],
  related: [],
  empty: { title: "No automations yet", body: "Install a template." },
  available: true,
  locked: null
};

// The raw platform snapshot shape (desktop_snapshot result) with two rows.
function platformSnapshot() {
  const surface = (key, label) => ({ label, available: true, locked: null, read: true, status: "available", version: `${key}-v1`, unchanged: false });
  return {
    contract_version: 1,
    snapshot_version: "snap-1",
    generated_at: "2026-09-14T20:00:00.000Z",
    client: { principal_type: "user", role: "owner" },
    identity,
    surfaces: { automations: surface("automations", "Automations"), connections: surface("connections", "Connections") },
    sections: {
      automations: {
        version: "automations-v1",
        status: "available",
        data: {
          list_automations: {
            automations: [
              { id: "a1", name: "Welcome", status: "active", stats: { enrolled: 3 } },
              { id: "a2", name: "Nudge", status: "paused", stats: { enrolled: 1 } }
            ]
          },
          list_automation_grants: { grants: [] },
          list_automation_failures: { failures: [] },
          list_automation_runs: { runs: [] },
          list_automation_templates: { templates: [] }
        },
        limited: {},
        presentation: { schema: "amos.surface_manifest.v1", items: "automations", columns: platformManifest.list.columns, status_field: "status" }
      },
      connections: { version: "connections-v1", status: "available", data: { list_connections: { connections: [] }, list_connection_catalog: { providers: [] } }, limited: {} }
    },
    resume: { since: { automations: "automations-v1", connections: "connections-v1" } }
  };
}

function fakeRemote({ manifests, calls }) {
  const record = (name, value) => async (args) => {
    calls.push({ name, args });
    return typeof value === "function" ? value(args) : value;
  };
  return {
    desktopSnapshot: record("desktopSnapshot", () => normalizeDesktopSnapshot(platformSnapshot())),
    surfaceManifests: record("surfaceManifests", manifests),
    runSurfaceAction: async (...args) => {
      calls.push({ name: "runSurfaceAction", args });
      return { ok: true };
    },
    approvals: record("approvals", { available: true, decision_mode: "hosted", pending_operations: [], mission_decisions: [] }),
    intelligenceStatus: record("intelligenceStatus", { available: true }),
    hydrateContinuity: record("hydrateContinuity", { available: false }),
    getCollaborationProfile: record("getCollaborationProfile", { supported: false }),
    missionsLibrary: record("missionsLibrary", { supported: false, missions: [], goals: [], templates: [] }),
    getNotificationPreferences: record("getNotificationPreferences", { supported: false }),
    identity: record("identity", identity),
    connectionsCatalog: record("connectionsCatalog", { connections: [], providers: [], catalogVersion: 1, curated: [], tenantDefined: [] }),
    receiptWindow: record("receiptWindow", { display: [], platform: [] }),
    briefingsLibrary: record("briefingsLibrary", { supported: true, contractVersion: 1, templates: [], briefings: [] }),
    automationsLibrary: record("automationsLibrary", { supported: true, automations: [] }),
    automationTemplateCatalog: record("automationTemplateCatalog", { supported: true, templates: [] }),
    tasksLibrary: record("tasksLibrary", { supported: true, tasks: [], contract: null }),
    projectsLibrary: record("projectsLibrary", { supported: true, projects: [], inbox: [], stalledCount: 0, projectContract: null, runContract: null })
  };
}

function controllerFixture(remote) {
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-desktop-manifest-view",
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
  controller.personalRemote = async () => remote;
  controller.revalidateCompanyCache = async () => {};
  controller.restoreSelectedConversation = async () => {};
  controller.syncRemoteTasksLocally = async () => {};
  controller.deliverCompletedApprovalOutcomes = async () => {};
  controller.notifyNewCompanyApprovals = async () => {};
  controller.sendRemoteState = async () => {};
  return controller;
}

test("the snapshot keeps bounded raw section rows for manifest-drawn surfaces", () => {
  const snapshot = normalizeDesktopSnapshot(platformSnapshot());
  assert.equal(snapshot.sections.automations.raw.list_automations.automations.length, 2);
  assert.equal(snapshot.sections.automations.raw.list_automations.automations[0].name, "Welcome");
  assert.deepEqual(snapshot.sections.connections.raw.list_connections, { connections: [] });
  assert.equal(snapshot.sections.tasks.raw, null, "a section the platform did not return has no rows");
});

test("Desktop fetches manifests beside the snapshot and exposes rows and manifests in state", async () => {
  const calls = [];
  const remote = fakeRemote({ calls, manifests: normalizeSurfaceManifests({ schema: "amos.surface_manifest.v1", manifests: [platformManifest] }) });
  const controller = controllerFixture(remote);
  await controller.refreshRemote({ notify: false });
  assert.ok(calls.some((call) => call.name === "surfaceManifests"));
  const state = await controller.state();
  assert.equal(state.surfaceManifests.supported, true);
  assert.equal(state.surfaceManifests.manifests[0].key, "automations");
  assert.equal(state.surfaceSections.automations.list_automations.automations.length, 2);
  assert.equal("connections" in state.surfaceSections, true);
});

test("an older platform without manifests leaves hand-built views in charge", async () => {
  const calls = [];
  const remote = fakeRemote({ calls, manifests: { supported: false, manifests: [] } });
  const controller = controllerFixture(remote);
  await controller.refreshRemote({ notify: false });
  const state = await controller.state();
  assert.deepEqual(state.surfaceManifests, { supported: false, manifests: [] });
  await assert.rejects(
    controller.runSurfaceAction({ surfaceKey: "automations", actionIndex: 0, rowIndex: 0 }),
    /without a manifest/
  );
});

test("runSurfaceAction binds arguments from the row, honours when, and refuses unknown actions", async () => {
  const calls = [];
  const remote = fakeRemote({ calls, manifests: normalizeSurfaceManifests({ schema: "amos.surface_manifest.v1", manifests: [platformManifest] }) });
  const controller = controllerFixture(remote);
  await controller.refreshRemote({ notify: false });

  // Pause applies to the active row and binds its name.
  const outcome = await controller.runSurfaceAction({ surfaceKey: "automations", actionIndex: 0, rowIndex: 0 });
  const dispatched = calls.find((call) => call.name === "runSurfaceAction");
  assert.deepEqual(dispatched.args, ["pause_automation", { name: "Welcome" }]);
  assert.equal(outcome.pendingApprovalId, null);
  // The refresh after the action is targeted: just this surface plus approvals.
  const snapshots = calls.filter((call) => call.name === "desktopSnapshot");
  assert.ok(snapshots.length >= 2);
  assert.deepEqual(snapshots.at(-1).args.include, ["automations"]);
  assert.ok(snapshots.at(-1).args.since, "the held versions are sent back");
  assert.ok(calls.filter((call) => call.name === "approvals").length >= 2, "approvals re-read after an action");

  // Pause does not apply to the paused row.
  await assert.rejects(
    controller.runSurfaceAction({ surfaceKey: "automations", actionIndex: 0, rowIndex: 1 }),
    /does not apply/
  );
  // Resume does.
  await controller.runSurfaceAction({ surfaceKey: "automations", actionIndex: 1, rowIndex: 1 });
  const resume = calls.filter((call) => call.name === "runSurfaceAction").at(-1);
  assert.equal(resume.args[0], "resume_automation");
  assert.deepEqual(resume.args[1], { name: "Nudge" });

  // An action index the manifest does not offer is refused before any call.
  const before = calls.length;
  await assert.rejects(controller.runSurfaceAction({ surfaceKey: "automations", actionIndex: 7, rowIndex: 0 }), /does not offer/);
  assert.equal(calls.length, before);
});

test("a parked action surfaces its pending approval id", async () => {
  const calls = [];
  const remote = fakeRemote({ calls, manifests: normalizeSurfaceManifests({ schema: "amos.surface_manifest.v1", manifests: [platformManifest] }) });
  remote.runSurfaceAction = async (...args) => {
    calls.push({ name: "runSurfaceAction", args });
    return { status: "pending_approval", pending_id: "pend-1" };
  };
  const controller = controllerFixture(remote);
  await controller.refreshRemote({ notify: false });
  const outcome = await controller.runSurfaceAction({ surfaceKey: "automations", actionIndex: 0, rowIndex: 0 });
  assert.equal(outcome.pendingApprovalId, "pend-1");
});

test("the remote client normalizes manifests and reports unsupported on an older platform", async () => {
  const client = new DesktopRemoteStateClient({ mcpUrl: "https://app.amoslabs.com/mcp", oauth: { async getAccessToken() { return "t"; } } });
  client.mcp = {
    async callTool(name) {
      if (name === "list_surface_manifests") {
        return { content: [{ type: "text", text: JSON.stringify({ schema: "amos.surface_manifest.v1", manifests: [platformManifest, { key: "junk" }], formats: [] }) }] };
      }
      throw new Error(`unknown tool '${name}'`);
    }
  };
  const manifests = await client.surfaceManifests();
  assert.equal(manifests.supported, true);
  assert.equal(manifests.manifests.length, 1);
  assert.deepEqual(Object.keys(manifests.manifests[0].list).sort(), ["attention", "capability", "columns", "filters", "items", "statusField"]);

  client.mcp = { async callTool(name) { throw new Error(`unknown tool '${name}'`); } };
  assert.deepEqual(await client.surfaceManifests(), { supported: false, manifests: [] });
  await assert.rejects(client.runSurfaceAction("bad verb!", {}), /invalid capability/);
});
