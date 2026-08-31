import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  approvalReviewUrl,
  DesktopRemoteStateClient,
  missionDecisionReviewUrl,
  parseMcpJson
} from "../src/desktop/remoteState.js";
import {
  COMPANY_CACHE_AUDIENCE,
  COMPANY_CACHE_FORMAT,
  COMPANY_CACHE_TOKEN_TYPE,
  COMPANY_CACHE_VERSION
} from "../src/desktop/companyCache.js";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("Desktop remote state resolves the signed-in user and their approvals", async () => {
  const requests = [];
  const oauth = {
    async getAccessToken() {
      return "user-access-token";
    }
  };
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth
    },
    async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/mcp")) {
        return response(200, {
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  sub: "11111111-1111-1111-1111-111111111111",
                  tenant_slug: "amos-labs",
                  role: "owner",
                  principal_type: "user",
                  user: { name: "Rick", email: "rick@amoslabs.com" }
                })
              }
            ]
          }
        });
      }
      return response(200, {
        decision_mode: "desktop",
        pending_operations: [
          {
            id: "22222222-2222-2222-2222-222222222222",
            verb: "create_ad",
            status: "pending",
            review_summary: "Create Ad: launch the governed campaign",
            approval_url:
              "https://app.amoslabs.com/approvals/22222222-2222-2222-2222-222222222222",
            args: { name: "Enterprise proof" },
            execution_result: { unique_users: 42 },
            execution_result_sha256: "abc123",
            execution_result_truncated: false
          }
        ],
        mission_decisions: [{
          id: "33333333-3333-3333-3333-333333333333",
          mission_id: "44444444-4444-4444-4444-444444444444",
          contract_id: "55555555-5555-5555-5555-555555555555",
          mission_name: "Build partner pipeline",
          objective: "Find 500 qualified partners",
          question: "Should I focus on MSPs or VARs first?",
          options: ["MSPs", "VARs"],
          context: { checkpoint: "segmentation" },
          authority_expansion: false,
          created_at: "2026-08-28T10:00:00Z",
          decision_url:
            "https://app.amoslabs.com/mission-decisions/33333333-3333-3333-3333-333333333333"
        }]
      });
    }
  );

  const identity = await client.identity();
  const approvals = await client.approvals();

  assert.equal(identity.user.email, "rick@amoslabs.com");
  assert.equal(identity.principal_type, "user");
  assert.equal(approvals.available, true);
  assert.equal(approvals.decision_mode, "desktop");
  assert.equal(approvals.pending_operations[0].review_summary, "Create Ad: launch the governed campaign");
  assert.deepEqual(approvals.pending_operations[0].execution_result, { unique_users: 42 });
  assert.equal(approvals.mission_decisions[0].mission_name, "Build partner pipeline");
  assert.deepEqual(approvals.mission_decisions[0].options, ["MSPs", "VARs"]);
  assert.equal(requests[1].url, "https://app.amoslabs.com/api/v1/approvals");
  assert.equal(requests[1].options.headers.Authorization, "Bearer user-access-token");
});

test("Desktop projects bounded tenant proof from the canonical AMOS receipt ledger", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "proof-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              tenant_id: "tenant-1",
              count: 1,
              receipts: [{
                id: "receipt-1",
                operation: "create_ad",
                actor: "user-1",
                agency: "human_directed",
                lifecycle_state: "executed",
                effect_applied: true,
                verified: true,
                created_at: "2026-08-03T17:00:00.000Z",
                receipt: {
                  result_summary: "Campaign created and verified",
                  inputs: { secret: "must-not-project" },
                  outputs: { provider_payload: "must-not-project" }
                }
              }]
            })
          }]
        }
      });
    }
  );

  const receipts = await client.receipts({ limit: 500 });

  assert.equal(requests[0].params.name, "list_receipts");
  assert.deepEqual(requests[0].params.arguments, { limit: 200 });
  assert.deepEqual(receipts, [{
    id: "receipt-1",
    operation: "create_ad",
    actor: "user-1",
    agency: "human_directed",
    lifecycleState: "executed",
    effectApplied: true,
    verified: true,
    summary: "Campaign created and verified",
    createdAt: "2026-08-03T17:00:00.000Z"
  }]);
  assert.equal(receipts[0].inputs, undefined);
  assert.equal(receipts[0].outputs, undefined);
});

test("Desktop Briefings use only platform-owned templates, definitions, runs, and schedules", async () => {
  const calls = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "briefing-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.params);
      const name = request.params.name;
      const payload = name === "list_briefing_templates"
        ? { contract_version: 1, templates: [{ key: "daily_company_brief", title: "Daily company brief" }] }
        : name === "list_briefings"
          ? { contract_version: 1, briefings: [{ id: "11111111-1111-4111-8111-111111111111", title: "Daily" }] }
          : name === "run_briefing"
            ? { run: { id: "run-1" }, result: { state: "ready" } }
            : name === "get_briefing_run"
              ? { definition: { title: "Daily" }, run: { id: "22222222-2222-4222-8222-222222222222" }, result: { state: "ready" } }
            : { schedule: { id: "schedule-1", status: "active" } };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const library = await client.briefingsLibrary();
  await client.runBriefing({ templateKey: "daily_company_brief" });
  await client.briefingRun("22222222-2222-4222-8222-222222222222");
  await client.scheduleBriefing(
    "11111111-1111-4111-8111-111111111111",
    { kind: "weekly", weekday: 2, hourUtc: 8, minuteUtc: 30 }
  );

  assert.equal(library.supported, true);
  assert.equal(library.templates[0].key, "daily_company_brief");
  assert.deepEqual(calls.map((call) => call.name), [
    "list_briefing_templates", "list_briefings", "run_briefing", "get_briefing_run", "schedule_briefing"
  ]);
  assert.deepEqual(calls[4].arguments.cadence, {
    kind: "weekly", weekday: 2, hour_utc: 8, minute_utc: 30
  });
});

