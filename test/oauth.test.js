import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AmosOAuthSession } from "../src/auth/oauth.js";
import { FileTokenStore } from "../src/auth/tokenStore.js";

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("OAuth login performs discovery, DCR, PKCE callback, and token storage", async () => {
  let redirectUri;
  let challenge;
  let finishCallback;
  const stored = new MemoryStore();
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    if (value.endsWith("/.well-known/oauth-protected-resource/mcp")) {
      return jsonResponse(200, {
        resource: "https://amos.example/mcp",
        authorization_servers: ["https://auth.amos.example"]
      });
    }
    if (value.endsWith("/.well-known/oauth-authorization-server")) {
      return jsonResponse(200, {
        issuer: "https://auth.amos.example",
        authorization_endpoint: "https://auth.amos.example/oauth/authorize",
        token_endpoint: "https://auth.amos.example/oauth/token",
        registration_endpoint: "https://auth.amos.example/oauth/register",
        code_challenge_methods_supported: ["S256"]
      });
    }
    if (value.endsWith("/oauth/register")) {
      const body = JSON.parse(options.body);
      assert.equal(body.client_name, "AMOS Agent");
      redirectUri = body.redirect_uris[0];
      return jsonResponse(201, { client_id: "amos-agent-client" });
    }
    if (value.endsWith("/oauth/token")) {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("code"), "authorization-code");
      const actual = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier")));
      assert.equal(Buffer.from(actual).toString("base64url"), challenge);
      return jsonResponse(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        scope: "app:read"
      });
    }
    throw new Error(`Unexpected URL ${value}`);
  };
  const session = new AmosOAuthSession({
    mcpUrl: "https://amos.example/mcp",
    store: stored,
    fetchImpl,
    openBrowser: () => false,
    callbackReceiverFactory: async () => ({
      redirectUri: "http://127.0.0.1:45678/oauth/callback",
      result: new Promise((resolve) => { finishCallback = resolve; }),
      close() {}
    })
  });

  const credentials = await session.login({
    openBrowser: false,
    desktopInstallId: "25deefb7-0e4f-43ad-8b2f-f2f86fac6594",
    onAuthorize({ url }) {
      const authorization = new URL(url);
      challenge = authorization.searchParams.get("code_challenge");
      assert.ok(authorization.searchParams.get("state"));
      assert.equal(
        authorization.searchParams.get("desktop_install_id"),
        "25deefb7-0e4f-43ad-8b2f-f2f86fac6594"
      );
      setImmediate(() => finishCallback({ code: "authorization-code" }));
    }
  });

  assert.equal(credentials.access_token, "access-1");
  assert.equal(credentials.client_id, "amos-agent-client");
  assert.equal((await stored.read()).refresh_token, "refresh-1");
});

test("OAuth discovery permits a separately hosted HTTPS browser authorization endpoint", async () => {
  const session = new AmosOAuthSession({
    mcpUrl: "https://platform.custom.amoslabs.com/mcp",
    store: new MemoryStore(),
    fetchImpl: discoveryFetch({
      authorization_endpoint: "https://app.amoslabs.com/oauth/authorize"
    })
  });

  const metadata = await session.discover();
  assert.equal(metadata.authorization_endpoint, "https://app.amoslabs.com/oauth/authorize");
});

test("OAuth discovery keeps token and registration endpoints pinned to the issuer", async () => {
  for (const field of ["token_endpoint", "registration_endpoint"]) {
    const session = new AmosOAuthSession({
      mcpUrl: "https://platform.custom.amoslabs.com/mcp",
      store: new MemoryStore(),
      fetchImpl: discoveryFetch({
        [field]: `https://other.example/oauth/${field}`
      })
    });

    await assert.rejects(session.discover(), new RegExp(`${field.replace("_", " ")} must share the issuer origin`));
  }
});

test("OAuth discovery rejects an insecure browser authorization endpoint", async () => {
  const session = new AmosOAuthSession({
    mcpUrl: "https://platform.custom.amoslabs.com/mcp",
    store: new MemoryStore(),
    fetchImpl: discoveryFetch({
      authorization_endpoint: "http://app.amoslabs.com/oauth/authorize"
    })
  });

  await assert.rejects(session.discover(), /authorization endpoint must use HTTPS/);
});

test("OAuth refresh rotates and stores the refresh token", async () => {
  const stored = new MemoryStore({
    version: 1,
    issuer: "https://amos.example",
    mcp_url: "https://amos.example/mcp",
    token_endpoint: "https://amos.example/oauth/token",
    client_id: "client-1",
    access_token: "expired",
    refresh_token: "refresh-1",
    expires_at: 0
  });
  const session = new AmosOAuthSession({
    mcpUrl: "https://amos.example/mcp",
    store: stored,
    fetchImpl: async (_url, options) => {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("grant_type"), "refresh_token");
      assert.equal(form.get("refresh_token"), "refresh-1");
      return jsonResponse(200, { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 });
    }
  });

  assert.equal(await session.getAccessToken(), "access-2");
  assert.equal((await stored.read()).refresh_token, "refresh-2");
});

test("FileTokenStore writes owner-only credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "amos-agent-auth-"));
  chmodSync(directory, 0o755);
  const file = join(directory, "oauth.json");
  const store = new FileTokenStore(file);
  await store.write({ access_token: "secret" });
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal((await store.read()).access_token, "secret");
});

class MemoryStore {
  constructor(value = null) {
    this.value = value;
  }
  async read() {
    return this.value;
  }
  async write(value) {
    this.value = { ...value, version: 1 };
  }
  async clear() {
    this.value = null;
  }
}

function discoveryFetch(overrides = {}) {
  return async (url) => {
    const value = String(url);
    if (value.endsWith("/.well-known/oauth-protected-resource/mcp")) {
      return jsonResponse(200, {
        resource: "https://platform.custom.amoslabs.com/mcp",
        authorization_servers: ["https://platform.custom.amoslabs.com"]
      });
    }
    if (value.endsWith("/.well-known/oauth-authorization-server")) {
      return jsonResponse(200, {
        issuer: "https://platform.custom.amoslabs.com",
        authorization_endpoint: "https://platform.custom.amoslabs.com/oauth/authorize",
        token_endpoint: "https://platform.custom.amoslabs.com/oauth/token",
        registration_endpoint: "https://platform.custom.amoslabs.com/oauth/register",
        code_challenge_methods_supported: ["S256"],
        ...overrides
      });
    }
    throw new Error(`Unexpected URL ${value}`);
  };
}
