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
  assert.equal(approvals.pending_operations[0].review_summary, "Create Ad: launch the governed campaign");
  assert.equal(requests[1].url, "https://app.amoslabs.com/api/v1/approvals");
  assert.equal(requests[1].options.headers.Authorization, "Bearer user-access-token");
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
