import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";

function settingsStore() {
  let value = {
    operatingMode: "online",
    workspace: "/tmp/amos-outcome-test",
    amosMcpUrl: "https://app.amoslabs.com/mcp",
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

test("Desktop delivers an approved operation result once without replaying the call", async () => {
  const emitted = [];
  const queued = [];
  const store = settingsStore();
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-outcome-controller",
    settingsStore: store,
    openBrowser() {},
    emit(channel, payload) {
      emitted.push({ channel, payload });
    }
  });
  controller.identity = {
    principal_type: "user",
    tenant_id: "tenant-1",
    sub: "user-1"
  };
  controller.runtime = {
    runtime: {
      loop: {
        appendExternalOutcome(context) {
          queued.push(context);
          return true;
        }
      }
    }
  };
  controller.companyApprovals = [{
    id: "22222222-2222-2222-2222-222222222222",
    verb: "connection_operation_call",
    review_summary: "Count unique PostHog users",
    status: "approved",
    execution_result: { unique_users: 42 },
    execution_result_truncated: false
  }];

  await controller.deliverCompletedApprovalOutcomes();
  await controller.deliverCompletedApprovalOutcomes();

  const completions = emitted.filter((event) => event.channel === "approval:completed");
  assert.equal(completions.length, 1);
  assert.deepEqual(completions[0].payload.result, { unique_users: 42 });
  assert.equal(queued.length, 1);
  assert.match(queued[0], /immutable operation outcome/);
  assert.match(queued[0], /unique_users/);
  assert.deepEqual((await store.read()).deliveredApprovalOutcomeIds, [
    "22222222-2222-2222-2222-222222222222"
  ]);
});

test("Desktop delivers a denied operation once so the model is not left pending", async () => {
  const emitted = [];
  const queued = [];
  const store = settingsStore();
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-outcome-deny",
    settingsStore: store,
    openBrowser() {},
    emit(channel, payload) {
      emitted.push({ channel, payload });
    }
  });
  controller.identity = {
    principal_type: "user",
    tenant_id: "tenant-1",
    sub: "user-1"
  };
  controller.runtime = {
    runtime: {
      loop: {
        appendExternalOutcome(context) {
          queued.push(context);
          return true;
        }
      }
    }
  };
  controller.companyApprovals = [{
    id: "33333333-3333-3333-3333-333333333333",
    verb: "connection_call",
    review_summary: "Create AMS Subscriptions - Core 99",
    status: "denied",
    args: {
      connection: "quickbooks",
      method: "POST",
      path: "/v3/company/{realm_id}/account"
    },
    execution_result: null
  }];

  await controller.deliverCompletedApprovalOutcomes();
  await controller.deliverCompletedApprovalOutcomes();

  const denials = emitted.filter((event) => event.channel === "approval:denied");
  assert.equal(denials.length, 1);
  assert.equal(denials[0].payload.status, "denied");
  assert.equal(queued.length, 1);
  assert.match(queued[0], /DENIED by a human/);
  assert.match(queued[0], /was not executed/);
  assert.doesNotMatch(queued[0], /immutable operation outcome/);
  assert.deepEqual((await store.read()).deliveredApprovalOutcomeIds, [
    "33333333-3333-3333-3333-333333333333"
  ]);
});
