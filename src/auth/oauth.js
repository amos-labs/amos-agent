import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import { fetchCompat } from "../util/fetchCompat.js";

const CALLBACK_PATH = "/oauth/callback";
const REFRESH_SKEW_MS = 60_000;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function randomToken() {
  return base64url(randomBytes(32));
}

function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function originFor(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new Error("AMOS OAuth requires HTTPS except for localhost development");
  }
  return url.origin;
}

function assertSameOrigin(endpoint, issuer, label) {
  if (!endpoint || new URL(endpoint).origin !== new URL(issuer).origin) {
    throw new Error(`AMOS OAuth ${label} must share the issuer origin`);
  }
}

export class AmosOAuthSession {
  constructor({
    mcpUrl,
    store,
    fetchImpl = fetchCompat,
    openBrowser = openSystemBrowser,
    requestTimeoutMs = 20_000,
    callbackReceiverFactory = createCallbackReceiver
  }) {
    this.mcpUrl = mcpUrl;
    this.store = store;
    this.fetch = fetchImpl;
    this.openBrowser = openBrowser;
    this.requestTimeoutMs = requestTimeoutMs;
    this.callbackReceiverFactory = callbackReceiverFactory;
    this.refreshPromise = null;
  }

  async discover() {
    const resourceOrigin = originFor(this.mcpUrl);
    const protectedResource = await this.fetchJson(`${resourceOrigin}/.well-known/oauth-protected-resource/mcp`);
    const advertisedServer = protectedResource.authorization_servers?.[0];
    if (!advertisedServer) throw new Error("AMOS protected resource did not advertise an authorization server");
    const authorizationOrigin = originFor(advertisedServer);
    const metadata = await this.fetchJson(`${authorizationOrigin}/.well-known/oauth-authorization-server`);
    const issuer = metadata.issuer || authorizationOrigin;
    if (new URL(issuer).origin !== authorizationOrigin) {
      throw new Error("AMOS OAuth metadata issuer does not match the advertised authorization server");
    }
    for (const [field, label] of [
      ["authorization_endpoint", "authorization endpoint"],
      ["token_endpoint", "token endpoint"],
      ["registration_endpoint", "registration endpoint"]
    ]) {
      assertSameOrigin(metadata[field], issuer, label);
    }
    if (!metadata.code_challenge_methods_supported?.includes("S256")) {
      throw new Error("AMOS OAuth server does not advertise PKCE S256");
    }
    return metadata;
  }

  async login({ onAuthorize = () => {}, openBrowser = true, timeoutMs = 300_000, scopes = [] } = {}) {
    const metadata = await this.discover();
    const state = randomToken();
    const verifier = randomToken();
    const receiver = await this.callbackReceiverFactory({ state, timeoutMs });

    try {
      const registration = await this.fetchJson(metadata.registration_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "AMOS Agent",
          redirect_uris: [receiver.redirectUri],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"]
        })
      });
      if (!registration.client_id) throw new Error("AMOS OAuth registration did not return a client_id");

      const authorizationUrl = new URL(metadata.authorization_endpoint);
      authorizationUrl.searchParams.set("client_id", registration.client_id);
      authorizationUrl.searchParams.set("redirect_uri", receiver.redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      if (scopes.length > 0) authorizationUrl.searchParams.set("scope", scopes.join(" "));

      const url = authorizationUrl.toString();
      onAuthorize({ url, browserOpened: openBrowser ? this.openBrowser(url) : false });
      const { code } = await receiver.result;
      const token = await this.exchangeCode(metadata.token_endpoint, {
        code,
        clientId: registration.client_id,
        redirectUri: receiver.redirectUri,
        verifier
      });
      const credentials = this.credentialsFromToken(token, {
        issuer: metadata.issuer,
        mcp_url: this.mcpUrl,
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint,
        registration_endpoint: metadata.registration_endpoint,
        client_id: registration.client_id
      });
      await this.store.write(credentials);
      return credentials;
    } finally {
      receiver.close();
    }
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    const credentials = await this.store.read();
    if (!credentials?.access_token) {
      throw new Error("AMOS is not connected. Run `amos-agent login` first.");
    }
    if (new URL(credentials.mcp_url).origin !== new URL(this.mcpUrl).origin) {
      throw new Error("Stored AMOS OAuth session belongs to a different MCP server. Run `amos-agent login`.");
    }
    if (!forceRefresh && Number(credentials.expires_at || 0) > Date.now() + REFRESH_SKEW_MS) {
      return credentials.access_token;
    }
    if (!credentials.refresh_token) {
      throw new Error("AMOS OAuth session cannot be refreshed. Run `amos-agent login` again.");
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(credentials).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async refresh(credentials) {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
      client_id: credentials.client_id
    });
    const token = await this.fetchJson(credentials.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    const updated = this.credentialsFromToken(token, credentials);
    await this.store.write(updated);
    return updated.access_token;
  }

  async status() {
    return this.store.read();
  }

  async logout() {
    await this.store.clear();
  }

  async exchangeCode(tokenEndpoint, { code, clientId, redirectUri, verifier }) {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId
    });
    return this.fetchJson(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
  }

  credentialsFromToken(token, base) {
    if (!token?.access_token) throw new Error("AMOS OAuth token response did not include an access_token");
    return {
      ...base,
      access_token: token.access_token,
      refresh_token: token.refresh_token || base.refresh_token,
      token_type: token.token_type || "Bearer",
      scope: token.scope || base.scope || "",
      expires_at: Date.now() + Math.max(Number(token.expires_in || 3600), 1) * 1000
    };
  }

  async fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`AMOS OAuth returned an invalid response (${response.status})`);
      }
      if (!response.ok) {
        throw new Error(payload.error_description || payload.error || `AMOS OAuth request failed with ${response.status}`);
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("AMOS OAuth request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function createCallbackReceiver({ state, timeoutMs }) {
  let settled = false;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end("Not found");
      return;
    }
    const returnedState = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    if (returnedState !== state) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("OAuth state mismatch. Return to the terminal.");
      finish(new Error("AMOS OAuth state mismatch"));
      return;
    }
    if (oauthError || !code) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("AMOS authorization was not completed. Return to the terminal.");
      finish(new Error(`AMOS OAuth authorization failed: ${oauthError || "missing code"}`));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      "<!doctype html><meta charset=utf-8><title>AMOS Agent connected</title><body style='font-family:system-ui;max-width:38rem;margin:5rem auto;padding:1rem'><h1>AMOS Agent connected</h1><p>You can close this tab and return to the terminal.</p></body>"
    );
    finish(null, { code });
  });

  function finish(error, value) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) rejectResult(error);
    else resolveResult(value);
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
  const timer = setTimeout(() => finish(new Error("AMOS OAuth login timed out")), timeoutMs);
  timer.unref?.();

  return {
    redirectUri,
    result,
    close() {
      clearTimeout(timer);
      server.close();
    }
  };
}

export function openSystemBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
