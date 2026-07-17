# Safety

AMOS Agent is local software with local tools. The safety model is simple:

1. Keep durable business authority in AMOS MCP.
2. Keep local execution explicit and visible.
3. Ask before local mutation by default.

## Defaults

- Bash commands require confirmation.
- File writes require confirmation.
- Paths are restricted to the configured workspace root.
- Canonical paths are checked so symlinks cannot escape the workspace.
- Common credential files such as `.env.*`, private keys, and cloud/SSH config
  are unavailable to agent file tools.
- Bash receives only basic process environment values; model, AMOS, database,
  and provider credentials are not inherited.
- Command output is truncated to a bounded size.
- Command timeouts terminate the full process group.
- Web fetch blocks loopback, private, link-local, metadata, and credentialed
  URLs, including redirect targets.
- AMOS writes go through platform policy, approvals, and receipts.

## Environment knobs

```bash
AMOS_AGENT_AUTO_APPROVE_BASH=true
AMOS_AGENT_AUTO_APPROVE_WRITES=true
AMOS_AGENT_ALLOW_OUTSIDE_WORKSPACE=true
AMOS_AGENT_BASH_TIMEOUT_MS=60000
AMOS_AGENT_MAX_OUTPUT_BYTES=24000
```

These are for trusted automation contexts, not normal interactive use.

## Provider data

The local agent sends conversation context to the configured model provider.
Do not put secrets in prompts. Use AMOS managed credentials and MCP tools for
business integrations whenever possible.

AMOS OAuth access and refresh tokens are stored outside the workspace in
`~/.config/amos-agent/oauth.json` with owner-only directory and file modes. Use
`AMOS_AGENT_CREDENTIALS_FILE` to override the path and `amos-agent logout` to
remove the session from the machine.
