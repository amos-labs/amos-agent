import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkflowWorkspace,
  workspaceAllowsView,
  workspacePath,
  workspaceSnapshotInclude,
  workflowSetupActions,
} from "../src/desktop/workflowWorkspace.js";
import { selectJourneyStarterActions } from "../src/desktop/journeyStarterActions.js";

const tenant = "11111111-1111-4111-8111-111111111111";
function payload() {
  return {
    schema: "amos.workflow_workspace.v1",
    tenant_id: tenant,
    mode: "focused",
    revision: 2,
    package_keys: ["rfp-capture"],
    recommended_package_keys: ["finance-operations"],
    catalog: [
      {
        key: "rfp-capture",
        version: 1,
        title: "RFP & capture",
        setup_note: "Source configuration required.",
        setup_prompt: "Set up my RFP workflow.",
      },
      {
        key: "finance-operations",
        version: 1,
        title: "Finance",
        setup_prompt: "Set up finance.",
      },
    ],
    navigation: [
      { key: "pipeline", label: "Pipeline", web_path: "/crm" },
      {
        key: "automations",
        label: "RFP automations",
        web_path: "/marketing",
        desktop_view: "automations",
      },
    ],
  };
}

test("only explicitly selected workflows contribute navigation and setup actions", () => {
  const workspace = normalizeWorkflowWorkspace(payload(), tenant);
  assert.equal(workspaceAllowsView(workspace, tenant, "automations"), true);
  assert.equal(
    workspaceAllowsView(workspace, tenant, "surface:finance"),
    false,
  );
  assert.equal(workspaceAllowsView(workspace, tenant, "missions"), false);
  assert.equal(workspaceAllowsView(workspace, tenant, "work"), true);
  assert.equal(workspaceAllowsView(workspace, tenant, "tasks"), true);
  assert.deepEqual(
    workflowSetupActions(workspace).map((action) => action.id),
    ["workflow-rfp-capture"],
  );
  const actions = selectJourneyStarterActions({
    identity: { tenant_id: tenant },
    workflowWorkspace: workspace,
  });
  assert.deepEqual(
    actions.map((action) => action.id),
    ["workflow-rfp-capture"],
  );
  assert.ok(!workspaceSnapshotInclude(workspace).includes("finance"));
  assert.ok(!workspaceSnapshotInclude(workspace).includes("projects"));
  assert.ok(workspaceSnapshotInclude(workspace).includes("approvals"));
});

test("a company switch rejects the prior workspace and old servers retain normal navigation", () => {
  assert.equal(
    normalizeWorkflowWorkspace(payload(), "different-company").supported,
    false,
  );
  assert.equal(
    workspaceAllowsView(normalizeWorkflowWorkspace(null), tenant, "missions"),
    true,
  );
  const full = normalizeWorkflowWorkspace(
    { ...payload(), mode: "full" },
    tenant,
  );
  assert.equal(workspaceAllowsView(full, tenant, "surface:finance"), true);
  assert.equal(workspaceSnapshotInclude(full), null);
});

test("untrusted navigation cannot become an external URL or executable view", () => {
  for (const path of [
    "javascript:alert(1)",
    "//other.test",
    "/%2fother.test",
    "/\\other.test",
    "/%5cother.test",
    "/\nother.test",
  ])
    assert.equal(workspacePath(path), null);
  assert.equal(workspacePath("/crm/c/people"), "/crm/c/people");
  const value = payload();
  value.navigation.push({
    key: "bad",
    label: "Bad",
    web_path: "//other.test",
    desktop_view: "settings<script>",
  });
  assert.equal(
    normalizeWorkflowWorkspace(value, tenant).navigation.some(
      (item) => item.key === "bad",
    ),
    false,
  );
});

test("a withdrawn selected catalog entry keeps the focused workspace narrow", () => {
  const value = payload();
  value.catalog = [];
  value.navigation = [];
  const workspace = normalizeWorkflowWorkspace(value, tenant);
  assert.equal(workspace.mode, "focused");
  assert.equal(
    workspaceAllowsView(workspace, tenant, "surface:finance"),
    false,
  );
});

test("an unconfigured or changed workspace opens workflow review, not generic engines", () => {
  for (const change of [{ package_keys: [] }, { requires_review: true }]) {
    const workspace = normalizeWorkflowWorkspace(
      { ...payload(), ...change },
      tenant,
    );
    const actions = selectJourneyStarterActions({
      identity: { tenant_id: tenant },
      workflowWorkspace: workspace,
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "workflow_settings");
  }
});
