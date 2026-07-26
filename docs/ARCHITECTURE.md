# Architecture

AMOS Desktop is an open-source native operator for the AMOS managed platform.
It combines local execution and a model of the user's choice with the durable,
tenant-scoped company brain in AMOS.

It is deliberately split across two trust domains:

```text
User device
  AMOS Desktop
    sandboxed renderer
    provider-neutral agent loop
    local workspace + task attachments
    local tools + approval bridge
    OAuth client + compact AMOS MCP client
                         │
                         │ tenant-scoped identity and tools
                         ▼
AMOS managed platform
    durable company memory
    connected applications and credentials
    engines, automations, goals, and receipts
    RBAC, policy, human approvals, and tenant isolation
```

## Responsibilities

### Desktop and local agent

- selected intelligence runtime and model loop;
- explicitly granted local workspace access;
- local files, repository inspection, patches, and shell execution;
- task-local documents, screenshots, and extracted content;
- transient session transcript and local activity;
- OAuth 2.1 + PKCE client and automatic token refresh;
- compact MCP bootstrap and on-demand AMOS engine loading; and
- native approval and update notifications.

### AMOS managed platform

- durable company and organizational memory;
- tenant-scoped records and connected source systems;
- managed integration credentials;
- roles, scopes, operation policy, and budgets;
- human approval decisions;
- immutable proof receipts and organizational learning;
- automations, governed goals, and managed runtimes; and
- authoritative sharing and access-control decisions.

The boundary is intentional. Installing the desktop does not create a second
business database or move shared integration secrets onto the user's device.

## Intelligence boundary

The runtime uses an OpenAI-compatible Chat Completions boundary. A provider
profile supplies:

- base URL;
- model identifier;
- credential strategy;
- deployment boundary;
- text, vision, tool-use, and reasoning capabilities; and
- optional AMOS-backed short-lived identity.

The same agent and AMOS tool surface can use managed AWS inference, Amazon
Bedrock, a model-provider API, a customer-controlled compatible endpoint, or a
model running locally.

Changing the model does not change AMOS tenant, role, policy, or proof. A model
that cannot reliably emit structured tool calls should remain in
observe-and-draft mode.

Complete assistant messages are preserved between tool turns because reasoning
models may return structured fields in addition to visible content.

## Desktop process boundary

The Electron renderer:

- runs with `sandbox: true`;
- has no Node.js integration;
- uses context isolation; and
- receives only an allowlisted IPC surface from the preload bridge.

The main process owns credentials, OAuth, model clients, local tools, attachment
extraction, update checks, and approval continuations. Provider secrets are
encrypted through Electron `safeStorage` before being written to disk.

The model never receives raw OAuth refresh tokens, integration credentials, or
the unrestricted child-process environment.

## Universal input

Documents and screenshots enter through the desktop main process:

1. validate type and bounded size;
2. extract PDF, DOCX, text, or source content locally;
3. send images only to a vision-capable model;
4. keep the material task-local by default; and
5. encrypt it locally only after explicit **Keep in private memory** selection;
   or call an AMOS document tool only after explicit **Add to company memory**
   selection.

Company-memory persistence remains subject to the signed-in user's AMOS scope
and the managed platform's document access rules.

## Local execution

Local tools are constrained to the selected workspace. Canonical-path and
symlink checks prevent path escapes. Credential-like files are blocked.

Mutation follows the approval bridge:

```text
model proposes local action
  -> desktop presents exact action
  -> user approves once or denies
  -> action runs with scrubbed environment
  -> bounded result returns to the model
  -> local activity records the outcome
```

AMOS company actions use a separate authority path:

```text
model calls AMOS tool
  -> platform resolves tenant + identity + policy
  -> auto-execute or park for authorized human
  -> execute only after valid decision
  -> emit durable receipt
```

The local approval bridge cannot approve a parked AMOS company decision on the
model's behalf.

## AMOS tool loading

The agent begins with a compact bootstrap:

1. `get_started`
2. `whoami`
3. `resume_company` or `company_overview`
4. `list_engines`
5. `load_engine_tools`
6. `call_engine_tool`

Local aliases expose the bootstrap as `amos_*` tools. Engine verbs are loaded
only when the task needs them, preventing a growing company platform from
consuming the entire model context on every turn.

## Authentication

Desktop and interactive CLI users use OAuth authorization code + PKCE. The
client discovers AMOS authorization metadata, dynamically registers a public
client, opens browser login, and accepts the callback only on loopback.

API keys are reserved for CI and unattended agent identities. AMOS always
derives effective tenant and scope from the authenticated connection; a
model-supplied record or tenant identifier is never sufficient authority.

## Signed distribution

Release tags build macOS DMG and ZIP artifacts for Intel and Apple Silicon.
GitHub Actions signs and notarizes the application, generates architecture-aware
update metadata and blockmaps, and publishes checksums.

Packaged applications check the signed feed after launch and periodically.
Downloads and restart/install remain explicit, and the app will not restart
during an active task.

## Local memory state

AMOS Desktop 0.5.0 implements the versioned memory contract and encrypted
private-memory store. The store contains encrypted envelopes rather than
plaintext filenames or content, maintains a bounded append-only sync journal,
and exposes explicit reuse, promotion, and forget controls.

Offline intelligence and portable capsule transfer remain planned extensions.
All current and future local state preserves these rules:

- shared AMOS data remains server-authoritative;
- private memory is not silently promoted;
- cached company data carries scope, provenance, and expiry;
- offline company actions remain proposals until reauthorized online; and
- imports, exports, and forks never include credentials.

See [CANVAS-OFFLINE-MEMORY-SPIKE.md](CANVAS-OFFLINE-MEMORY-SPIKE.md).

## Non-goals

This repository should not become a second hosted harness or managed platform.
It should not own:

- a local CRM or authoritative company database;
- the integration credential vault;
- hosted multi-user agent sessions;
- AMOS protocol, relay, token, or marketplace infrastructure; or
- a duplicate policy or receipt system.

Those capabilities remain in AMOS managed services or their dedicated
open-source projects.
