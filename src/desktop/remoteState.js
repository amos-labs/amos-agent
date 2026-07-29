import { AmosMcpClient, extractMcpText } from "../mcp/amosMcpClient.js";
import { fetchCompat } from "../util/fetchCompat.js";
import {
  DEFAULT_COMPANY_CACHE_TTL_SECONDS,
  MAX_COMPANY_CACHE_TTL_SECONDS,
  MIN_COMPANY_CACHE_TTL_SECONDS,
  verifyCompanyCacheGrant
} from "./companyCache.js";
import { createAbortError, linkAbortSignal } from "../util/abort.js";

export class DesktopRemoteStateClient {
  constructor({ mcpUrl, oauth, requestTimeoutMs = 30_000 }, fetchImpl = fetchCompat) {
    this.mcpUrl = mcpUrl;
    this.oauth = oauth;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetch = fetchImpl;
    this.mcp = new AmosMcpClient(
      {
        url: mcpUrl,
        getAccessToken: (options) => oauth.getAccessToken(options),
        requestTimeoutMs
      },
      fetchImpl
    );
  }

  async identity({ signal = null } = {}) {
    const result = await this.mcp.callTool("whoami", {}, { signal });
    return parseMcpJson(result, "AMOS identity");
  }

  async companySnapshot({ signal = null } = {}) {
    const snapshot = parseMcpJson(
      await this.mcp.callTool("resume_company", {}, { signal }),
      "AMOS company briefing"
    );
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error("AMOS company briefing returned an invalid response");
    }
    const current = { ...snapshot };
    delete current.offline_cache;
    return current;
  }

  async connectionsCatalog({ signal = null } = {}) {
    const [connectionsResult, providerPayload] = await Promise.all([
      this.mcp.callTool("list_connections", {}, { signal }),
      this.connectionProviderCatalog({ signal })
    ]);
    const connectionPayload = parseMcpJson(connectionsResult, "AMOS connections");
    const providers = Array.isArray(providerPayload?.providers)
      ? providerPayload.providers.map(normalizeProvider).filter(Boolean)
      : [
          ...(Array.isArray(providerPayload?.curated) ? providerPayload.curated : []),
          ...(Array.isArray(providerPayload?.tenant_defined) ? providerPayload.tenant_defined : [])
        ].map(normalizeProvider).filter(Boolean);
    return {
      connections: Array.isArray(connectionPayload?.connections)
        ? connectionPayload.connections.map(normalizeConnection).filter(Boolean)
        : [],
      providers,
      catalogVersion: Number(providerPayload?.catalog_version || 0),
      // Retained for one release so older renderer consumers do not break while
      // list_connection_catalog rolls through deployed platform environments.
      curated: Array.isArray(providerPayload?.curated)
        ? providerPayload.curated.map(normalizeProvider).filter(Boolean)
        : [],
      tenantDefined: Array.isArray(providerPayload?.tenant_defined)
        ? providerPayload.tenant_defined.map(normalizeProvider).filter(Boolean)
        : []
    };
  }

  async connectionProviderCatalog({ signal = null } = {}) {
    try {
      const result = await this.mcp.callTool("list_connection_catalog", {}, { signal });
      return parseMcpJson(result, "AMOS connection catalog");
    } catch (error) {
      if (!/unknown tool ['"]list_connection_catalog['"]/i.test(String(error?.message || ""))) {
        throw error;
      }
      // Backward-compatible rollout only. The legacy response remains
      // platform-owned; Desktop never substitutes a bundled provider list.
      const result = await this.mcp.callTool("list_oauth_providers", {}, { signal });
      return parseMcpJson(result, "AMOS connection providers");
    }
  }

  async connectLink(provider, { signal = null } = {}) {
    const providerKey = String(provider || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(providerKey)) {
      throw new Error("AMOS blocked an invalid connection provider");
    }
    const result = await this.mcp.callTool(
      "connect_link",
      { provider: providerKey },
      { signal }
    );
    const payload = parseMcpJson(result, "AMOS connection link");
    const url = String(payload?.url || "");
    if (!url) throw new Error("AMOS did not return a connection link");
    return {
      provider: String(payload?.provider || providerKey),
      url,
      expiresIn: Number(payload?.expires_in || 0)
    };
  }

  async approvals({ signal = null } = {}) {
    let token = await this.oauth.getAccessToken();
    let response = await this.fetchApprovals(token, { signal });
    if (response.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      response = await this.fetchApprovals(token, { signal });
    }

    const payload = await parseJsonResponse(response, "AMOS approvals");
    if (response.status === 403) {
      return {
        available: false,
        reason: payload.error || "Only an owner or admin can review company approvals.",
        decision_mode: "hosted",
        pending_operations: []
      };
    }
    if (!response.ok) {
      throw new Error(payload.error || `AMOS approvals request failed with ${response.status}`);
    }
    return {
      available: true,
      reason: "",
      decision_mode: payload.decision_mode === "desktop" ? "desktop" : "hosted",
      pending_operations: Array.isArray(payload.pending_operations)
        ? payload.pending_operations.map(normalizeApproval).filter(Boolean)
        : []
    };
  }

  async decideApproval(id, decision, { signal = null, sign = null } = {}) {
    const approvalId = String(id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw new Error("Invalid AMOS approval id");
    const action = decision === "approve" ? "approve" : decision === "deny" ? "deny" : null;
    if (!action) throw new Error("Approval decision must be approve or deny");
    if (typeof sign !== "function") throw new Error("Desktop approval signing is unavailable");
    let token = await this.oauth.getAccessToken();
    let challengeResponse = await this.fetchApprovalChallenge(token, approvalId, action, { signal });
    if (challengeResponse.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      challengeResponse = await this.fetchApprovalChallenge(token, approvalId, action, { signal });
    }
    const challenge = await parseJsonResponse(challengeResponse, "AMOS approval challenge");
    if (!challengeResponse.ok) {
      throw new Error(challenge.error || `AMOS approval challenge failed with ${challengeResponse.status}`);
    }
    if (
      !/^[0-9a-f-]{36}$/i.test(challenge.challenge_id || "") ||
      typeof challenge.message !== "string"
    ) {
      throw new Error("AMOS returned an invalid approval challenge");
    }
    const signature = await sign(challenge.message);
    let response = await this.fetchApprovalDecision(
      token,
      approvalId,
      action,
      { challengeId: challenge.challenge_id, signature, signal }
    );
    if (response.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      response = await this.fetchApprovalDecision(
        token,
        approvalId,
        action,
        { challengeId: challenge.challenge_id, signature, signal }
      );
    }
    const payload = await parseJsonResponse(response, `AMOS approval ${action}`);
    if (!response.ok) {
      throw new Error(payload.error || `AMOS approval ${action} failed with ${response.status}`);
    }
    return payload;
  }

  async intelligenceStatus({ signal = null } = {}) {
    let token = await this.oauth.getAccessToken();
    let response = await this.fetchIntelligenceStatus(token, { signal });
    if (response.status === 401) {
      token = await this.oauth.getAccessToken({ forceRefresh: true });
      response = await this.fetchIntelligenceStatus(token, { signal });
    }

    const payload = await parseJsonResponse(response, "AMOS account status");
    if (!response.ok) {
      throw new Error(
        payload?.error?.message ||
          payload?.message ||
          `AMOS account status request failed with ${response.status}`
      );
    }
    const subscriptionStatus = String(payload?.billing?.subscription_status || "none");
    const billingExempt = payload?.billing?.billing_exempt === true;
    return {
      ready: payload?.ready === true,
      subscriptionStatus,
      billingExempt,
      workspaceActive:
        billingExempt || subscriptionStatus === "active" || subscriptionStatus === "trialing"
    };
  }

  async companyCache({
    identity,
    ttlSeconds = DEFAULT_COMPANY_CACHE_TTL_SECONDS
  } = {}) {
    if (!identity || identity.principal_type !== "user") {
      throw new Error("A signed-in AMOS user is required to refresh company context");
    }
    const ttl = Number(ttlSeconds);
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < MIN_COMPANY_CACHE_TTL_SECONDS ||
      ttl > MAX_COMPANY_CACHE_TTL_SECONDS
    ) {
      throw new Error(
        `Company context lifetime must be between ${MIN_COMPANY_CACHE_TTL_SECONDS} and ${MAX_COMPANY_CACHE_TTL_SECONDS} seconds`
      );
    }
    const result = parseMcpJson(
      await this.mcp.callTool("resume_company", {
        issue_offline_cache: true,
        cache_ttl_seconds: ttl
      }),
      "AMOS company cache"
    );
    const metadata = result?.offline_cache;
    if (!metadata?.token) {
      throw new Error("AMOS did not issue a signed company cache");
    }
    const issuer = amosOrigin(this.mcpUrl);
    const jwks = await this.fetchJwks(issuer);
    const claims = verifyCompanyCacheGrant({
      token: metadata.token,
      jwks,
      expectedIssuer: issuer,
      expectedIdentity: identity
    });
    const snapshot = { ...result };
    delete snapshot.offline_cache;
    if (!sameJson(snapshot, claims.snapshot)) {
      throw new Error("AMOS company-cache envelope does not match its signed snapshot");
    }
    const jwk = jwks.keys.find((key) => key.kid === metadata.kid);
    if (!jwk) throw new Error("AMOS company-cache key is missing from its live JWKS");
    return {
      token: metadata.token,
      claims,
      jwk
    };
  }

  async fetchJwks(issuer = amosOrigin(this.mcpUrl)) {
    const url = new URL("/.well-known/amos-app-auth/jwks.json", issuer);
    if (url.origin !== amosOrigin(this.mcpUrl)) {
      throw new Error("AMOS company-cache keys must share the connected server origin");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const payload = await parseJsonResponse(response, "AMOS signing keys");
      if (!response.ok || !Array.isArray(payload.keys)) {
        throw new Error(
          payload.error || `AMOS signing-key request failed with ${response.status}`
        );
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("AMOS signing-key request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchApprovals(token, { signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(`${amosOrigin(this.mcpUrl)}/api/v1/approvals`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        signal: controller.signal
      });
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS approvals request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async fetchApprovalChallenge(token, id, action, { signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(
        `${amosOrigin(this.mcpUrl)}/api/v1/approvals/${encodeURIComponent(id)}/challenge`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ decision: action }),
          signal: controller.signal
        }
      );
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS approval challenge timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async fetchApprovalDecision(
    token,
    id,
    action,
    { challengeId, signature, signal = null } = {}
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(
        `${amosOrigin(this.mcpUrl)}/api/v1/approvals/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            challenge_id: challengeId,
            signature
          }),
          signal: controller.signal
        }
      );
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS approval decision timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  async fetchIntelligenceStatus(token, { signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const unlink = linkAbortSignal(signal, controller);
    try {
      return await this.fetch(`${amosOrigin(this.mcpUrl)}/v1/intelligence/status`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        signal: controller.signal
      });
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error.name === "AbortError") throw new Error("AMOS account status request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }
}

export function parseMcpJson(result, label = "AMOS") {
  const text = extractMcpText(result);
  if (!text) throw new Error(`${label} returned no data`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned an invalid response`);
  }
}

export function amosOrigin(mcpUrl) {
  const url = new URL(mcpUrl);
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error("AMOS Desktop requires HTTPS except for localhost development");
  }
  return url.origin;
}