test("Desktop Automations project platform-owned definitions, live stats, and governed status controls", async () => {
  const calls = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "automation-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.params);
      const payload = request.params.name === "list_automations"
        ? {
            automations: [{
              id: "11111111-1111-4111-8111-111111111111",
              name: "Franchise scorecard follow-up",
              status: "active",
              trigger: { type: "record_event", collection: "franchise_scorecards", secret: "omit" },
              live_copy_subject: "Your monthly scorecard",
              steps_summary: [{
                action: "send_email",
                stage: "coaching",
                subject: "Your monthly scorecard",
                instructions: "Use the deterministic scorecard payload",
                body: "must not project"
              }],
              stats: {
                enrolled: 42,
                completed: 37,
                pending: 3,
                failed: 2,
                emails_sent: 37,
                last_sent_at: "2026-08-10T08:00:00.000Z"
              },
              created_at: "2026-08-01T08:00:00.000Z",
              updated_at: "2026-08-10T08:00:00.000Z"
            }]
          }
        : request.params.name === "list_automation_grants"
          ? {
              standing_grants: [{
                id: "22222222-2222-4222-8222-222222222222",
                automation_id: "11111111-1111-4111-8111-111111111111",
                automation_name: "Franchise scorecard follow-up",
                automation_definition_version: 3,
                automation_definition_sha256: "a".repeat(64),
                step_position: 0,
                step_key: "sync_target",
                connection_id: "33333333-3333-4333-8333-333333333333",
                operation_contract_id: "44444444-4444-4444-8444-444444444444",
                operation_key: "update_scorecard",
                trigger_scope: { kind: "record_change", collection: "franchise_scorecards" },
                argument_scope: [{ path: "body.score", source: "trigger_reference" }],
                window: "day",
                max_runs_per_window: 1000,
                window_runs: 12,
                max_total_runs: 100000,
                total_runs: 212,
                max_consecutive_failures: 5,
                consecutive_failures: 0,
                status: "active",
                expires_at: "2026-11-01T00:00:00.000Z"
              }]
            }
          : request.params.name === "list_automation_failures"
            ? {
                items: [{
                  id: "55555555-5555-4555-8555-555555555555",
                  automation_id: "11111111-1111-4111-8111-111111111111",
                  automation_name: "Franchise scorecard follow-up",
                  enrollment_id: "66666666-6666-4666-8666-666666666666",
                  subject_key: "franchise-42",
                  run_status: "failed",
                  step_position: 0,
                  step_key: "sync_target",
                  failure_kind: "ambiguous",
                  replay_safe: false,
                  external_effect_state: "unknown",
                  status: "open",
                  error: "provider response timed out",
                  occurrence_count: 1,
                  notification: { state: "sent", notified_at: "2026-08-10T08:05:00.000Z" },
                  definition_version: 3,
                  definition_sha256: "a".repeat(64),
                  first_failed_at: "2026-08-10T08:04:00.000Z",
                  last_failed_at: "2026-08-10T08:04:00.000Z"
                }],
                contract: { external_dispatch: "at_most_once" }
              }
          : request.params.name === "list_automation_runs"
            ? {
                runs: [{
                  id: "66666666-6666-4666-8666-666666666666",
                  automation_id: "11111111-1111-4111-8111-111111111111",
                  automation_name: "Franchise scorecard follow-up",
                  subject_key: "franchise-42",
                  current_position: 0,
                  status: "failed",
                  attempts: 0,
                  trigger: { record_id: "scorecard-42" },
                  started_at: "2026-08-10T08:00:00.000Z",
                  updated_at: "2026-08-10T08:04:00.000Z",
                  duration_ms: 240000,
                  step: { key: "sync_target", status: "failed" },
                  incident: {
                    id: "55555555-5555-4555-8555-555555555555",
                    kind: "ambiguous",
                    replay_safe: false,
                    status: "open"
                  }
                }],
                contract: { external_dispatch: "at_most_once" }
              }
          : request.params.name === "simulate_automation"
            ? {
                automation: { id: "11111111-1111-4111-8111-111111111111", name: "Franchise scorecard follow-up" },
                simulations: [{ valid: true, totals: { tool_calls: 1, external_writes: 1 } }],
                provider_calls: 0,
                mutations_performed: 0
              }
          : request.params.name === "repair_automation_failure"
            ? { ok: true, status: "retry_authorized", replay_dispatched: false }
          : request.params.name === "revoke_automation_grant"
            ? {
                revoked: true,
                grant_id: "22222222-2222-4222-8222-222222222222",
                automation_id: "11111111-1111-4111-8111-111111111111",
                status: "revoked"
              }
        : {
            ok: true,
            name: "Franchise scorecard follow-up",
            status: request.params.name === "pause_automation" ? "paused" : "active",
            message: "Status updated"
          };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const library = await client.automationsLibrary();
  await client.setAutomationStatus("Franchise scorecard follow-up", false);
  await client.setAutomationStatus("Franchise scorecard follow-up", true);
  await client.revokeAutomationGrant(
    "22222222-2222-4222-8222-222222222222",
    "Operator stopped the sync"
  );
  const simulation = await client.simulateAutomation(
    "11111111-1111-4111-8111-111111111111",
    { record_id: "scorecard-42" }
  );
  const repair = await client.repairAutomationFailure(
    "55555555-5555-4555-8555-555555555555",
    {
      action: "retry",
      externalEffectState: "not_applied",
      note: "Verified in the provider that no update was created"
    }
  );

  assert.equal(library.supported, true);
  assert.equal(library.automations[0].stats.enrolled, 42);
  assert.deepEqual(library.automations[0].trigger, {
    type: "record_event",
    collection: "franchise_scorecards"
  });
  assert.equal(library.automations[0].steps[0].body, undefined);
  assert.equal(library.grantsSupported, true);
  assert.equal(library.grants[0].maxRunsPerWindow, 1000);
  assert.equal(library.grants[0].argumentScope[0].path, "body.score");
  assert.equal(library.operationsSupported, true);
  assert.equal(library.failures[0].replaySafe, false);
  assert.equal(library.runs[0].incident.kind, "ambiguous");
  assert.equal(simulation.provider_calls, 0);
  assert.equal(repair.replay_dispatched, false);
  assert.deepEqual(calls.map((call) => call.name), [
    "list_automations", "list_automation_grants", "list_automation_failures",
    "list_automation_runs", "pause_automation", "resume_automation",
    "revoke_automation_grant", "simulate_automation", "repair_automation_failure"
  ]);
  assert.deepEqual(calls[4].arguments, { name: "Franchise scorecard follow-up" });
  assert.deepEqual(calls[6].arguments, {
    grant_id: "22222222-2222-4222-8222-222222222222",
    reason: "Operator stopped the sync"
  });
  assert.deepEqual(calls[8].arguments, {
    incident_id: "55555555-5555-4555-8555-555555555555",
    action: "retry",
    external_effect_state: "not_applied",
    result: {},
    note: "Verified in the provider that no update was created"
  });
});

