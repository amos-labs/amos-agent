import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  approvalReviewUrl,
  DesktopRemoteStateClient,
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
        ]
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
  assert.deepEqual(requests[0].params.arguments, { limit: 100 });
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

  assert.equal(library.supported, true);
  assert.equal(library.automations[0].stats.enrolled, 42);
  assert.deepEqual(library.automations[0].trigger, {
    type: "record_event",
    collection: "franchise_scorecards"
  });
  assert.equal(library.automations[0].steps[0].body, undefined);
  assert.deepEqual(calls.map((call) => call.name), [
    "list_automations", "pause_automation", "resume_automation"
  ]);
  assert.deepEqual(calls[1].arguments, { name: "Franchise scorecard follow-up" });
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
    workspaceActive: true
  });
  assert.equal(requests[0].url, "https://app.amoslabs.com/v1/intelligence/status");
  assert.equal(requests[0].options.headers.Authorization, "Bearer member-token");
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
