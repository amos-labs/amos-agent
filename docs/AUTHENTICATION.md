# Authentication

## Interactive users

Run:

```bash
amos-agent login
```

The CLI:

1. Reads the AMOS MCP protected-resource metadata.
2. Discovers the advertised OAuth authorization server.
3. Dynamically registers a public client with a localhost callback.
4. Opens browser login and consent with PKCE S256.
5. Exchanges the one-time code for an access and refresh token.
6. Stores the session locally with owner-only permissions.

Access tokens refresh automatically before expiration. AMOS rotates the refresh
token during each refresh and the CLI replaces the stored value atomically.

```bash
amos-agent status
amos-agent logout
```

The default credential path is `~/.config/amos-agent/oauth.json`. Override it
with `AMOS_AGENT_CREDENTIALS_FILE` when packaging or testing the CLI.

## CI and unattended identities

Non-interactive systems can provide a scoped AMOS agent key:

```bash
export AMOS_API_KEY="amos_..."
```

The local OAuth session takes precedence when one exists. CI normally has no
local session and uses its API key automatically. Set
`AMOS_AGENT_AUTH_MODE=api-key` to force the key on a machine with both. Do not
use a human OAuth refresh token as a CI secret.

## Provider authentication

Kimi is configured independently with `MOONSHOT_API_KEY` (or `KIMI_API_KEY`).
The key stays in the local agent process and is scrubbed from child bash
environments. AMOS managed connector credentials remain server-side and are not
returned to the model.