test("Desktop keeps the Automation library available during an operations-tool rollout", async () => {
  const calls = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://older.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "automation-rollout-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      const name = request.params.name;
      calls.push(name);
      if (["list_automation_failures", "list_automation_runs"].includes(name)) {
        return response(200, {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `unknown tool '${name}'` }
        });
      }
      const payload = name === "list_automations"
        ? {
            automations: [{
              id: "11111111-1111-4111-8111-111111111111",
              name: "Existing Automation",
              status: "active",
              trigger: { type: "schedule" },
              steps_summary: [],
              stats: {}
            }]
          }
        : { standing_grants: [] };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const library = await client.automationsLibrary();

  assert.deepEqual(calls.sort(), [
    "list_automation_failures",
    "list_automation_grants",
    "list_automation_runs",
    "list_automations"
  ]);
  assert.equal(library.supported, true);
  assert.equal(library.automations[0].name, "Existing Automation");
  assert.equal(library.grantsSupported, true);
  assert.equal(library.operationsSupported, false);
  assert.deepEqual(library.failures, []);
  assert.deepEqual(library.runs, []);
});

test("Desktop consumes the Platform Automation setup contract without moving activation authority into the renderer", async () => {
  const calls = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "automation-builder-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.params);
      const payload = request.params.name === "list_automation_templates"
        ? {
            catalog_version: 1,
            blueprints: [{ key: "connected_operations", title: "Connected Operations", templates: ["event_driven_system_sync"] }],
            templates: [{
              key: "event_driven_system_sync",
              version: 1,
              blueprint: "connected_operations",
              title: "Event sync",
              installable: true,
              trigger_modes: ["webhook"],
              required_parameters: ["webhook", "connection", "operation"]
            }]
          }
        : request.params.name === "list_connection_operations"
          ? {
              connection_id: "connection-1",
              provider: "quickbooks",
              contracts: [{
                contract_id: "contract-1",
                operation_key: "create_invoice",
                display_name: "Create invoice",
                consequence: "write",
                method: "POST",
                path_template: "/invoice",
                path_params_schema: { type: "object", additionalProperties: false },
                query_schema: { type: "object", additionalProperties: false },
                body_schema: { type: "object", additionalProperties: false },
                status: "active"
              }]
            }
          : request.params.name === "install_automation_template"
            ? {
                installed: true,
                automation: { id: "automation-1", name: "Invoice sync", status: "draft" },
                activation: {
                  required: true,
                  tool: "set_automation",
                  arguments: {
                    name: "Invoice sync",
                    status: "active",
                    trigger: { kind: "webhook", webhook: "stripe.invoice.created" },
                    steps: []
                  }
                }
              }
            : { status: "pending_approval", operation_id: "approval-1" };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const catalog = await client.automationTemplateCatalog();
  const operations = await client.automationOperations("quickbooks");
  const installation = await client.installAutomationTemplate({
    template_key: "event_driven_system_sync",
    name: "Invoice sync",
    parameters: {
      webhook: "stripe.invoice.created",
      connection: "quickbooks",
      operation: "create_invoice"
    }
  });
  await client.activateAutomationDraft(installation.activation.arguments);

  assert.equal(catalog.templates[0].key, "event_driven_system_sync");
  assert.equal(operations.contracts[0].consequence, "write");
  assert.equal(installation.activation.arguments.status, "active");
  assert.deepEqual(calls.map((call) => call.name), [
    "list_automation_templates",
    "list_connection_operations",
    "install_automation_template",
    "set_automation"
  ]);
});

test("Desktop Tasks use governed Platform resources and preserve non-replay fork contracts", async () => {
  const calls = [];
  const parentId = "11111111-1111-4111-8111-111111111111";
  const childId = "22222222-2222-4222-8222-222222222222";
  const task = (overrides = {}) => ({
    id: parentId,
    context_key: `task:${parentId}`,
    title: "Neighborly scorecard",
    objective: "Build the deterministic scorecard",
    kind: "general",
    status: "active",
    source_client: "amos_desktop",
    pinned: false,
    archived: false,
    workspace_mode: "same_directory",
    workspace: {
      label: "amos-platform",
      repository: "git@github.com:amos-labs/amos-managed-platform.git",
      branch: "main",
      commit: "a".repeat(40),
      dirty: true
    },
    resource_refs: ["briefing:scorecard"],
    child_count: 0,
    created_at: "2026-08-10T08:00:00.000Z",
    updated_at: "2026-08-10T09:00:00.000Z",
    ...overrides
  });
  const forkManifest = {
    format: "amos.task_fork_manifest",
    version: 1,
    scope: {
      parentTaskId: parentId,
      childTaskId: childId,
      sourceEventId: "turn:one",
      contextScope: "from_here",
      workspaceMode: "context_only"
    },
    selectedArtifacts: [],
    safeguards: {
      orientationOnly: true,
      requiresFreshIdentity: true,
      requiresFreshCompanyEvidence: true,
      requiresFreshPolicy: true,
      requiresFreshApprovals: true,
      requiresFreshReceipts: true,
      replayAllowed: false,
      pendingOperationsCopied: false,
      credentialsIncluded: false,
      executionAuthorityIncluded: false
    }
  };
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "task-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.params);
      const payload = request.params.name === "list_tasks"
        ? { tasks: [task()], contract: { replay_allowed: false } }
        : request.params.name === "fork_task"
          ? {
              parent: task({ child_count: 1 }),
              task: task({
                id: childId,
                context_key: `task:${childId}`,
                title: "Upsell branch",
                objective: "Explore upsell",
                kind: "fork",
                parent_task_id: parentId,
                source_event_id: "turn:one",
                workspace_mode: "context_only",
                workspace: {},
                fork_manifest: forkManifest
              }),
              fork_manifest: forkManifest
            }
          : { task: task() };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const library = await client.tasksLibrary();
  const fork = await client.forkTask({
    taskId: parentId,
    name: "Upsell branch",
    objective: "Explore upsell",
    sourceEventId: "turn:one",
    contextScope: "from_here",
    workspaceMode: "context_only",
    workspace: {},
    selectedArtifacts: []
  });

  assert.equal(library.supported, true);
  assert.equal(library.tasks[0].workspace.localPath, undefined);
  assert.equal(fork.task.parentTaskId, parentId);
  assert.equal(fork.forkManifest.safeguards.replayAllowed, false);
  assert.deepEqual(calls.map((call) => call.name), ["list_tasks", "fork_task"]);
  assert.equal(calls[1].arguments.workspace.localPath, undefined);
});

