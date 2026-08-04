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
