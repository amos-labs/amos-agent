# Safety

AMOS Desktop combines model reasoning, local execution, and governed company
tools. Those surfaces have different authorities and must remain visibly
separate.

The core rules are:

1. shared business authority stays in AMOS;
2. local access is explicitly granted and workspace-bounded;
3. local mutations ask first by default;
4. private material is not silently promoted into company memory; and
5. model choice never weakens identity, policy, approvals, or proof.

## Local workspace

- The user selects the workspace root.
- File operations resolve canonical paths and reject traversal.
- Symlinks cannot escape the workspace.
- Common credential files, private keys, SSH/cloud configuration, and environment
  files are unavailable to model file tools.
- Reads and command output are bounded.
- File writes and patches require approval by default.
- Shell commands require approval by default.
- The user may explicitly enable **Auto-approve local work** for one exact
  selected workspace. The grant is stored against that workspace path and
  automatically returns to ask-first mode when the path changes.
- From an individual local approval, the user may instead choose **Always
  allow** for that request class only: shell commands, file writes, or code
  patches. Those narrower grants are pinned and reset the same way.
- From the same inline ceremony, the user may choose **Allow for this task**.
  That ephemeral grant covers shell commands, file writes, and code patches
  only for the current Desktop task, exact workspace, operating boundary,
  identity, and tenant. Switching or clearing the task, changing the workspace,
  or changing the account boundary revokes it. It is never stored as standing
  workspace authority.
- Command timeouts terminate the full process group.
- User cancellation terminates the active process group and propagates to model,
  MCP, and web requests.

## Shell commands

Shell commands are the most powerful local surface, and they are **not
sandboxed**. This section states exactly which controls apply to `run_bash`
(`src/tools/bash.js`) and which do not, so nobody has to infer it.

What is enforced:

- **Approval gate.** Every command is shown to the user with its exact text,
  starting directory, and the model's stated reason, and waits for an explicit
  approval choice. Approval applies to that one command; it is not a blanket
  grant for later commands. The gate is skipped only when the user stored an
  auto-approve grant (all local work, or the shell request class, or the current
  task) or when `AMOS_AGENT_AUTO_APPROVE_BASH=true` is set.
- **Environment scrub.** The child process receives an allowlist of ordinary
  process variables (`PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR`, `LANG`, `TERM`,
  `LC_*`, and the Windows equivalents such as `SYSTEMROOT`, `APPDATA`, and
  `PROGRAMFILES`). Everything else in Desktop's own environment — AMOS
  credentials, provider keys, database URLs, cloud secrets, desktop OAuth
  tokens — is not passed through.
- **Starting directory.** The optional `workdir` is resolved inside the granted
  workspace and traversal outside it is rejected (unless
  `AMOS_AGENT_ALLOW_OUTSIDE_WORKSPACE=true`). This fixes only where the command
  *starts*.
- **Bounded output and lifetime.** stdout and stderr are capped at
  `AMOS_AGENT_MAX_OUTPUT_BYTES`; the command is killed with SIGTERM then SIGKILL
  at `AMOS_AGENT_BASH_TIMEOUT_MS`; the whole process group is terminated on
  timeout or user cancellation, and cancellation also aborts in-flight model,
  MCP, and web requests.

What is **not** enforced — an approved command runs with the local user's full
permissions:

- There is no container, macOS seatbelt, AppArmor/SELinux profile, seccomp
  filter, or any other OS isolation.
- The workspace boundary does not confine the command. `cd /`, absolute paths,
  and `..` all work; the command can read, modify, or delete anything the local
  user can, anywhere on the machine.
- The file-tool protections do not apply. The credential-file denylist that
  keeps `~/.ssh`, cloud configuration, and `.env` files away from `read_file`
  does nothing for `cat ~/.ssh/id_rsa` in a shell.
- There is no network policy. A command can reach any host, including private
  networks and cloud metadata endpoints that `web_fetch` blocks.
- The environment scrub is best-effort. On macOS and Linux the command runs
  through `bash -lc`, which sources the user's login profile; anything that
  profile exports (including secrets) is available to the command. On Windows
  PowerShell runs with `-NoProfile`.
- Detached children (`nohup`, `setsid`, `disown`) can outlive the timeout and
  cancellation, which only terminate the original process group.

The approval prompt is therefore the control. Before accepting an
**Auto-approve local work** or **Always allow shell** grant, Desktop explains
that file tools stay bounded to the workspace while shell commands do not.

### `AMOS_AGENT_AUTO_APPROVE_BASH`

Setting `AMOS_AGENT_AUTO_APPROVE_BASH=true` removes exactly one thing: the
per-command approval prompt. Nothing replaces it. The environment scrub,
starting directory, output cap, and timeout remain, and no isolation is added.
With it set, the model can run arbitrary commands as the local user with no
human in the loop — including outside the workspace, against credential files
the file tools refuse, and across the network. Use it only in a deliberately
isolated, disposable automation environment. It never grants company
authority: AMOS operations still pass through Platform identity, tenant scope,
RBAC, policy, approval, idempotency, execution, and proof.