test("Desktop sends native human decisions only through the dedicated approval endpoint", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "desktop-user-token"; } }
    },
    async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/challenge")) {
        return response(200, {
          challenge_id: "33333333-3333-3333-3333-333333333333",
          message: "AMOS-DESKTOP-APPROVAL-V1\nchallenge"
        });
      }
      return response(200, { status: "approved", verb: "create_ad" });
    }
  );

  const signed = [];
  const result = await client.decideApproval(
    "22222222-2222-2222-2222-222222222222",
    "approve",
    {
      async sign(message) {
        signed.push(message);
        return "signed-challenge";
      }
    }
  );

  assert.equal(result.status, "approved");
  assert.equal(
    requests[0].url,
    "https://app.amoslabs.com/api/v1/approvals/22222222-2222-2222-2222-222222222222/challenge"
  );
  assert.deepEqual(JSON.parse(requests[0].options.body), { decision: "approve" });
  assert.equal(
    requests[1].url,
    "https://app.amoslabs.com/api/v1/approvals/22222222-2222-2222-2222-222222222222/approve"
  );
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.headers.Authorization, "Bearer desktop-user-token");
  assert.equal(requests[1].options.headers["X-AMOS-Client"], undefined);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    challenge_id: "33333333-3333-3333-3333-333333333333",
    signature: "signed-challenge"
  });
  assert.deepEqual(signed, ["AMOS-DESKTOP-APPROVAL-V1\nchallenge"]);
});

test("Desktop signs the exact Mission answer and never routes it through an MCP tool", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "desktop-user-token"; } }
    },
    async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/challenge")) {
        return response(200, {
          challenge_id: "66666666-6666-6666-6666-666666666666",
          message: "AMOS-DESKTOP-MISSION-DECISION-V1\nchallenge"
        });
      }
      return response(200, {
        status: "answered",
        mission_status: "running"
      });
    }
  );
  const signed = [];
  const result = await client.answerMissionDecision(
    "33333333-3333-3333-3333-333333333333",
    "  Focus on MSPs first  ",
    {
      async sign(message) {
        signed.push(message);
        return "signed-mission-answer";
      }
    }
  );

  assert.equal(result.mission_status, "running");
  assert.equal(
    requests[0].url,
    "https://app.amoslabs.com/api/v1/mission-decisions/33333333-3333-3333-3333-333333333333/challenge"
  );
  assert.deepEqual(JSON.parse(requests[0].options.body), { answer: "Focus on MSPs first" });
  assert.equal(
    requests[1].url,
    "https://app.amoslabs.com/api/v1/mission-decisions/33333333-3333-3333-3333-333333333333/answer"
  );
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    answer: "Focus on MSPs first",
    challenge_id: "66666666-6666-6666-6666-666666666666",
    signature: "signed-mission-answer"
  });
  assert.deepEqual(signed, ["AMOS-DESKTOP-MISSION-DECISION-V1\nchallenge"]);
});

test("Desktop rejects cross-origin Mission decision review URLs", () => {
  assert.throws(
    () => missionDecisionReviewUrl("https://app.amoslabs.com/mcp", {
      id: "33333333-3333-3333-3333-333333333333",
      decision_url: "https://attacker.example/mission-decisions/33333333-3333-3333-3333-333333333333"
    }),
    /does not match/
  );
});

test("Desktop projects credential-free connection and provider metadata from AMOS", async () => {
  const tools = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "catalog-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      const name = request.params.name;
      tools.push(name);
      const payload = name === "list_connections"
        ? {
            connections: [{
              id: "44444444-4444-4444-4444-444444444444",
              provider: "quickbooks",
              display_name: "Neighborly QBO",
              kind: "oauth",
              status: "connected",
              ownership: "service_account",
              usable: true,
              credentials_encrypted: "must-not-project"
            }]
          }
        : {
            catalog_version: 1,
            providers: [{
              provider: "microsoft_graph",
              label: "Microsoft 365",
              source: "platform",
              connection_kind: "oauth",
              group: "Microsoft",
              description: "Outlook and calendar",
              capabilities: ["mail", "calendar"],
              setup_mode: "hosted_oauth",
              configured: true,
              availability: "available",
              token_url: "must-not-project"
            }, {
              provider: "twilio",
              label: "Twilio SMS",
              source: "platform",
              connection_kind: "api_key",
              setup_mode: "hosted_secret",
              configured: true,
              availability: "available",
              credential_form: {
                auth_scheme: "basic",
                base_url: "https://api.twilio.com",
                credential_label: "Auth Token",
                username_label: "Account SID",
                username_placeholder: "AC...",
                default_from: true,
                internal_secret: "must-not-project"
              }
            }, {
              provider: "nuvola_learning_mcp",
              label: "Nuvola Learning",
              source: "platform",
              connection_kind: "upstream_mcp",
              description: "Governed learning",
              capabilities: ["course_authoring"],
              setup_mode: "governed_upstream_mcp",
              configured: true,
              availability: "available",
              upstream_status: "live",
              credential_form: {
                submission_tool: "connect_nuvola_learning",
                auth_scheme: "bearer",
                credential_label: "Corporation-bound MCP key",
                context_field: {
                  name: "corporation_id",
                  label: "Nuvola corporation ID",
                  type: "number",
                  placeholder: "e.g. 14"
                }
              }
            }]
          };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const catalog = await client.connectionsCatalog();
  assert.deepEqual(tools.sort(), ["list_connection_catalog", "list_connections"]);
  assert.equal(catalog.connections[0].displayName, "Neighborly QBO");
  assert.equal(catalog.connections[0].credentials_encrypted, undefined);
  assert.equal(catalog.catalogVersion, 1);
  assert.equal(catalog.providers[0].group, "Microsoft");
  assert.deepEqual(catalog.providers[0].capabilities, ["mail", "calendar"]);
  assert.equal(catalog.providers[0].token_url, undefined);
  assert.equal(catalog.providers[1].credentialForm.authScheme, "basic");
  assert.equal(catalog.providers[1].credentialForm.usernameLabel, "Account SID");
  assert.equal(catalog.providers[1].credentialForm.defaultFrom, true);
  assert.equal(catalog.providers[1].credentialForm.internal_secret, undefined);
  assert.equal(catalog.providers[2].availability, "available");
  assert.equal(catalog.providers[2].upstreamStatus, "live");
  assert.equal(
    catalog.providers[2].credentialForm.submissionTool,
    "connect_nuvola_learning"
  );
  assert.deepEqual(catalog.providers[2].credentialForm.contextField, {
    name: "corporation_id",
    type: "number",
    label: "Nuvola corporation ID",
    placeholder: "e.g. 14"
  });
});