export function approvalReviewUrl(mcpUrl, approval) {
  if (approval?.approval_url) {
    const supplied = new URL(approval.approval_url);
    if (supplied.origin !== amosOrigin(mcpUrl)) {
      throw new Error("AMOS approval URL does not match the connected server");
    }
    return supplied.toString();
  }
  const id = String(approval?.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid AMOS approval id");
  return `${amosOrigin(mcpUrl)}/approvals/${encodeURIComponent(id)}`;
}

function normalizeApproval(value) {
  if (!value || typeof value !== "object" || !value.id || !value.verb) return null;
  return {
    id: String(value.id),
    verb: String(value.verb),
    review_summary: String(value.review_summary || humanizeVerb(value.verb)),
    approval_url: value.approval_url ? String(value.approval_url) : "",
    requested_by: String(value.requested_by || ""),
    status: String(value.status || "pending"),
    requested_at: String(value.requested_at || ""),
    decided_at: value.decided_at ? String(value.decided_at) : "",
    decided_by: value.decided_by ? String(value.decided_by) : "",
    last_error: value.last_error ? String(value.last_error) : "",
    agency_origin: String(value.agency_origin || "human_directed"),
    goal_id: value.goal_id ? String(value.goal_id) : "",
    args: value.args && typeof value.args === "object" ? value.args : {}
  };
}

function normalizeConnection(value) {
  if (!value || typeof value !== "object") return null;
  const provider = String(value.provider || "").trim();
  const displayName = String(value.display_name || "").trim();
  if (!provider || !displayName) return null;
  return {
    id: String(value.id || ""),
    provider,
    displayName,
    kind: String(value.kind || "connection"),
    status: String(value.status || "unknown"),
    ownership: String(value.ownership || "service_account"),
    usable: value.usable === true,
    createdAt: value.created_at || null
  };
}

function normalizeProvider(value) {
  if (!value || typeof value !== "object") return null;
  const provider = String(value.provider || "").trim();
  if (!provider) return null;
  return {
    provider,
    label: String(value.label || provider),
    source: String(value.source || "tenant"),
    connectionKind: String(value.connection_kind || "oauth"),
    group: value.group ? String(value.group) : "",
    description: value.description ? String(value.description) : "",
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.map((item) => String(item)).filter(Boolean)
      : [],
    setupMode: String(value.setup_mode || "hosted_oauth"),
    availability: String(
      value.availability ||
      ((value.configured === true || value.credentials_registered === true)
        ? "available"
        : "setup_required")
    ),
    upstreamStatus: value.upstream_status ? String(value.upstream_status) : "",
    configured: value.configured === true || value.credentials_registered === true
  };
}

function humanizeVerb(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned an invalid response (${response.status})`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])])
    );
  }
  return value;
}
