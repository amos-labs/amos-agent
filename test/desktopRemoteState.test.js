import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalReviewUrl,
  DesktopRemoteStateClient,
  parseMcpJson
} from "../src/desktop/remoteState.js";

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
