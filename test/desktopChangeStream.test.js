import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";

const tenant = "25deefb7-0e4f-43ad-8b2f-f2f86fac6594";
const identity = { principal_type: "user", sub: "user-1", tenant_id: tenant, tenant_slug: "amos-labs", role: "owner" };

function settingsStore(initial = {}) {
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
    deliveredApprovalOutcomeIds: [],
    ...initial
  };
  return {
    async read() {
      return value;
    },
    async write(next) {
      value = next;
      return value;
    },
    set(next) {
      value = { ...value, ...next };
    }
  };
}

function snapshotResponse({ include = null, round = 1 } = {}) {
  const read = (key) => include === null || include.includes(key);
  const surface = (key, label) => ({
    key,
    label,
    available: true,
    locked: null,
    read: read(key),
    status: "available",
    version: `${key}-v${round}`,
    unchanged: false
  });
  const since = {};
  for (const key of ["connections", "receipts", "briefings", "tasks", "projects"]) {
    if (read(key)) since[key] = `${key}-v${round}`;
  }
  return {
    supported: true,
    contractVersion: 1,
    snapshotVersion: `snap-${round}`,
    generatedAt: "2026-09-14T20:00:00.000Z",
    client: { principal_type: "user", role: "owner" },
    identity,
    identityLimited: "",
    surfaces: {
      approvals: surface("approvals", "Decisions"),
      connections: surface("connections", "Connections"),
      receipts: surface("receipts", "Proof"),
      briefings: surface("briefings", "Briefings"),
      automations: surface("automations", "Automations"),
      tasks: surface("tasks", "Conversations"),
      projects: surface("projects", "Projects")
    },
    sections: {
      connections: {
        library: read("connections")
          ? { connections: [{ id: `connection-r${round}` }], providers: [], catalogVersion: round, curated: [], tenantDefined: [] }
          : null
      },
      receipts: { library: read("receipts") ? { display: [{ id: `receipt-r${round}` }], platform: [] } : null },
      briefings: {
        library: read("briefings")
          ? { supported: true, contractVersion: 1, templates: [], briefings: [{ id: `briefing-r${round}` }] }
          : null
      },
      automations: {
        library: read("automations") ? { supported: true, automations: [] } : null,
        templates: { supported: true, templates: [] }
      },
      tasks: { library: read("tasks") ? { supported: true, tasks: [], contract: null } : null },
      projects: {
        library: read("projects")
          ? { supported: true, projects: [{ id: `project-r${round}` }], inbox: [], stalledCount: 0, projectContract: null, runContract: null }
          : null
      }
    },
    since
  };
}

function fakeRemote() {
  const calls = [];
  let round = 0;
  const record = (name, value) => async (args) => {
    calls.push({ name, args });
    return typeof value === "function" ? value(args) : value;
  };
  return {
    calls,
    desktopSnapshot: record("desktopSnapshot", (args) => {
      round += 1;
      return snapshotResponse({ include: args?.include ?? null, round });
    }),
    approvals: record("approvals", { available: true, decision_mode: "hosted", pending_operations: [], mission_decisions: [] }),
    intelligenceStatus: record("intelligenceStatus", { available: true }),
    hydrateContinuity: record("hydrateContinuity", { available: false }),
    getCollaborationProfile: record("getCollaborationProfile", { supported: false }),
    missionsLibrary: record("missionsLibrary", { supported: false, missions: [], goals: [], templates: [] }),
    getNotificationPreferences: record("getNotificationPreferences", { supported: false })
  };
}

function fakeStream() {
  const stream = {
    started: 0,
    stopped: 0,
    options: null,
    connected: true,
    start() {
      this.started += 1;
    },
    async stop() {
      this.stopped += 1;
      this.connected = false;
    },
    state() {
      return { supported: true, connected: this.connected, cursor: 3, lastError: null };
    }
  };
  return stream;
}

function fixture() {
  const remote = fakeRemote();
  const stream = fakeStream();
  const settings = settingsStore();
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-desktop-change-stream",
    settingsStore: settings,
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({
    async status() {
      return { access_token: "desktop-user-token" };
    },
    async companies() {
      return { current_tenant_id: tenant, tenants: [] };
    },
    async getAccessToken() {
      return "desktop-user-token";
    }
  });
  controller.refreshRemoteClient = () => remote;
  controller.createChangeStream = (options) => {
    stream.options = options;
    return stream;
  };
  controller.revalidateCompanyCache = async () => {};
  controller.restoreSelectedConversation = async () => {};
  controller.syncRemoteTasksLocally = async () => {};
  controller.deliverCompletedApprovalOutcomes = async () => {};
  controller.notifyNewCompanyApprovals = async () => {};
  controller.sendRemoteState = async () => {};
  return { controller, remote, stream, settings };
}

