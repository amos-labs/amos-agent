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
            args: { name: "Enterprise proof" }
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
  assert.equal(requests[1].url, "https://app.amoslabs.com/api/v1/approvals");
  assert.equal(requests[1].options.headers.Authorization, "Bearer user-access-token");
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
              provider: "nuvola_learning_mcp",
              label: "Nuvola Learning",
              source: "platform",
              connection_kind: "upstream_mcp",
              description: "Governed learning",
              capabilities: ["course_authoring"],
              configured: false,
              availability: "adapter_required",
              upstream_status: "live"
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
  assert.equal(catalog.providers[1].availability, "adapter_required");
  assert.equal(catalog.providers[1].upstreamStatus, "live");
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
