# AMOS Desktop

**The open-source native operator for the governed AMOS company brain.**

AMOS Desktop lets a person choose where intelligence runs, connect it to the
company context and capabilities in AMOS, and safely work across both company
systems and an explicitly selected local workspace.

The first run offers three honest starting points:

- **My workspace** — no AMOS account required; use a provider key or local
  model for private code, research, documents, and local automation.
- **Northwind demo** — a short-lived sample company using the real AMOS tool,
  policy, approval, receipt, and hosted-intelligence boundaries.
- **My company** — sign in or create an AMOS account for durable organizational
  memory, connected applications, shared authority, approvals, and proof.

[Download for Apple Silicon](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-arm64.dmg)
·
[Download for Intel Mac](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-x64.dmg)
·
[Download for Windows](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-Windows-x64-Setup.exe)
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

- Native macOS applications for Apple Silicon and Intel, plus Windows 10/11 x64
- Browser-based AMOS OAuth 2.1 + PKCE sign-in
- Signed-in company, role, and effective-scope identity
- AMOS engine discovery through a compact MCP tool surface
- Documents, source files, drag/drop, and pasted screenshots
- Local PDF, DOCX, text, and source extraction
- Explicit **Use for this task**, **Keep in private memory**, or **Add to company memory** handling
- Operating-system-protected private memory with reuse, promotion, and permanent forget controls
- Passphrase-encrypted `.amos-memory` export/import with preview, tamper detection, deduplication, and fork lineage
- Explicit four-hour, server-signed company briefings for read-only offline work
- Encrypted offline outcome drafts with live diff, identity pinning, and explicit reauthorization
- Typed company canvases for metrics, tables, trends, briefs, evidence, approvals, and receipts
- Local workspace grants, search, reads, Git status/diff, and atomic patches
- A bounded project briefing with detected stack, manifests, scripts, Git
  state, README context, verification commands, and safe suggested next tasks
- Approval-gated shell commands and file changes
- Digest-addressed local task receipts for completed, failed, and canceled work
- Streamed responses with visible planning, action, and evaluation phases
- Productive tasks continue until completion, safe cancellation, or a no-progress safeguard
- Live user steering that joins the same task at the next safe model/tool boundary
- Safe cancellation across model, MCP, web, and local process work
- Encrypted restart checkpoints with identity, company-context, and approval revalidation
- Visible, skill-backed workflows with task-specific verification criteria
- Live work, decisions, approval notifications, activity, and proof
- AMOS-hosted, customer-cloud, provider API, and local-model profiles
- Signed macOS and Windows releases with in-app update notifications

AMOS Desktop is not a second CRM, integration vault, or company database.
Shared business state, integrations, governance, and receipts remain in AMOS.

## Install

1. Download the correct installer from the links above.
2. On macOS, drag **AMOS Desktop** into **Applications**. On Windows, run the
   signed per-user installer; it adds Start-menu and desktop shortcuts without
   requiring an administrator account.
3. Open it and choose **My workspace**, **Northwind demo**, or **My company**.
4. For personal work, select a local runtime, provider API, Bedrock, or another
   compatible endpoint. No AMOS account or company tools are required.
5. For the demo, the browser creates a bounded sample company and securely
   returns it to Desktop without placing its short-lived key in a URL.
6. For your company, sign in and use AMOS Hosted immediately—or choose another
   intelligence profile.
7. Grant only the local workspace you want AMOS to inspect and operate.

The app checks for signed updates after launch and every six hours. It notifies
you before downloading and never restarts during an active task.

See [Desktop installation and releases](docs/DESKTOP.md) for packaging,
signing, update, and troubleshooting details. See
[skills and workflows](docs/SKILLS_AND_WORKFLOWS.md) for the engine/skill/workflow
contract and tenant-extension safety model.

## Choose where intelligence runs

AMOS Desktop uses a provider-neutral, OpenAI-compatible model boundary.
Supported profiles include:

- **AMOS Hosted (default)** — zero-config AMOS-managed inference in AWS;
  included plan credits apply first and additional usage is metered
- **Amazon Bedrock** — customer- or AMOS-controlled AWS inference
- **Compatible endpoint** — a customer-controlled HTTPS endpoint
- **Provider API** — including the Moonshot/Kimi API
- **Local runtime** — Ollama or llama.cpp on suitable hardware