test("Desktop projects user-private Projects and supervised task runs without authority", async () => {
  const calls = [];
  const ids = {
    project: "11111111-1111-4111-8111-111111111111",
    task: "22222222-2222-4222-8222-222222222222",
    run: "33333333-3333-4333-8333-333333333333"
  };
  const project = {
    id: ids.project,
    name: "Neighborly rollout",
    instructions: "Keep corporate and franchise work visibly separated.",
    status: "active",
    pinned: true,
    archived: false,
    resource_refs: ["company:neighborly"],
    max_parallel_runs: 4,
    default_budget: {
      token_limit: 200000,
      cost_limit_microusd: 50000000,
      tool_call_limit: 200,
      wall_time_limit_seconds: 14400
    },
    task_count: 3,
    running_count: 1,
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:05:00.000Z",
    credential: "must-not-project"
  };
  const run = {
    id: ids.run,
    project_id: ids.project,
    project_name: project.name,
    task_id: ids.task,
    task_title: "Build KPI scorecard",
    source_client: "amos_desktop",
    client_run_id: "desktop-run-1",
    execution_mode: "local",
    status: "running",
    sequence: 2,
    phase: "analysis",
    progress_summary: "Computing the deterministic scorecard",
    result_summary: "",
    stop_reason: "",
    budget: {
      token_limit: 200000,
      cost_limit_microusd: 50000000,
      tool_call_limit: 200,
      wall_time_limit_seconds: 14400
    },
    usage: { tokens_used: 1200, cost_used_microusd: 3000, tool_calls_used: 4 },
    continue: true,
    stalled: false,
    heartbeat_at: "2026-08-12T00:05:00.000Z",
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:05:00.000Z",
    tool_arguments: { secret: "must-not-project" }
  };
  const task = {
    id: ids.task,
    context_key: `task:${ids.task}`,
    title: "Build KPI scorecard",
    objective: "Build the deterministic KPI scorecard",
    kind: "general",
    status: "active",
    project_id: ids.project,
    workspace_mode: "context_only",
    workspace: {},
    resource_refs: [],
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:05:00.000Z"
  };
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "projects-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.params);
      const name = request.params.name;
      const payload = name === "list_projects"
        ? { projects: [project], contract: { execution_authority: false } }
        : name === "list_task_inbox"
          ? { items: [run], stalled_count: 0, contract: { execution_proof: false } }
          : name === "create_project" || name === "update_project"
            ? { project, changed: ["pinned"], contract: { execution_authority: false } }
            : name === "assign_task_to_project"
              ? { task, contract: { approval_or_replay_permission: false } }
              : name === "start_task_run"
                ? { run, accepted: true, idempotent: false, continue: true }
                : name === "report_task_run"
                  ? { run: { ...run, status: "completed", continue: false }, accepted: true, continue: false }
                  : { run: { ...run, status: "cancel_requested", continue: false }, continue: false };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const library = await client.projectsLibrary();
  const created = await client.createProject({ name: project.name, maxParallelRuns: 4 });
  await client.updateProject(ids.project, { pinned: false });
  const assigned = await client.assignTaskToProject(ids.task, ids.project);
  await client.startTaskRun({
    projectId: ids.project,
    taskId: ids.task,
    clientRunId: "desktop-run-1"
  });
  await client.reportTaskRun({
    runId: ids.run,
    sequence: 3,
    status: "completed",
    tokensUsed: 1200,
    costUsedMicrousd: 3000,
    toolCallsUsed: 4
  });
  await client.cancelTaskRun(ids.run, "Stopped by the operator");

  assert.equal(library.supported, true);
  assert.equal(library.projects[0].maxParallelRuns, 4);
  assert.equal(library.projects[0].credential, undefined);
  assert.equal(library.inbox[0].taskTitle, "Build KPI scorecard");
  assert.equal(library.inbox[0].tool_arguments, undefined);
  assert.equal(created.project.defaultBudget.tokenLimit, 200000);
  assert.equal(assigned.task.projectId, ids.project);
  assert.deepEqual(calls.map((call) => call.name), [
    "list_projects", "list_task_inbox", "create_project", "update_project",
    "assign_task_to_project", "start_task_run", "report_task_run",
    "request_task_run_cancel"
  ]);
  assert.deepEqual(calls[2].arguments, { name: project.name, max_parallel_runs: 4 });
  assert.deepEqual(calls[3].arguments, { project_id: ids.project, pinned: false });
  assert.deepEqual(calls[4].arguments, { task_id: ids.task, project_id: ids.project });
  assert.equal(calls[5].arguments.source_client, "amos_desktop");
  assert.equal(calls[6].arguments.status, "completed");
  assert.equal(calls[7].arguments.reason, "Stopped by the operator");
});

test("Desktop still loads Projects when the supervised-run inbox tool is missing", async () => {
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "projects-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      if (request.params.name === "list_task_inbox") {
        return response(200, {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "unknown tool 'list_task_inbox'" }
        });
      }
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              projects: [{
                id: "11111111-1111-4111-8111-111111111111",
                name: "Neighborly rollout",
                status: "active",
                max_parallel_runs: 2,
                default_budget: {},
                created_at: "2026-08-12T00:00:00.000Z",
                updated_at: "2026-08-12T00:05:00.000Z"
              }],
              contract: { execution_authority: false }
            })
          }]
        }
      });
    }
  );

  const library = await client.projectsLibrary();
  assert.equal(library.supported, true);
  assert.equal(library.projects[0].name, "Neighborly rollout");
  assert.deepEqual(library.inbox, []);
});

