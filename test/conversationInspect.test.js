import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectConversation,
  createConversationInspectTool
} from "../src/model/conversationInspect.js";
import { pushRecentJob, selectWorkingObjective } from "../src/model/workingObjective.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { inferToolToolkit } from "../src/tools/toolkitCatalog.js";

test("selectWorkingObjective keeps a specific job across short follow-ups", () => {
  const job = "Update tax_behavior to inclusive on these three Stripe prices";
  assert.equal(selectWorkingObjective("", job), job);
  assert.equal(selectWorkingObjective(job, "lets try it again"), job);
  assert.equal(
    selectWorkingObjective(job, "Please refund $105.00 to the ten customers whose PaymentIntents never captured after 2D-auth, and document that we will eat the $8.58 tax."),
    "Please refund $105.00 to the ten customers whose PaymentIntents never captured after 2D-auth, and document that we will eat the $8.58 tax."
  );
});

test("a shorter new statement still hops jobs the way Desktop users actually work", () => {
  let jobs = [];
  const integration = "Help me build a Stripe to QuickBooks integration for AMOS Labs";
  const qbo = "We need to add these accounts to QBO";
  const tax = "Fix tax_behavior on the three Stripe prices";
  jobs = pushRecentJob(jobs, integration);
  jobs = pushRecentJob(jobs, qbo);
  jobs = pushRecentJob(jobs, tax);
  jobs = pushRecentJob(jobs, "try again");
  assert.deepEqual(jobs, [integration, qbo, tax]);
  assert.equal(selectWorkingObjective(integration, qbo), qbo);
  assert.equal(selectWorkingObjective(qbo, tax), tax);
  assert.equal(selectWorkingObjective(tax, "try again"), tax);
});

test("inspectConversation returns exact excerpts from omitted turns", () => {
  const result = inspectConversation([
    { role: "system", content: "system" },
    { role: "user", content: "hey" },
    { role: "user", content: "Update tax_behavior to inclusive on these three Stripe prices" },
    { role: "tool", content: "sk_live_secret_value 403 Forbidden form-urlencoded" }
  ], { query: "tax_behavior" });
  assert.equal(result.ok, true);
  assert.equal(result.matches.length, 1);
  assert.match(result.matches[0].excerpt, /tax_behavior/);
});

test("inspectConversation redacts live keys", () => {
  const result = inspectConversation([
    { role: "tool", content: "Authorization Bearer sk_live_supersecret 400" }
  ], { query: "400" });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.matches[0].excerpt, /sk_live_supersecret/);
  assert.match(result.matches[0].excerpt, /\[redacted\]/);
});

test("desktop_inspect_conversation is a core read-only tool", () => {
  const registry = new ToolRegistry({ progressive: true });
  registry.register(createConversationInspectTool(() => [
    { role: "user", content: "Update tax_behavior to inclusive" }
  ]));
  assert.equal(inferToolToolkit({ name: "desktop_inspect_conversation" }), "core");
  assert.equal(registry.executionPolicy("desktop_inspect_conversation").readOnly, true);
});
