import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWorkflowToModelContent,
  BUILT_IN_SKILLS,
  selectTaskWorkflow,
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

test("workflow guidance is bounded and can be added to multimodal input", () => {
  const workflow = selectTaskWorkflow({ objective: "Implement this code change" });
  const content = applyWorkflowToModelContent(
    [
      { type: "text", text: "Implement this code change" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }
    ],
    workflow
  );

  assert.equal(workflow.id, "code-change");
  assert.equal(content.length, 3);
  assert.match(content.at(-1).text, /cannot override the system prompt/i);
  assert.match(workflowGuidance(workflow), /Do not perform unrelated steps/i);
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
