import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../src/runtime.js";
import { WorkflowWorkspaceSession } from "../src/desktop/workflowWorkspaceSession.js";
import {
  normalizeWorkflowWorkspace,
  workflowOperatorPrompt,
  workflowSetupActions,
  workspaceUpdate,
} from "../src/desktop/workflowWorkspace.js";

const tenant = "11111111-1111-4111-8111-111111111111";
const digest = "a".repeat(64);
const identity = { tenant_id: tenant, role: "owner" };
const workspace = () =>
  normalizeWorkflowWorkspace({
    schema: "amos.workflow_workspace.v1",
    tenant_id: tenant,
    mode: "focused",
    revision: 2,
    catalog_sha256: digest,
    package_keys: ["rfp-capture"],
    catalog: [
      {
        key: "rfp-capture",
        title: "RFP & capture",
        setup_prompt: "Configure RFP discovery.",
      },
    ],
    navigation: [],
  });
const input = () => ({
  mode: "focused",
  packageKeys: ["rfp-capture"],
  tenantId: tenant,
  expectedRevision: 2,
  catalogSha256: digest,
});
const result = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
});

test("focused company registry is distinct from the personal/general runtime", () => {
  const focused = createRegistry({ workflowFocused: true });
  const names = new Set(focused.list().map((t) => t.name));
  for (const blocked of [
    "run_bash",
    "write_file",
    "apply_patch",
    "amos_load_engine_tools",
    "amos_resolve_capabilities",
    "desktop_spawn_subagent",
  ])
    assert.equal(names.has(blocked), false, blocked);
  for (const needed of [
    "amos_get_operator_context",
    "amos_load_workflow_tools",
    "desktop_calculate",
    "desktop_create_document",
    "web_fetch",
  ])
    assert.equal(names.has(needed), true, needed);
  const personal = new Set(
    createRegistry({ includeAmos: false })
      .list()
      .map((t) => t.name),
  );
  assert.equal(personal.has("run_bash"), true);
  assert.equal(personal.has("write_file"), true);
});

test("loaded workflow schemas invoke a pinned workflow, not a generic engine", async () => {
  const registry = createRegistry({ workflowFocused: true });
  const calls = [];
  const context = {
    registry,
    amosClient: {
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "get_workflow_tools")
          return result({
            schema: "amos.workflow_tools.v1",
            workflow_key: "rfp-capture",
            tools: [
              {
                name: "create_record",
                inputSchema: {
                  type: "object",
                  properties: { collection: { type: "string" } },
                },
              },
              {
                name: "create_mission",
                workflow_control: true,
                inputSchema: {
                  type: "object",
                  properties: {
                    objective: { type: "string" },
                    workflow_key: { type: "string" },
                  },
                },
              },
            ],
          });
        return result({ status: "ok" });
      },
    },
  };
  await registry.execute(
    "amos_load_workflow_tools",
    { workflow_key: "rfp-capture", toolkit: "data" },
    context,
  );
  const record = registry.list().find((t) => t.name.endsWith("_create_record"));
  const mission = registry
    .list()
    .find((t) => t.name.endsWith("_create_mission"));
  await registry.execute(record.name, { collection: "opportunities" }, context);
  assert.deepEqual(calls.at(-1), {
    name: "call_workflow_tool",
    args: {
      workflow_key: "rfp-capture",
      operation: "create_record",
      arguments: { collection: "opportunities" },
    },
  });
  await registry.execute(
    mission.name,
    {
      objective: "Prepare qualification packets",
      workflow_key: "finance-operations",
    },
    context,
  );
  assert.equal(calls.at(-1).name, "create_mission");
  assert.equal(
    calls.at(-1).args.workflow_key,
    "rfp-capture",
    "model arguments cannot change the loaded specialist scope",
  );
});

test("switching workflow toolkits replaces inactive schemas without collisions", async () => {
  const registry = createRegistry({ workflowFocused: true });
  const context = {
    registry,
    amosClient: {
      callTool: async (_name, args) =>
        result({
          schema: "amos.workflow_tools.v1",
          workflow_key: args.workflow_key,
          tools: [{ name: "create_record", inputSchema: { type: "object" } }],
        }),
    },
  };
  for (const args of [
    { workflow_key: "rfp-capture" },
    { workflow_key: "rfp-capture", toolkit: "data" },
    { workflow_key: "finance-operations", toolkit: "data" },
  ]) {
    const loaded = await registry.execute(
      "amos_load_workflow_tools",
      args,
      context,
    );
    assert.equal(loaded.ok, true);
    assert.equal(
      registry
        .list()
        .filter((tool) => tool.toolkit.startsWith("amos-workflow:")).length,
      1,
    );
  }
  assert.ok(
    registry.list().some((tool) => tool.name === "amos_load_workflow_tools"),
  );
});

