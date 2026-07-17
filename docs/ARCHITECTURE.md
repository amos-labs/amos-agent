# Architecture

AMOS Agent is a local MCP operator, not a cloud-hosted harness.

```text
User machine
  AMOS Agent
    Kimi K3 model loop
    local bash/files/web tools
    AMOS MCP client
    OAuth 2.1 + PKCE session
        |
        v
AMOS Managed Platform
  company brain
  engines
  tenant data
  governance
  approvals
  proof receipts
```

## Boundaries

The local agent owns:

- model loop
- local workspace access
- bash execution
- public web fetch/search
- transient session transcript
- AMOS MCP client
- localhost OAuth callback and automatic token refresh

The managed platform owns:

- durable company data
- engine tools
- credentials and integrations
- operation policy
- human approvals
- proof receipts
- tenant isolation
- managed runtime

## Kimi K3 loop

Kimi K3 is called through Moonshot's OpenAI-compatible Chat Completions API:

- `model: kimi-k3`
- `reasoning_effort: max`
- complete assistant messages are preserved across tool turns
- tool results are appended with matching `tool_call_id`

This matters because Kimi K3 can return separate reasoning content and tool
calls. The loop stores the whole assistant message, not only `content`.

## Tool loading

The agent starts with a compact tool set. AMOS engine tools are discovered on
demand:

1. `amos_list_engines`
2. `amos_load_engine_tools`
3. local wrappers are registered as `amos_<engine>_<tool>`
4. wrappers call `call_engine_tool` through AMOS MCP

The generic `amos_call_engine_tool` remains available for compatibility.

## Authentication

Interactive users run `amos-agent login`. The CLI follows the AMOS protected
resource metadata to its advertised authorization server, dynamically registers
a public client, and completes authorization code + PKCE through a loopback
callback. Access tokens refresh automatically. API keys are reserved for CI and
unattended agent identities.

## Bash

Bash is first-class because local extensibility matters. It is also approval
gated by default because it can mutate the user's machine.

The default execution path is:

```text
model asks run_bash -> user approves -> scrubbed environment -> /bin/bash -lc -> bounded output capture
```

## Non-goals

This project should not grow into the old harness again. It should not contain:

- local CRM/runtime database
- credential vault
- hosted agent sessions
- Solana/relay/token logic
- local business memory
- package marketplace
- broad chat-platform integrations

Those belong in AMOS managed platform or separate projects.
