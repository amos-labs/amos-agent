# AMOS Agent

Local AMOS Agent is a lightweight, open-source operator for the AMOS managed
platform. It runs on the user's machine, uses Kimi K3 for reasoning, and talks
to the AMOS company brain through MCP.

It is not a hosted agent service and it is not the old AMOS harness. The managed
platform owns business state, governance, receipts, approvals, and engines. This
agent owns local reasoning, bash, local files, and the MCP bridge.

## Local runtime

AMOS Agent is a standalone Node.js CLI. The executable entry point is
[`bin/amos-agent.js`](bin/amos-agent.js), exposed as the `amos-agent` command by
`package.json`. It runs entirely on the user's machine; there is no hosted agent
process.

## Install

Node.js 22 or newer is required. Node.js 24 LTS is recommended.

```bash
git clone https://github.com/amos-labs/amos-agent.git
cd amos-agent
npm link
```

For local development from this folder:

```bash
node ./bin/amos-agent.js --help
```

## Configure

Create a gitignored `.env.local` file with owner-only permissions for the Kimi
API key:

```bash
touch .env.local
chmod 600 .env.local
```

```dotenv
MOONSHOT_API_KEY=sk-your-key
KIMI_MODEL=kimi-k3
KIMI_REASONING_EFFORT=max
```

Run directly with the environment file:

```bash
node --env-file=.env.local ./bin/amos-agent.js --once "Hello"
```

Environment exports remain supported:

```bash
export MOONSHOT_API_KEY="sk-..."
export KIMI_MODEL="kimi-k3"
export KIMI_REASONING_EFFORT="max"
```

Connect the local agent to your AMOS account in the browser:

```bash
amos-agent login
amos-agent status
```

OAuth uses authorization code + PKCE and stores the refreshable session in an
owner-only local file. No AMOS key is copied into the CLI. `AMOS_API_KEY` remains
available as an explicit override for CI and unattended agent identities.

Optional native search:

```bash
export BRAVE_SEARCH_API_KEY="..."
```

## Run

Interactive:

```bash
amos-agent --cwd /path/to/project
```

One prompt:

```bash
amos-agent --cwd /path/to/project "Read the repo and call AMOS company_overview"
```

Disconnect this machine:

```bash
amos-agent logout
```

## Built-in tools

- `run_bash` — run local bash commands after user approval by default.
- `list_files` — list workspace files.
- `read_file` — read workspace text files.
- `write_file` — write workspace text files after user approval by default.
- `web_fetch` — fetch and compact a known URL.
- `web_search` — Brave Search when `BRAVE_SEARCH_API_KEY` is configured.
- `amos_get_started`
- `amos_whoami`
- `amos_company_overview`
- `amos_list_engines`
- `amos_load_engine_tools`
- `amos_call_engine_tool`

## Safety model

By default:

- Bash asks before every command.
- File writes ask before every write.
- Local paths are constrained to the workspace root.
- Symlink escapes and direct access to common credential files are blocked.
- Bash receives a small, scrubbed environment rather than provider/API secrets.
- Public web fetches refuse local, private, and cloud-metadata addresses.
- AMOS business actions go through MCP, so platform RBAC, operation policy,
  approvals, and proof receipts remain authoritative.

Override for automation only when you know what you are doing:

```bash
export AMOS_AGENT_AUTO_APPROVE_BASH=true
export AMOS_AGENT_AUTO_APPROVE_WRITES=true
export AMOS_AGENT_ALLOW_OUTSIDE_WORKSPACE=true
```

## Design principle

The local agent can observe, reason, patch local files, run local commands, and
call AMOS. The managed platform owns business state, durable memory, policy,
receipts, approvals, and tenant boundaries.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Authentication details are in [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).
