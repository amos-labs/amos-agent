# AMOS Agent

AMOS Agent is the open-source local operator for the AMOS managed platform.
It can use AMOS-hosted intelligence, Kimi's API, Amazon Bedrock, a customer
OpenAI-compatible endpoint, or an appropriately sized model on the user's
computer. Every deployment talks to the same governed AMOS company brain
through MCP.

It is not a hosted agent service and it is not the old AMOS harness. The managed
platform owns business state, governance, receipts, approvals, and engines. This
agent owns local reasoning, bash, local files, and the MCP bridge.

## AMOS Desktop

AMOS Desktop packages this agent into a downloadable operator console for
macOS. It provides guided setup, AMOS OAuth, infrastructure selection, local
workspace grants, human approval prompts, live work visibility, and activity
history.

```bash
npm install
npm run desktop
```

Create a local macOS bundle:

```bash
npm run desktop:dir
```

Release builds require an Apple Developer ID, hardened runtime, signing, and
notarization. See [docs/DESKTOP.md](docs/DESKTOP.md).

## CLI runtime

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

Create a gitignored `.env.local` file with owner-only permissions for the
selected model provider:

```bash
touch .env.local
chmod 600 .env.local
```

```dotenv
AMOS_MODEL_PROVIDER=kimi
MOONSHOT_API_KEY=sk-your-key
AMOS_MODEL=kimi-k3
AMOS_MODEL_REASONING_EFFORT=max
```

Other examples:

```dotenv
# AMOS-hosted Kimi K3 in AWS
AMOS_MODEL_PROVIDER=amos-hosted
AMOS_MODEL_BASE_URL=https://your-amos-inference-endpoint/v1
AMOS_MODEL=kimi-k3

# Amazon Bedrock OpenAI-compatible endpoint
AMOS_MODEL_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=...
AMOS_MODEL=openai.gpt-oss-120b

# Smaller model on the user's computer
AMOS_MODEL_PROVIDER=ollama
AMOS_MODEL=gpt-oss:20b
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
available for CI and unattended agent identities when no OAuth session exists.
Set `AMOS_AGENT_AUTH_MODE=api-key` to force that identity on a machine that also
has a human OAuth session.

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
- `amos_resume_company`
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

Inference and infrastructure profiles are in
[docs/INTELLIGENCE_PROVIDERS.md](docs/INTELLIGENCE_PROVIDERS.md).