Changing the intelligence does not reconnect the company or change the user's
AMOS authority. Models without reliable tool use should be limited to
observe-and-draft workflows.

AMOS Hosted uses the same short-lived AMOS identity as the company connection.
Desktop requests the stable `auto` model alias, while the managed platform owns
provider/model routing. That lets AMOS move from Bedrock to an AMOS-hosted model
or route by workload without shipping a new desktop build. Explicit provider
keys, private compatible endpoints, customer Bedrock, and local models remain
available and are never overwritten after the user selects them.

AMOS Desktop 0.7 adds a guided offline path for Ollama: it assesses the
computer, recommends one of three curated profiles, shows resumable download
progress, supports explicit removal, and can activate a visibly separate
local-only operating mode. In that mode AMOS and public-web tools are not
exposed to the model. Desktop follows the operating system's light or dark appearance by
default, with an immediate header switch and persistent overrides.

AMOS Desktop 0.9 adds an explicit offline company-context grant. While online,
a signed-in user can ask AMOS for a short-lived, server-signed copy of the
already bounded `resume_company` briefing. Desktop verifies the signature and
current identity, encrypts the grant with operating-system protection, and
exposes one read-only tool in local-only mode. It never carries credentials,
write authority, approvals, or permission to replay work.

AMOS Desktop 0.10 adds outcome-level offline drafts. A local model can stage
human-readable proposed work, but it cannot queue AMOS tool arguments or
actions. On reconnect, Desktop checks the exact user and tenant, compares the
captured section fingerprints with a fresh read-only company briefing, and
shows any drift in **Decisions**. Continuing only fills the online Operator
composer; the user must still press **Run**, and current AMOS policy, approvals,
and receipts govern everything that follows.

AMOS Desktop 0.11 adds a durable task lifecycle. OpenAI-compatible model output
streams into Operator while the Live Work panel shows bounded phases and tool
progress. **Stop safely** aborts the active model request, MCP call, web fetch,
or local process tree. Signed-in company tasks receive an operating-system
encrypted checkpoint. After a restart or cancellation, Desktop rechecks the
exact user and tenant, fetches a fresh `resume_company` briefing and approval
queue, and loads a no-replay continuation into Operator for explicit review.
Completed tasks remove their checkpoint.

AMOS Desktop 0.13 makes **AMOS Hosted** the zero-config intelligence path.
Signing into AMOS supplies short-lived inference authorization automatically;
included plan credits apply first and additional usage is metered to the
company. The client requests only the stable `auto` alias so provider/model
routing can evolve server-side. Existing BYOK, private endpoint, Bedrock, and
local profiles remain explicit alternatives.

New installations default to balanced reasoning rather than maximum reasoning.
AMOS Hosted accepts the stable `auto` alias and a reasoning-effort hint, while
the managed platform owns the actual routine, balanced, or deep model route.
Users can still explicitly request higher reasoning or choose any supported
provider. This keeps routine coding, summarization, extraction, and tool work
from paying frontier-max cost by default.

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

Create an unsigned local Windows x64 installer:

```bash
npm run desktop:build:win
```

Official macOS releases are signed and notarized, and official Windows releases
are Authenticode-signed. GitHub Actions publishes both platforms together only
after every installer and update manifest passes its platform gate. Local
development builds do not contact the production update feed.

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
- `desktop_inspect_project`
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
- [Signed offline company context](docs/OFFLINE_COMPANY_CONTEXT.md)
- [Offline draft reconciliation](docs/OFFLINE_RECONCILIATION.md)
- [Streaming, cancellation, and restart-safe tasks](docs/TASK_LIFECYCLE.md)
- [Typed company canvas](docs/CANVAS.md)
- [Canvas, offline intelligence, and portable memory proposal](docs/CANVAS-OFFLINE-MEMORY-SPIKE.md)
- [Contributing](CONTRIBUTING.md)

## Direction

The near-term product path is:

1. signed device identity and policy-controlled environment grants;
2. richer typed canvases and managed result adapters for company data and active work;
3. richer private-memory retrieval and portable continuity;
4. enterprise deployment and fleet-management controls; and
5. Windows on Arm and managed-store distribution when customer demand warrants them.

The governing principle is constant: **local intelligence may observe, reason,
draft, and execute within explicit grants; AMOS remains authoritative for
shared company memory, policy, approvals, and proof.**

## License

Apache License 2.0. See [LICENSE](LICENSE).