const snapshotCalls = (remote) => remote.calls.filter((c) => c.name === "desktopSnapshot");
const approvalCalls = (remote) => remote.calls.filter((c) => c.name === "approvals");

test("a snapshot-aware refresh starts one change stream for the platform origin and company", async () => {
  const { controller, stream } = fixture();
  const state = await controller.refreshRemoteInner({ notify: false });
  assert.equal(stream.started, 1);
  assert.equal(stream.options.origin, "https://app.amoslabs.com");
  assert.equal(typeof stream.options.getAccessToken, "function");
  assert.deepEqual(state.changeStream, { supported: true, connected: true, cursor: 3, lastError: null });
  // Same origin and company: a second refresh keeps the stream.
  await controller.refreshRemoteInner({ notify: false });
  assert.equal(stream.started, 1);
  assert.equal(stream.stopped, 0);
  // With a live stream the timer is a safety net, not a poll.
  assert.equal(controller.shouldPollRemote(), false);
  assert.equal(controller.shouldPollRemote({ safetyIntervalMs: 0 }), true);
  stream.connected = false;
  assert.equal(controller.shouldPollRemote(), true);
});

test("a connections change refetches only connections through desktop_snapshot include", async () => {
  const { controller, remote, stream } = fixture();
  await controller.refreshRemoteInner({ notify: false });
  const heldSince = { ...controller.snapshotSince };
  const receiptsBefore = controller.companyReceipts[0].id;
  assert.equal(approvalCalls(remote).length, 1);

  stream.options.onChange({ surface: "connections", hint: "create_connection", id: 4 });
  stream.options.onChange({ surface: "connections", hint: "delete_connection", id: 5 });
  await controller.flushSurfaceChanges();

  const targeted = snapshotCalls(remote).at(-1);
  assert.deepEqual(targeted.args, { since: heldSince, include: ["connections"] });
  assert.equal(controller.connectionsCatalog.connections[0].id, "connection-r2");
  assert.equal(controller.companyReceipts[0].id, receiptsBefore, "sections not named keep their state");
  assert.equal(controller.snapshotSince.connections, "connections-v2");
  assert.equal(controller.snapshotSince.receipts, heldSince.receipts, "held versions survive a targeted refetch");
  assert.equal(approvalCalls(remote).length, 1, "approvals are not refetched for a connections change");
  assert.equal(snapshotCalls(remote).length, 2);
});

test("an approvals change refreshes approvals through the REST read, not the snapshot", async () => {
  const { controller, remote, stream } = fixture();
  await controller.refreshRemoteInner({ notify: false });
  stream.options.onChange({ surface: "approvals", hint: "send_email@parked", id: 7 });
  await controller.flushSurfaceChanges();
  assert.equal(approvalCalls(remote).length, 2);
  assert.equal(snapshotCalls(remote).length, 1);
});

test("leaving online mode stops the stream and clears its state", async () => {
  const { controller, stream, settings } = fixture();
  await controller.refreshRemoteInner({ notify: false });
  assert.equal(stream.started, 1);
  settings.set({ operatingMode: "personal" });
  const state = await controller.refreshRemoteInner({ notify: false });
  assert.equal(stream.stopped, 1);
  assert.equal(controller.changeStream, null);
  assert.deepEqual(state.changeStream, { supported: null, connected: false, cursor: null, lastError: null });
  assert.equal(controller.shouldPollRemote(), true);
});

test("a platform without desktop_snapshot never opens a stream", async () => {
  const { controller, remote, stream } = fixture();
  remote.desktopSnapshot = async () => ({ supported: false });
  for (const name of ["identity", "connectionsCatalog", "receiptWindow", "briefingsLibrary", "automationsLibrary", "automationTemplateCatalog", "tasksLibrary", "projectsLibrary"]) {
    remote[name] = async () => (name === "identity" ? identity : { supported: false, display: [], platform: [], connections: [], providers: [], curated: [], tenantDefined: [], catalogVersion: 0, automations: [], templates: [], tasks: [], projects: [], inbox: [], briefings: [] });
  }
  await controller.refreshRemoteInner({ notify: false });
  assert.equal(stream.started, 0);
  assert.equal(controller.changeStream, null);
});