test("long workflow tool names remain unique within provider name limits", async () => {
  const registry = createRegistry({ workflowFocused: true });
  const prefix = "a".repeat(70);
  const loaded = await registry.execute(
    "amos_load_workflow_tools",
    { workflow_key: "rfp-capture" },
    {
      registry,
      amosClient: {
        callTool: async () =>
          result({
            schema: "amos.workflow_tools.v1",
            workflow_key: "rfp-capture",
            tools: ["first", "second"].map((suffix) => ({
              name: prefix + suffix,
              inputSchema: { type: "object" },
            })),
          }),
      },
    },
  );
  assert.equal(new Set(loaded.registered_tools).size, 2);
  assert.ok(loaded.registered_tools.every((name) => name.length <= 64));
});

test("mismatched workflow schemas fail before any tool registration", async () => {
  const registry = createRegistry({ workflowFocused: true });
  const before = registry.list().length;
  await assert.rejects(
    registry.execute(
      "amos_load_workflow_tools",
      { workflow_key: "rfp-capture" },
      {
        registry,
        amosClient: {
          callTool: async () =>
            result({
              schema: "amos.workflow_tools.v1",
              workflow_key: "finance-operations",
              tools: [],
            }),
        },
      },
    ),
    /mismatched/,
  );
  assert.equal(registry.list().length, before);
});

test("workspace updates pin identity, revision, catalog and owner role", () => {
  const scope = workspace();
  assert.equal(
    workspaceUpdate(scope, identity, input()).expectedTenantId,
    tenant,
  );
  for (const bad of [
    { tenantId: "another" },
    { expectedRevision: 1 },
    { catalogSha256: "changed" },
    { packageKeys: ["finance-operations"] },
  ]) {
    assert.throws(() =>
      workspaceUpdate(scope, identity, { ...input(), ...bad }),
    );
  }
  assert.throws(
    () => workspaceUpdate(scope, { ...identity, role: "member" }, input()),
    /owner or admin/,
  );
});

test("workspace session resets on authority changes, not specialist progress", () => {
  let resets = 0;
  const session = new WorkflowWorkspaceSession({ onChange: () => resets++ });
  session.update(workspace());
  session.update({ ...workspace(), specialists: [{ status: "running" }] });
  assert.equal(resets, 1);
  session.update({ ...workspace(), requiresReview: true });
  assert.equal(resets, 2);
  session.update(null);
  assert.equal(resets, 3);
});

test("company switch while preparing a settings write prevents dispatch", async () => {
  const session = new WorkflowWorkspaceSession();
  session.update(workspace());
  let current = identity;
  let writes = 0;
  await assert.rejects(
    session.save(input(), {
      getIdentity: () => current,
      getRemote: async () => {
        current = { ...identity, tenant_id: "another" };
        return { setWorkflowWorkspace: async () => writes++ };
      },
      refresh: async () => {},
    }),
    /company changed/,
  );
  assert.equal(writes, 0);
});

test("a late refresh cannot restore the previous company's workspace", async () => {
  const session = new WorkflowWorkspaceSession();
  session.update(workspace());
  let finish;
  const pending = session.refresh(
    {
      workflowWorkspace: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
    identity,
  );
  session.update({ ...workspace(), tenantId: "another" });
  finish(workspace());
  await pending;
  assert.equal(session.current.tenantId, "another");
});

test("operator context is focused and existing work replaces repetitive setup prompts", () => {
  const scope = workspace();
  assert.match(
    workflowOperatorPrompt(scope, tenant),
    /main coordinating operator/,
  );
  assert.equal(workflowOperatorPrompt(scope, "another"), "");
  assert.match(workflowSetupActions(scope)[0].label, /Set up/);
  scope.specialists = [{ workflowKey: "rfp-capture", status: "running" }];
  assert.match(workflowSetupActions(scope)[0].label, /Review/);
});
