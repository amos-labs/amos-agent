# Safety

AMOS Agent is local software with local tools. The safety model is simple:

1. Keep durable business authority in AMOS MCP.
2. Keep local execution explicit and visible.
3. Ask before local mutation by default.

## Defaults

- Bash commands require confirmation.
- File writes require confirmation.
- Paths are restricted to the configured workspace root.
- Command output is truncated to a bounded size.
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