The ask-first ceremony is non-blocking at the UI layer: it is shown inline in
the conversation and parks the requested tool call, while the task composer
continues accepting user direction. Typing does not authorize the parked action;
one of the explicit approval choices is still required.

## Company actions

AMOS tools use the authenticated tenant and identity from the connection.
Server-side AMOS resolves:

- tenant isolation;
- effective role and scopes;
- operation and actor policy;
- budgets and consequence level;
- human approval requirements;
- idempotency and execution; and
- proof receipt generation.

The local model or desktop cannot self-approve a consequential company action.

## Documents and screenshots

- Attachments stay task-local by default.
- The user must explicitly choose **Add to company memory**.
- PDF, DOCX, text, and source extraction happens locally before model use.
- Images are sent only to a vision-capable model.
- Unsupported binary content is not pushed through model output as base64.
- Company persistence remains subject to AMOS document and sharing policy.

Private, shared, group, and company document visibility is authoritative in the
managed platform, not inferred by the desktop.

## Web access

Public fetch blocks:

- loopback and private networks;
- link-local addresses;
- cloud metadata endpoints;
- credentialed URLs; and
- redirects to any blocked destination.

Native search is optional and uses its own configured provider credential.

The Desktop JavaScript browser adds a narrower local boundary:

- each browser session is ephemeral and bound to one operating mode, user,
  tenant, and task;
- every HTTP(S) request is checked against the public-network policy, while
  popups, unapproved downloads, permissions, unsupported schemes, and
  credential-like main-frame URLs are denied;
- page inspection executes in an isolated JavaScript world and returns opaque,
  page-revision-bound element references rather than raw selectors;
- form extraction returns structure, never entered values or password content;
- screenshots remain local opaque frames rendered by the typed canvas and are
  not serialized into model tool text; and
- closing or changing account/task/runtime revokes the page, references, and
  frame. Browser execution capabilities are never copied into a task fork.

Generated static applications use a separate Desktop-owned preview capability:

- `desktop_preview_app` serves only allowlisted static file types from the
  selected workspace on an ephemeral, non-privileged IPv4 loopback port;
- the exact origin is granted to the exact browser task scope and is revoked
  when that runtime, task, or preview closes;
- preview browser sessions cannot request public hosts, private-network hosts,
  or another loopback origin, and the preview server accepts only `GET` and
  `HEAD`;
- CSP and response policy disable forms, object/frame/media embedding, and
  network connections, while credential paths and workspace escapes remain
  blocked; and
- controls inside this inert preview do not require per-click approval because
  they cannot leave the exact read-only origin. Authentication-like fields
  remain unavailable to model control.

Semantic browser actions use current opaque references only. Safe navigation and
search-like input are observational. Buttons, form text, selects, checks, and
other consequential controls require a one-time approval bound to the exact
origin, page revision, material-page marker, target, and payload hash. Local
workspace auto-approval never applies. Any navigation or material page/target
drift cancels execution.

Authentication fields, password forms, MFA/recovery/token controls, payment
credentials, and sign-in submissions cannot be model-operated. The user may
take direct control of the same fixed-title isolated window; field values and
cookies remain inside that ephemeral session. Returning control refreshes a
value-free semantic snapshot.

Browser file transfer is a separate, fail-closed capability:

- uploads accept only an opaque ID for a current task attachment; AMOS
  revalidates its exact byte count and SHA-256 digest, stages a private immutable
  copy, and requires one-time approval bound to the page and file-input target;
- the main process uses a transient Chromium protocol attachment only to assign
  the approved staged file. No local path or debugging surface reaches the
  renderer or model;
- downloads run only through `browser_download`; a download produced by a
  generic click is canceled;
- approved downloads enter a private quarantine, stop above 20 MB, are hashed,
  and must pass the existing supported attachment/extraction pipeline before
  becoming task-visible; and
- writing a downloaded artifact outside AMOS requires the user to choose
  **Save copy…** and a destination in the native save dialog. Transfer storage
  is removed when its browser session is revoked.

Deterministic browser recipes add a separate local boundary:

- only successful verified semantic actions can enter the task-local recorder;
- saved recipes are encrypted and pinned to the exact operating boundary,
  identity, and tenant;
- recipes store origins, exact semantic contracts, named inputs, and bounded
  waits—never selectors, typed values, credentials, cookies, paths, file bytes,
  or approval authority;
- replay is a typed state machine that needs no LLM, asks again for each exact
  consequence, emits checkpoints/receipts, and stops on zero or multiple target
  matches; and
- runtime/task/account/company reset revokes recordings and live sessions.

Bounded visual fallback remains inside the isolated task browser:

- it is exposed only to provider profiles that advertise vision support;
- authentication routes and visible credential, MFA, recovery, payment, or
  secret fields are denied and route to direct user takeover;
