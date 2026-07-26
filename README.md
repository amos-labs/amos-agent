# AMOS Desktop

**The open-source native operator for the governed AMOS company brain.**

AMOS Desktop lets a person choose where intelligence runs, connect it to the
company context and capabilities in AMOS, and safely work across both company
systems and an explicitly selected local workspace.

[Download for Apple Silicon](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-arm64.dmg)
·
[Download for Intel Mac](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-x64.dmg)
·
[AMOS Labs](https://amoslabs.com)
·
[Managed platform](https://app.amoslabs.com)

## Why it exists

General-purpose AI is powerful, but a company needs more than a model:

- durable context that survives a chat or model change;
- secure connections to the applications where work actually happens;
- identity, tenant boundaries, roles, and policy at the point of action;
- human decisions for consequential work;
- receipts showing what changed, why, and who approved it; and
- a local surface for documents, code, files, and private work.

AMOS Desktop supplies the native execution and interaction layer. The AMOS
managed platform supplies the governed company brain. Models remain
interchangeable.

```text
AMOS Desktop
  chosen intelligence
  local workspace + private task context
  documents, screenshots, code, and tools
               │
               │ OAuth + tenant-scoped MCP
               ▼
AMOS managed platform
  company memory + connected applications
  engines + automations + goals
  policy + approvals + proof receipts
```

## What works today

- Native macOS application for Apple Silicon and Intel
- Browser-based AMOS OAuth 2.1 + PKCE sign-in
- Signed-in company, role, and effective-scope identity
- AMOS engine discovery through a compact MCP tool surface
- Documents, source files, drag/drop, and pasted screenshots
- Local PDF, DOCX, text, and source extraction
- Explicit **Use for this task**, **Keep in private memory**, or **Add to company memory** handling
- Keychain-protected private memory with reuse, promotion, and permanent forget controls
- Passphrase-encrypted `.amos-memory` export/import with preview, tamper detection, deduplication, and fork lineage
- Typed company canvases for metrics, tables, trends, briefs, evidence, approvals, and receipts
- Local workspace grants, search, reads, Git status/diff, and atomic patches
- Approval-gated shell commands and file changes
- Live work, decisions, approval notifications, activity, and proof
- AMOS-hosted, customer-cloud, provider API, and local-model profiles
- Signed, notarized releases with in-app update notifications

AMOS Desktop is not a second CRM, integration vault, or company database.
Shared business state, integrations, governance, and receipts remain in AMOS.

## Install

1. Download the correct macOS DMG from the links above.
2. Drag **AMOS Desktop** into **Applications**.
3. Open it and choose **Connect AMOS**.
4. Sign in to the company you are authorized to access.
5. Choose an intelligence profile.
6. Grant a local workspace only if you want AMOS to work with local files.

The app checks for signed updates after launch and every six hours. It notifies
you before downloading and never restarts during an active task.

See [Desktop installation and releases](docs/DESKTOP.md) for packaging,
signing, update, and troubleshooting details.

## Choose where intelligence runs

AMOS Desktop uses a provider-neutral, OpenAI-compatible model boundary.
Supported profiles include:

- **AMOS Intelligence** — AMOS-managed inference in AWS
- **Amazon Bedrock** — customer- or AMOS-controlled AWS inference
- **Compatible endpoint** — a customer-controlled HTTPS endpoint
- **Provider API** — including the Moonshot/Kimi API
- **Local runtime** — Ollama or llama.cpp on suitable hardware

Changing the intelligence does not reconnect the company or change the user's
AMOS authority. Models without reliable tool use should be limited to
observe-and-draft workflows.

AMOS Desktop 0.7 adds a guided offline path for Ollama: it assesses the
computer, recommends one of three curated profiles, shows resumable download
progress, supports explicit removal, and can activate a visibly separate
local-only operating mode. In that mode AMOS and public-web tools are not
exposed to the model. Desktop follows the Mac's light or dark appearance by
default, with an immediate header switch and persistent overrides.

See [Intelligence providers](docs/INTELLIGENCE_PROVIDERS.md).

## Security model

The desktop renderer is sandboxed. Provider secrets are encrypted with the
operating system's secure storage. Local file tools remain inside the selected
workspace, common credential files are blocked, and child commands receive a
scrubbed environment.

Company actions always pass through AMOS identity, tenant isolation, RBAC,
operation policy, approvals, and proof. A local model cannot weaken those
server-side controls.

Read [Safety](docs/SAFETY.md), [Authentication](docs/AUTHENTICATION.md), and
[Security policy](SECURITY.md) before extending local authority.

## Build from source

Node.js 22 or newer is required. Node.js 24 LTS is recommended.

```bash
git clone https://github.com/amos-labs/amos-agent.git
cd amos-agent
npm install
npm test
npm run desktop
```

Create an unpacked local application:

```bash
npm run desktop:dir
```

Create unsigned local DMG/ZIP artifacts:

```bash
npm run desktop:build
```

Official releases are signed and notarized in GitHub Actions. Local development
builds do not contact the production update feed.

## CLI for developers and automation

The desktop application is the primary end-user experience. The same runtime is
also available as the `amos-agent` CLI for development, CI, and controlled
automation:

```bash
npm link
amos-agent login
amos-agent status
amos-agent --cwd /path/to/project
```

Run one task:

```bash
amos-agent --cwd /path/to/project \
  "Resume my company context, inspect this repository, and explain what should happen next."
```

Scoped `AMOS_API_KEY` credentials are supported for CI and unattended agent
identities. Human users should use OAuth.

The example environment file documents provider and advanced CLI configuration:
[`.env.example`](.env.example).

## Built-in local tools

- `list_files`, `read_file`, and `write_file`
- `search_files`
- `git_status` and `git_diff`
- `apply_patch`
- `run_bash`
- `web_fetch` and optional `web_search`

AMOS tools begin with a compact bootstrap:

- `amos_get_started`
- `amos_whoami`
- `amos_resume_company`
- `amos_company_overview`
- `amos_list_engines`
- `amos_load_engine_tools`
- `amos_call_engine_tool`

Engine-specific tools are loaded only when needed, keeping model context small
as the AMOS platform grows.

## Project map

- [Desktop product and release guide](docs/DESKTOP.md)
- [Architecture and system boundaries](docs/ARCHITECTURE.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Intelligence and infrastructure profiles](docs/INTELLIGENCE_PROVIDERS.md)
- [Safety model](docs/SAFETY.md)
- [Memory classes and private-memory controls](docs/MEMORY.md)
- [Typed company canvas](docs/CANVAS.md)
- [Canvas, offline intelligence, and portable memory proposal](docs/CANVAS-OFFLINE-MEMORY-SPIKE.md)
- [Contributing](CONTRIBUTING.md)

## Direction

The near-term product path is:

1. reliable signed distribution on macOS and Windows;
2. streaming, cancellation, and durable task checkpoints;
3. richer typed canvases and managed result adapters for company data and active work;
4. encrypted private local memory with explicit promotion into shared AMOS memory;
5. curated small-model offline operation with an explicit local-only boundary; and
6. governed company-cache retrieval and safe reconnect reconciliation for portable memory.

The governing principle is constant: **local intelligence may observe, reason,
draft, and execute within explicit grants; AMOS remains authoritative for
shared company memory, policy, approvals, and proof.**

## License

Apache License 2.0. See [LICENSE](LICENSE).
