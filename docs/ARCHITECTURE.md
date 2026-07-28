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
- streamed model output, active-task steering, cancellation, and encrypted restart checkpoints;
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

When supported by the configured OpenAI-compatible endpoint, Desktop consumes
SSE deltas and incrementally assembles both visible text and structured tool
calls. One task-level abort signal is linked to the model request, AMOS MCP
requests, public web requests, and spawned local process trees.

There is no fixed productive-tool-turn ceiling. A task continues while it is
making progress. Desktop guards only against repeated identical tool/result
cycles and consecutive all-error cycles. When either guard fires, the model
receives one tool-free synthesis pass so the user gets the best supported
result, remaining uncertainty, and next step rather than a counter error.

While a task runs, the Operator composer remains available. New user direction
is queued and appended to the same transcript after the current assistant
response or complete tool-call batch has reached a protocol-safe boundary.
**Stop safely** remains a separate immediate abort control.

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

## Durable task boundary

Interactive, personally authenticated company tasks create an encrypted local
checkpoint before model work begins. The checkpoint stores the human objective,
attachment names, high-level completed tool names, bounded partial response,
and fingerprints of the current `resume_company` sections. It never stores tool
arguments, provider credentials, OAuth tokens, or authority to replay work.

A completed task removes its checkpoint. A crash or normal restart converts a
still-running checkpoint to **interrupted**. Cancellation and failures retain a
reviewable checkpoint.

Resume is deliberately a reauthorization sequence:

```text
user chooses Revalidate & resume
  -> fresh personal whoami
  -> exact subject + tenant pin check
  -> fresh resume_company section fingerprints
  -> fresh approval queue
  -> show drift and prepare no-replay continuation
  -> user reviews and explicitly presses Run
```

The continuation tells the model to inspect current authoritative sources,
receipts, and approvals, and never infer that a side effect completed merely
because the checkpoint mentions it.

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

The next layer is a provenance-preserving
[context compiler](CONTEXT_COMPILER.md): it assembles the smallest useful
working set from current authority, task state, relevant company and local
evidence, and progressively loaded capabilities while durable memory remains in
AMOS.

## Authentication

Desktop and interactive CLI users use OAuth authorization code + PKCE. The
client discovers AMOS authorization metadata, dynamically registers a public
client, opens browser login, and accepts the callback only on loopback.

API keys are reserved for CI and unattended agent identities. AMOS always
derives effective tenant and scope from the authenticated connection; a
model-supplied record or tenant identifier is never sufficient authority.

## Signed distribution

Release tags build macOS DMG and ZIP artifacts for Intel and Apple Silicon plus
a Windows x64 NSIS installer. GitHub Actions signs and notarizes the macOS
application, Authenticode-signs the Windows application and installer, generates
platform-specific update metadata and blockmaps, and publishes one checksum
manifest after both platform jobs pass.

Packaged applications check the signed feed after launch and periodically.
Downloads and restart/install remain explicit, and the app will not restart
during an active task.

## Local memory state

AMOS Desktop 0.5.0 implements the versioned memory contract and encrypted
private-memory store. The store contains encrypted envelopes rather than
plaintext filenames or content, maintains a bounded append-only sync journal,
and exposes explicit reuse, promotion, and forget controls.

AMOS Desktop 0.7 adds the first offline-intelligence slice: hardware-aware
recommendations, a catalog covered by the signed application release, Ollama
runtime discovery, resumable installation/removal controls, and an explicit
local-only tool registry. AMOS Desktop 0.8 adds portable private-memory
capsules. AMOS Desktop 0.9 adds an explicit, server-signed company briefing
that is encrypted locally and can be read only inside the reduced local-only
runtime. AMOS Desktop 0.10 adds encrypted outcome drafts whose signed-context
section fingerprints are compared with a fresh live briefing before the user
may load a reauthorization prompt into Operator. All local state preserves
these rules:

- shared AMOS data remains server-authoritative;
- private memory is not silently promoted;
- cached company data carries scope, provenance, and expiry;
- offline company actions remain proposals until reauthorized online; and
- imports, exports, and forks never include credentials.

Signed releases now carry the pinned Ollama runtime as the internal **AMOS
Local** sidecar. Desktop binds it to an AMOS-owned loopback port, disables
Ollama cloud features, supervises its lifecycle, and keeps model weights in
persistent per-user application data. The runtime is an implementation detail:
the renderer receives bounded status and model progress, never a process path
or authority to spawn arbitrary binaries.

See [CANVAS-OFFLINE-MEMORY-SPIKE.md](CANVAS-OFFLINE-MEMORY-SPIKE.md).

## Typed canvas boundary

AMOS Desktop 0.6.0 adds a session-only typed canvas. The model can propose one
of six bounded block types through `desktop_present_canvas`; Desktop validates
the complete specification and renders local components. The renderer never
accepts model-generated HTML or script.

Canvas source identifiers and freshness state remain visible. Pending approval
cards only open the existing signed-in AMOS decision flow. No new write or
approval authority is introduced, and no canvas company data is persisted
across application sessions in this phase.

## Offline runtime boundary

Online and local-only sessions are constructed as different runtimes:

```text
online company
  local workspace + optional web + AMOS MCP + typed canvas

local-only
  local workspace + private-memory attachments + typed canvas
  optional verified, unexpired, read-only company briefing
  optional encrypted outcome-draft staging; no queued tool calls
  no AMOS MCP tools
  no public-web tools
```

The offline boundary is enforced when the tool registry is created. The
local-only system prompt communicates the same boundary to the model, but the
prompt is not the security control. Switching modes clears the current runtime
so a previously created online registry cannot leak into an offline session.

The company briefing is not a second authorization system. AMOS signs the
exact tenant- and scope-bounded `resume_company` result with a distinct token
type and audience. Desktop verifies the current JWKS, user, tenant, issuer,
scope fingerprint, signature, and expiry before storing it. A reconnect
revalidates the saved grant against the live identity and current signing-key
set; a mismatch removes it. Logout removes it as well.

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