- editable values are CSS-masked before capture;
- image bytes enter only a transient model evidence message and never public
  tool JSON, renderer events, receipts, continuity, or task persistence;
- click/type/key/scroll proposals bind to the exact page revision, frame ID,
  SHA-256, viewport, coordinates, observed target, and payload;
- every non-scroll action requires fresh exact approval and re-captures the
  pixels before input; and
- there is no clipboard access, OS desktop capture, unrelated-window access,
  or generic machine-wide input capability.

## Intelligence providers

The configured provider receives the conversation and task context needed for
inference. Users should understand that deployment choice affects where that
data is processed.

- AMOS-managed and customer-cloud profiles follow their deployment contract.
- Provider APIs process data in the provider's cloud.
- Local runtimes keep inference on the device but may be less capable.
- Credentials must not be placed in prompts or documents.

## Updates

Production updates come only from the configured signed release feed.

- Development builds do not query it.
- macOS applications are signed and notarized; Windows applications and NSIS
  installers are Authenticode-signed.
- Update metadata carries cryptographic hashes for architecture-specific ZIPs.
- Downloads require explicit user action.
- Restart/install requires explicit user action.
- Active work blocks restart.

## Restart-safe tasks

Signed-in company tasks are checkpointed with operating-system encryption.
Checkpoints contain the objective and bounded progress descriptions, but never
provider credentials, OAuth tokens, raw tool arguments, or automatic replay
authority.

After restart, cancellation, or failure, continuation requires:

- the same personal AMOS subject and tenant;
- a fresh company briefing and section-drift comparison;
- a fresh approval-queue read; and
- an explicit user action to load and then submit the continuation.

Existing receipts remain the source of truth for whether an action completed.
The resume prompt directs the model not to repeat an action unless current
evidence shows that it remains necessary.

## Offline and memory roadmap

Private Desktop memory is encrypted with Electron `safeStorage`—Keychain on
macOS and DPAPI on Windows—and
remains user-authoritative. Reusing it sends bounded content to the selected
model for that task but does not add it to company memory. Promotion uses the
ordinary AMOS company-document tool and therefore inherits the user's tenant,
scope, policy, and proof boundary. **Forget** removes the encrypted local item;
a previously promoted AMOS copy remains governed company memory.

Offline company work must fail safe:

- cached company context carries source, scope, age, and expiry;
- offline answers clearly disclose cached versus live context;
- offline company work is stored only as an outcome proposal, never a queued tool call;
- reconnect re-evaluates current identity, data, policy, and idempotency;
- nothing drafted offline executes silently; and
- memory exports never include credentials.

AMOS Desktop 0.7 enforces an explicit local-only tool surface. AMOS MCP and
public-web tools are not registered in that runtime, company-memory promotion
is blocked, and approval synchronization is paused. The UI continuously labels
the mode and the local model in use. This is stronger than relying on a prompt
to tell a model that the network is unavailable.

AMOS Desktop 0.9 may add one offline company-context tool only after the user
explicitly captures a valid server-signed briefing. The tool is read-only,
sectioned, provenance-first, and unavailable after expiry. The stored grant is
encrypted with operating-system protection, contains no credentials, and
cannot call, approve, or replay any AMOS operation. Reconnect revalidates it
against live identity and signing keys before continued use.

AMOS Desktop 0.10 adds encrypted offline outcome drafts. Reconnect checks the
user and tenant before fetching a fresh company briefing, compares section
fingerprints, and requires a current comparison plus an explicit user action to
load the draft into Operator. Loading does not submit it; the user must still
press **Run**, and current AMOS policy remains authoritative.

## Advanced environment controls

```bash
AMOS_AGENT_AUTO_APPROVE_BASH=true
AMOS_AGENT_AUTO_APPROVE_WRITES=true
AMOS_AGENT_ALLOW_OUTSIDE_WORKSPACE=true
AMOS_AGENT_BASH_TIMEOUT_MS=60000
AMOS_AGENT_MAX_OUTPUT_BYTES=24000
```

These controls are for deliberately isolated automation environments. They are
not recommended for normal interactive Desktop use. `AMOS_AGENT_AUTO_APPROVE_BASH`
only removes the approval prompt; see [Shell commands](#shell-commands) for what
still applies and what never did.

Productive work has no fixed cycle ceiling. Three progress safeguards remain
configurable for unusual deployments:

```bash
AMOS_AGENT_MAX_REPEATED_TOOL_CYCLES=5
AMOS_AGENT_MAX_REPEATED_TOOL_PATTERN_CYCLES=3
AMOS_AGENT_MAX_CONSECUTIVE_TOOL_ERROR_CYCLES=3
```

They count only repeated identical tool/result cycles, short repeating tool-plan
patterns, or cycles in which every tool fails—not normal productive work.

## Reporting a problem

Security vulnerabilities should be reported privately as described in
[SECURITY.md](../SECURITY.md). Do not include secrets, customer data, or live
tokens in a public issue.