test("Desktop loads Projects through the company engine when the direct verb is unadvertised", async () => {
  const tools = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "projects-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      const name = request.params.name;
      tools.push(name);
      if (name === "list_projects" || name === "list_task_inbox") {
        return response(200, {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `unknown tool '${name}'` }
        });
      }
      assert.equal(name, "call_engine_tool");
      const tool = request.params.arguments.tool;
      const payload = tool === "list_projects"
        ? {
            projects: [{
              id: "11111111-1111-4111-8111-111111111111",
              name: "Neighborly rollout",
              status: "active",
              max_parallel_runs: 2,
              default_budget: {},
              created_at: "2026-08-12T00:00:00.000Z",
              updated_at: "2026-08-12T00:05:00.000Z"
            }],
            contract: { execution_authority: false }
          }
        : { items: [], stalled_count: 0, contract: { execution_proof: false } };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const library = await client.projectsLibrary();
  assert.equal(library.supported, true);
  assert.equal(library.projects[0].name, "Neighborly rollout");
  assert.deepEqual(tools, [
    "list_projects",
    "call_engine_tool",
    "list_task_inbox",
    "call_engine_tool"
  ]);
});

test("Desktop falls back only to the older platform catalog, never a bundled provider list", async () => {
  const tools = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://older.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "catalog-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      const name = request.params.name;
      tools.push(name);
      if (name === "list_connection_catalog") {
        return response(200, {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "unknown tool 'list_connection_catalog'" }
        });
      }
      const payload = name === "list_connections"
        ? { connections: [] }
        : {
            curated: [{
              provider: "github",
              label: "GitHub",
              source: "platform",
              configured: true
            }],
            tenant_defined: []
          };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      });
    }
  );

  const catalog = await client.connectionsCatalog();
  assert.deepEqual(tools.sort(), [
    "list_connection_catalog",
    "list_connections",
    "list_oauth_providers"
  ]);
  assert.equal(catalog.providers.length, 1);
  assert.equal(catalog.providers[0].provider, "github");
});

test("Desktop asks AMOS Platform for a hosted connection link", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "catalog-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              provider: "power_bi",
              url: "https://login.microsoftonline.com/authorize?state=opaque",
              expires_in: 600
            })
          }]
        }
      });
    }
  );

  const link = await client.connectLink("power_bi");
  assert.equal(requests[0].params.name, "connect_link");
  assert.deepEqual(requests[0].params.arguments, { provider: "power_bi" });
  assert.equal(link.expiresIn, 600);
});

test("Desktop disconnects one exact Platform connection by UUID", async () => {
  const requests = [];
  const connectionId = "55555555-5555-4555-8555-555555555555";
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "catalog-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({ deleted: true, connection_id: connectionId })
          }]
        }
      });
    }
  );

  const result = await client.disconnectConnection(connectionId);
  assert.equal(result.deleted, true);
  assert.equal(requests[0].params.name, "delete_connection");
  assert.deepEqual(requests[0].params.arguments, { connection_id: connectionId });
  await assert.rejects(
    () => client.disconnectConnection("not-a-connection-id"),
    /Connection id is invalid/
  );
  assert.equal(requests.length, 1);
});

test("Desktop sends a one-time credential directly to the Platform connection verb", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "catalog-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              connected: true,
              provider: "twilio",
              display_name: "Support SMS",
              connection_id: "55555555-5555-5555-5555-555555555555"
            })
          }]
        }
      });
    }
  );

  const result = await client.createSecretConnection({
    provider: "twilio",
    displayName: "Support SMS",
    credential: "one-time-auth-token",
    username: "AC123",
    defaultFrom: "+15551234567",
    authScheme: "basic",
    baseUrl: "https://api.twilio.com"
  });

  assert.equal(result.connected, true);
  assert.equal(requests[0].params.name, "create_connection");
  assert.deepEqual(requests[0].params.arguments, {
    provider: "twilio",
    display_name: "Support SMS",
    base_url: "https://api.twilio.com",
    config: { default_from: "+15551234567" },
    service_account: false,
    secrets: {
      username: "AC123",
      password: "one-time-auth-token"
    },
    auth_shape: {
      scheme: "basic",
      username_secret: "username",
      password_secret: "password"
    }
  });
  assert.equal(JSON.stringify(result).includes("one-time-auth-token"), false);
});

test("Desktop uses the typed Platform ceremony for a Nuvola corporation key", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "catalog-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              connected: true,
              provider: "nuvola_learning_mcp",
              display_name: "Neighborly Learning",
              connection_id: "66666666-6666-6666-6666-666666666666"
            })
          }]
        }
      });
    }
  );

  const result = await client.connectNuvolaLearning({
    displayName: "Neighborly Learning",
    credential: "corporation-bound-key",
    corporationId: "14"
  });

  assert.equal(result.connected, true);
  assert.equal(requests[0].params.name, "connect_nuvola_learning");
  assert.deepEqual(requests[0].params.arguments, {
    display_name: "Neighborly Learning",
    credential: "corporation-bound-key",
    corporation_id: 14
  });
  assert.equal(JSON.stringify(result).includes("corporation-bound-key"), false);
});

test("Desktop treats a non-approver role as a bounded unavailable inbox", async () => {
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "member-token"; } }
    },
    async () => response(403, { error: "owner or admin required" })
  );

  const approvals = await client.approvals();
  assert.equal(approvals.available, false);
  assert.deepEqual(approvals.pending_operations, []);
  assert.deepEqual(approvals.mission_decisions, []);
});

test("Desktop derives active workspace eligibility from live AMOS billing state", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "member-token"; } }
    },
    async (url, options) => {
      requests.push({ url: String(url), options });
      return response(200, {
        provider: "amos-hosted",
        model: "auto",
        ready: true,
        billing: {
          subscription_status: "trialing",
          billing_exempt: false,
          included_credit_remaining_usd: "20.00"
        }
      });
    }
  );

  const status = await client.intelligenceStatus();
  assert.deepEqual(status, {
    ready: true,
    subscriptionStatus: "trialing",
    billingExempt: false,
    includedCreditRemainingUsd: "20.00",
    demo: null,
    workspaceActive: true
  });
  assert.equal(requests[0].url, "https://app.amoslabs.com/v1/intelligence/status");
  assert.equal(requests[0].options.headers.Authorization, "Bearer member-token");
});

