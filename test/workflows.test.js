import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWorkflowToModelContent,
  BUILT_IN_SKILLS,
  resolveTaskWorkflow,
  selectTaskWorkflow,
  taskWorkflowCatalog,
  taskWorkflowFromId,
  withWorkflowToolkits,
  workflowGuidance
} from "../src/workflows.js";

test("a GitHub issue URL selects the issue-diagnosis workflow", () => {
  const workflow = selectTaskWorkflow({
    objective: "Please diagnose https://github.com/NuvolaNetworks/cuspr/issues/312"
  });

  assert.equal(workflow.id, "github-issue-diagnosis");
  assert.ok(workflow.skills.some((skill) => skill.id === "version-config-comparison"));
  assert.match(workflow.doneWhen, /root cause/i);
});

test("attachments select document analysis without overriding explicit issue work", () => {
  assert.equal(
    selectTaskWorkflow({
      objective: "Review the attached material",
      attachmentNames: ["proposal.pdf"]
    }).id,
    "document-analysis"
  );
  assert.equal(
    selectTaskWorkflow({
      objective: "Diagnose https://github.com/amos-labs/amos-agent/issues/1",
      attachmentNames: ["notes.pdf"]
    }).id,
    "github-issue-diagnosis"
  );
});

test("Excel and financial-model requests select deterministic spreadsheet modeling", () => {
  const workflow = selectTaskWorkflow({
    objective: "Build an Excel financial model with four ARR scenarios and a hiring plan"
  });
  assert.equal(workflow.id, "spreadsheet-model");
  assert.ok(workflow.skills.some((skill) => skill.id === "spreadsheet-modeling"));
  assert.match(workflow.doneWhen, /baselines pass/i);
});

test("deterministic task evidence wins when the local router is cold or disagrees", () => {
  assert.equal(
    resolveTaskWorkflow({
      objective: "Review our current assumptions and build the plan",
      attachmentNames: ["AMOS Labs Financial Model.xlsx"],
      routedWorkflowId: "outcome-execution"
    }).id,
    "spreadsheet-model"
  );
  assert.equal(
    resolveTaskWorkflow({
      objective: "Hello there",
      routedWorkflowId: "research-brief"
    }).id,
    "research-brief"
  );
});

test("workflow guidance is bounded and can be added to multimodal input", () => {
  const workflow = selectTaskWorkflow({ objective: "Implement this code change" });
  const content = applyWorkflowToModelContent(
    [
      { type: "text", text: "Implement this code change" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }
    ],
    workflow
  );

  assert.equal(
    selectTaskWorkflow({ objective: "plan then implement this refactor" }).id,
    "plan-implement-verify"
  );
  assert.equal(workflow.id, "code-change");
  assert.equal(content.length, 3);
  assert.match(content.at(-1).text, /cannot override the system prompt/i);
  assert.match(workflowGuidance(workflow), /Do not perform unrelated steps/i);
  assert.ok(workflowGuidance(workflow).length < 1_100);
  assert.doesNotMatch(workflowGuidance(workflow), /Reusable skills:/i);
  assert.ok(BUILT_IN_SKILLS.length >= 8);
});

test("unmatched work receives a general evidence-and-verification workflow", () => {
  const workflow = selectTaskWorkflow({ objective: "Hello there" });
  assert.equal(workflow.id, "outcome-execution");
  assert.deepEqual(
    workflow.skills.map((skill) => skill.id),
    ["evidence-collection", "verification"]
  );
});

test("PR rework language selects the GitHub diagnosis route", () => {
  assert.equal(
    selectTaskWorkflow({ objective: "ok.... 637 is still in rework, fix the PR" }).id,
    "github-issue-diagnosis"
  );
});

test("an inherited coding work frame keeps follow-ups on the coding toolkit", () => {
  assert.equal(
    resolveTaskWorkflow({
      objective: "ok...it seems like we are goign in circles here?",
      workFrame: { family: "coding", pullRequest: "https://github.com/amos-labs/amos-managed-platform/pull/637" }
    }).id,
    "github-issue-diagnosis"
  );
});

test("the classifier catalog maps workflows to bounded initial toolkits", () => {
  const catalog = taskWorkflowCatalog();
  assert.deepEqual(
    catalog.find((workflow) => workflow.id === "spreadsheet-model")?.toolkits,
    ["calculations", "spreadsheets"]
  );
  assert.deepEqual(
    taskWorkflowFromId("code-change")?.toolkits,
    ["workspace"]
  );
  assert.equal(taskWorkflowFromId("unknown"), null);
  assert.equal(catalog.some((workflow) => workflow.id === "plan-implement-verify"), false);
  assert.deepEqual(
    withWorkflowToolkits(taskWorkflowFromId("code-change"), ["collaboration"]).toolkits,
    ["workspace", "collaboration"]
  );
  assert.equal(new Set(catalog.map((workflow) => workflow.id)).size, catalog.length);
});
