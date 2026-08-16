import test from "node:test";
import assert from "node:assert/strict";

import { DesktopController } from "../src/desktop/controller.js";

test("Desktop disconnects only a visible usable connection and refreshes governed state", async () => {
  const connectionId = "55555555-5555-4555-8555-555555555555";
  const calls = [];
  const controller = {
    connectionsCatalog: {
      connections: [{
        id: connectionId,
        provider: "quickbooks",
        displayName: "Finance QBO",
        status: "connected",
        usable: true
      }]
    },
    companyApprovals: [],
    approvalsAvailable: true,
    approvalDecisionMode: "hosted",
    settingsStore: { async read() { return { operatingMode: "online" }; } },
    async personalRemote(_settings, purpose) {
      assert.equal(purpose, "disconnecting this business system");
      return {
        async disconnectConnection(id) {
          calls.push(["disconnect", id]);
          return { status: "pending_approval", pending_id: "approval-1" };
        },
        async connectionsCatalog() {
          calls.push(["catalog"]);
          return controller.connectionsCatalog;
        },
        async approvals() {
          calls.push(["approvals"]);
          return {
            available: true,
            decision_mode: "desktop",
            pending_operations: [{ id: "approval-1", status: "pending" }]
          };
        }
      };
    },
    record(type, summary, detail) {
      calls.push(["record", type, summary, detail]);
    },
    async sendRemoteState() {
      calls.push(["state"]);
    }
  };

  const response = await DesktopController.prototype.disconnectConnection.call(
    controller,
    connectionId
  );
  assert.equal(response.result.pending_id, "approval-1");
  assert.deepEqual(response.approvals, [{ id: "approval-1", status: "pending" }]);
  assert.equal(controller.approvalDecisionMode, "desktop");
  assert.deepEqual(calls[0], ["disconnect", connectionId]);
  assert.equal(calls.at(-1)[0], "state");
});

test("Desktop rejects unknown and metadata-only disconnect requests before a remote call", async () => {
  const controller = {
    connectionsCatalog: {
      connections: [{
        id: "55555555-5555-4555-8555-555555555555",
        status: "connected",
        usable: false
      }]
    },
    settingsStore: {
      async read() {
        throw new Error("settings should not be read");
      }
    }
  };

  await assert.rejects(
    () => DesktopController.prototype.disconnectConnection.call(controller, "unknown"),
    /unknown connection/
  );
  await assert.rejects(
    () => DesktopController.prototype.disconnectConnection.call(
      controller,
      "55555555-5555-4555-8555-555555555555"
    ),
    /cannot disconnect/
  );
});

test("an applied disconnect disappears locally even if the catalog refresh is transiently unavailable", async () => {
  const connectionId = "55555555-5555-4555-8555-555555555555";
  const controller = {
    connectionsCatalog: {
      connections: [{
        id: connectionId,
        provider: "quickbooks",
        displayName: "Finance QBO",
        status: "connected",
        usable: true
      }],
      providers: [{ provider: "quickbooks", label: "QuickBooks" }]
    },
    companyApprovals: [],
    approvalsAvailable: true,
    approvalDecisionMode: "hosted",
    settingsStore: { async read() { return { operatingMode: "online" }; } },
    async personalRemote() {
      return {
        async disconnectConnection() { return { deleted: true, connection_id: connectionId }; },
        async connectionsCatalog() { throw new Error("temporary catalog outage"); },
        async approvals() {
          return { available: true, decision_mode: "hosted", pending_operations: [] };
        }
      };
    },
    record() {},
    async sendRemoteState() {}
  };

  const response = await DesktopController.prototype.disconnectConnection.call(
    controller,
    connectionId
  );
  assert.deepEqual(response.connectionsCatalog.connections, []);
  assert.equal(response.connectionsCatalog.providers[0].provider, "quickbooks");
});