test("Desktop preserves the free foreground Qwen and connection allowance", async () => {
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "free-token"; } }
    },
    async () => response(200, {
      ready: true,
      billing: {
        subscription_status: "none",
        billing_exempt: false,
        workspace_active: false,
        access_mode: "free_foreground_qwen",
        free_connections_limit: 2,
        included_credit_remaining_usd: "0.00"
      }
    })
  );

  assert.deepEqual(await client.intelligenceStatus(), {
    ready: true,
    subscriptionStatus: "none",
    billingExempt: false,
    accessMode: "free_foreground_qwen",
    freeConnectionsLimit: 2,
    includedCreditRemainingUsd: "0.00",
    demo: null,
    workspaceActive: false
  });
});

test("Desktop preserves the authoritative Northwind hosted-turn balance", async () => {
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "demo-token"; } }
    },
    async () => response(200, {
      ready: true,
      billing: {
        subscription_status: "none",
        billing_exempt: true,
        included_credit_remaining_usd: "0.0000"
      },
      demo: {
        message_limit: 30,
        messages_used: 8,
        messages_remaining: 22
      }
    })
  );

  assert.deepEqual(await client.intelligenceStatus(), {
    ready: true,
    subscriptionStatus: "none",
    billingExempt: true,
    includedCreditRemainingUsd: "0.0000",
    demo: {
      messageLimit: 30,
      messagesUsed: 8,
      messagesRemaining: 22
    },
    workspaceActive: true
  });
});

test("approval links are pinned to the connected AMOS origin", () => {
  const id = "22222222-2222-2222-2222-222222222222";
  assert.equal(
    approvalReviewUrl("https://app.amoslabs.com/mcp", { id }),
    `https://app.amoslabs.com/approvals/${id}`
  );
  assert.throws(
    () =>
      approvalReviewUrl("https://app.amoslabs.com/mcp", {
        id,
        approval_url: `https://evil.example/approvals/${id}`
      }),
    /does not match/
  );
});

test("MCP identity parsing fails closed on malformed content", () => {
  assert.throws(
    () => parseMcpJson({ content: [{ type: "text", text: "not-json" }] }, "AMOS identity"),
    /invalid response/
  );
});

test("Desktop reads a fresh company briefing without requesting an offline token", async () => {
  const client = new DesktopRemoteStateClient({
    mcpUrl: "https://app.amoslabs.com/mcp",
    oauth: { async getAccessToken() { return "user-token"; } }
  });
  let requested;
  client.mcp.callTool = async (name, args) => {
    requested = { name, args };
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          generated_at: "2026-07-26T12:00:00.000Z",
          company_state: { name: "Northwind Labs" },
          offline_cache: { token: "must-not-leave-client" }
        })
      }]
    };
  };

  const snapshot = await client.companySnapshot();
  assert.deepEqual(requested, { name: "resume_company", args: {} });
  assert.equal(snapshot.company_state.name, "Northwind Labs");
  assert.equal(Object.hasOwn(snapshot, "offline_cache"), false);
});

test("Desktop hydrates and captures bounded cross-client working continuity", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient({
    mcpUrl: "https://app.amoslabs.com/mcp",
    oauth: { async getAccessToken() { return "user-token"; } }
  });
  client.mcp.callTool = async (name, args) => {
    requests.push({ name, args });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(workingContinuityResponse({
          revision: name === "capture_context" ? 5 : 4,
          sourceClient: name === "capture_context" ? "amos_desktop" : "claude_code"
        }))
      }]
    };
  };

  const hydrated = await client.hydrateContinuity({ tenantId: "tenant-1" });
  assert.equal(hydrated.available, true);
  assert.equal(hydrated.sourceClient, "claude_code");
  assert.equal(hydrated.manifest.scope.workspaceHint, "neighborly-demo");

  const captured = await client.captureContinuity({
    context_key: "active",
    source_client: "amos_desktop",
    objective: "Continue the demo",
    outcome: "Course is ready"
  }, { tenantId: "tenant-1" });
  assert.equal(captured.revision, 5);
  assert.deepEqual(requests, [{ name: "hydrate_context", args: {} }, {
    name: "capture_context",
    args: {
      context_key: "active",
      source_client: "amos_desktop",
      objective: "Continue the demo",
      outcome: "Course is ready"
    }
  }]);
});

test("Desktop continuity fails closed across tenants and rolls out against older servers", async () => {
  const client = new DesktopRemoteStateClient({
    mcpUrl: "https://app.amoslabs.com/mcp",
    oauth: { async getAccessToken() { return "user-token"; } }
  });
  client.mcp.callTool = async () => ({
    content: [{ type: "text", text: JSON.stringify(workingContinuityResponse()) }]
  });
  await assert.rejects(
    client.hydrateContinuity({ tenantId: "tenant-2" }),
    /does not match the current company/
  );

  client.mcp.callTool = async () => {
    throw new Error("unknown tool 'hydrate_context'");
  };
  const unsupported = await client.hydrateContinuity({ tenantId: "tenant-1" });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.available, false);
});

test("Desktop clears the exact shared continuity lane with an older-server fallback", async () => {
  const requests = [];
  const client = new DesktopRemoteStateClient({
    mcpUrl: "https://app.amoslabs.com/mcp",
    oauth: { async getAccessToken() { return "user-token"; } }
  });
  client.mcp.callTool = async (name, args) => {
    requests.push({ name, args });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(workingContinuityResponse({ available: false, cleared: true }))
      }]
    };
  };
  const cleared = await client.clearContinuity({
    contextKey: "active",
    tenantId: "tenant-1"
  });
  assert.equal(cleared.available, false);
  assert.equal(cleared.cleared, true);
  assert.deepEqual(requests, [{ name: "clear_context", args: { context_key: "active" } }]);

  client.mcp.callTool = async () => {
    throw new Error("unknown tool 'clear_context'");
  };
  const unsupported = await client.clearContinuity({ tenantId: "tenant-1" });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.cleared, false);
});

