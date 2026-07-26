# Authentication

AMOS separates three kinds of identity:

1. the person or unattended agent connected to AMOS;
2. the intelligence provider used for inference; and
3. the local device and workspace grants.

One never substitutes for another. A model credential cannot authorize company
data, and an AMOS session does not grant unrestricted access to the user's
computer.

## AMOS Desktop users

Choose **Connect AMOS** in the application. Desktop:

1. reads the protected-resource metadata for the AMOS MCP endpoint;
2. discovers the advertised authorization server;
3. dynamically registers a public client with a loopback callback;
4. opens the system browser for login and consent using PKCE S256;
5. exchanges the one-time authorization code; and
6. stores the refreshable session in the operating-system-protected app data
   directory.

The browser session determines the company, user, role, and effective scopes.
Desktop never accepts a model-provided tenant ID as authorization.

Access tokens refresh automatically. When AMOS rotates a refresh token, the
stored session is replaced atomically.

Disconnecting AMOS removes the local AMOS OAuth session; it does not delete the
user or company from the managed platform.

## Interactive CLI users

The developer CLI uses the same OAuth flow:

```bash
amos-agent login
amos-agent status
amos-agent logout
```

Its default credential path is:

```text
~/.config/amos-agent/oauth.json
```

The containing directory and file are owner-only. Override the location with
`AMOS_AGENT_CREDENTIALS_FILE` for controlled development or testing.

## CI and unattended agents

Non-interactive systems use a dedicated scoped AMOS agent key:

```bash
export AMOS_API_KEY="amos_..."
export AMOS_AGENT_AUTH_MODE=api-key
```

Use the smallest scopes required for the job. Do not copy a human refresh token
into CI or use a broad administrator key as a default automation identity.

When both credentials exist, interactive OAuth takes precedence unless
`AMOS_AGENT_AUTH_MODE=api-key` explicitly selects the agent identity.

## Intelligence-provider authentication

Provider authentication is independent from AMOS identity:

- AMOS-hosted intelligence reuses a short-lived AMOS-backed identity;
- Amazon Bedrock may use its supported customer or AMOS credential adapter;
- provider APIs use that provider's key;
- customer-compatible endpoints use their configured credential; and
- local runtimes normally require no provider credential.

Provider secrets are encrypted with Electron `safeStorage` in Desktop and are
removed from child command environments. They are not written into prompts,
tool results, AMOS documents, or memory capsules.

AMOS-managed application credentials remain server-side. Models call governed
AMOS tools; they do not receive raw OAuth tokens for connected applications.

## Approval identity

A pending company action can be decided only by an authenticated human session
with the required AMOS authority. An MCP bearer token, local model, automation,
or deep link cannot self-approve consequential work.

When an unauthenticated person opens a valid approval link, AMOS may redirect
them through login and back to the original destination. Authorization is still
evaluated after login.

## Threat boundaries

- OAuth token and registration endpoints remain pinned to the discovered issuer.
- Browser authorization endpoints must use HTTPS except for the local callback.
- Callback state and PKCE verifier must match the initiating session.
- Refresh tokens never enter renderer JavaScript or model context.
- Tenant scope is derived from the authenticated AMOS connection.
- Local workspace access requires a separate explicit user grant.