test("Desktop requests, verifies, and binds the exact signed company snapshot", async () => {
  const signed = signedCompanyCache();
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "user-token"; } }
    },
    async (url) => {
      assert.equal(
        String(url),
        "https://app.amoslabs.com/.well-known/amos-app-auth/jwks.json"
      );
      return response(200, { keys: [signed.jwk] });
    }
  );
  let requested;
  client.mcp.callTool = async (name, args) => {
    requested = { name, args };
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ...signed.claims.snapshot,
          offline_cache: {
            token: signed.token,
            kid: signed.jwk.kid
          }
        })
      }]
    };
  };

  const grant = await client.companyCache({
    identity: {
      sub: "user-1",
      tenant_id: "tenant-1",
      principal_type: "user"
    }
  });
  assert.equal(requested.name, "resume_company");
  assert.equal(requested.args.issue_offline_cache, true);
  assert.equal(requested.args.cache_ttl_seconds, 14_400);
  assert.equal(grant.claims.snapshot.company_state.name, "Northwind Labs");
  assert.equal(grant.jwk.kid, "desktop-cache-test");
});

test("Desktop projects hosted Missions and their optional Project context", async () => {
  const calls = [];
  const missionId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const client = new DesktopRemoteStateClient(
    {
      mcpUrl: "https://app.amoslabs.com/mcp",
      oauth: { async getAccessToken() { return "mission-user-token"; } }
    },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.params.name);
      const payload = request.params.name === "list_goals"
        ? {
            loop_enabled: true,
            master_enabled: true,
            execution_enabled: true,
            goals: [{
              id: "44444444-4444-4444-8444-444444444444",
              objective: "Continuously improve qualified pipeline",
              status: "active",
              metric: "qualified_pipeline",
              metric_label: "Qualified pipeline",
              cadence_label: "Every day",
              mode_label: "Bounded",
              cycles: 3,
              events: [{ cycle: 3, status: "kept", proposal: "Test the next segment" }]
            }]
          }
        : request.params.name === "list_mission_templates"
          ? {
              contract_version: 1,
              templates: [{
                key: "qualified_prospects",
                kind: "finite",
                title: "Build a qualified prospect list",
                description: "Find and verify prospects.",
                objective: "Build a verified prospect list."
              }]
            }
          : {
              missions: [{
                mission_id: missionId,
                project_id: projectId,
                project_name: "Channel launch",
                name: "Build the VAR list",
                objective: "Verify 500 qualified VAR and MSP contacts.",
                status: "running",
                intelligence: "amos",
                created_at: "2026-08-31T08:00:00.000Z",
                contract: {
                  contract_id: "33333333-3333-4333-8333-333333333333",
                  max_tool_calls: 100,
                  used_tool_calls: 4,
                  expires_at: "2026-09-14T08:00:00.000Z"
                }
              }],
              count: 1
            };
      return response(200, {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify(payload)
          }]
        }
      });
    }
  );

  const library = await client.missionsLibrary();
  assert.equal(library.supported, true);
  assert.equal(library.missions[0].id, missionId);
  assert.equal(library.missions[0].projectId, projectId);
  assert.equal(library.missions[0].projectName, "Channel launch");
  assert.equal(library.missions[0].executionLocation, "hosted");
  assert.equal(library.missions[0].contract.usedToolCalls, 4);
  assert.equal(library.optimizationMissions[0].missionKind, "optimization");
  assert.equal(library.optimizationMissions[0].cycles, 3);
  assert.equal(library.templates[0].label, "Build a qualified prospect list");
  assert.equal(library.scheduler.enabled, true);
  assert.deepEqual(calls, ["list_missions", "list_goals", "list_mission_templates"]);
});

function signedCompanyCache() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "desktop-cache-test",
    use: "sig",
    alg: "EdDSA"
  };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    cache_format: COMPANY_CACHE_FORMAT,
    cache_version: COMPANY_CACHE_VERSION,
    cache_id: "cache-test",
    iss: "https://app.amoslabs.com",
    aud: COMPANY_CACHE_AUDIENCE,
    sub: "user-1",
    tenant_id: "tenant-1",
    tenant_slug: "northwind",
    role: "owner",
    principal_type: "user",
    scopes: ["data:read"],
    scope_fingerprint: createHash("sha256").update("data:read").digest("hex"),
    iat: now,
    nbf: now,
    exp: now + 14_400,
    snapshot: {
      resume_version: "1",
      generated_at: new Date(now * 1000).toISOString(),
      company_state: { status: "available", name: "Northwind Labs" }
    }
  };
  const encodedHeader = Buffer.from(JSON.stringify({
    alg: "EdDSA",
    typ: COMPANY_CACHE_TOKEN_TYPE,
    kid: jwk.kid
  })).toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(
    null,
    Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii"),
    privateKey
  ).toString("base64url");
  return {
    claims,
    jwk,
    token: `${encodedHeader}.${encodedClaims}.${signature}`
  };
}

function workingContinuityResponse({
  revision = 4,
  sourceClient = "claude_code",
  available = true,
  cleared = false
} = {}) {
  if (!available) {
    return {
      available: false,
      cleared,
      context_key: "active",
      revision: 0,
      source_client: null,
      updated_at: null,
      stale: false,
      manifest: null
    };
  }
  return {
    available: true,
    context_key: "active",
    revision,
    source_client: sourceClient,
    updated_at: "2026-08-03T10:00:00.000Z",
    stale: false,
    manifest: {
      format: "amos.continuity_manifest",
      version: 1,
      revision,
      scope: {
        boundary: "online",
        tenantId: "tenant-1",
        contextKey: "active",
        workspaceHint: "neighborly-demo"
      },
      updatedAt: "2026-08-03T10:00:00.000Z",
      transitions: [{
        at: "2026-08-03T10:00:00.000Z",
        status: "completed",
        objective: "Show the generated course",
        outcome: "Course is ready",
        model: "anthropic:claude",
        sourceClient,
        actions: [],
        decisions: [],
        commitments: [],
        corrections: [],
        openLoops: [],
        artifacts: []
      }],
      handoffs: [],
      artifacts: [],
      safeguards: {
        orientationOnly: true,
        requiresFreshAuthority: true,
        replayAllowed: false,
        clientReported: true,
        credentialsIncluded: false,
        companyMemory: false
      }
    }
  };
}
