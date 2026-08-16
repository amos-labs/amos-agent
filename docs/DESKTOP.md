# AMOS Desktop

AMOS Desktop is the native distribution of the open-source AMOS Agent. It gives
people a focused way to use their chosen intelligence with the governed AMOS
company brain and an explicitly granted local workspace.

The desktop application is the primary user experience. The CLI remains
available for developers, CI, and controlled automation.

## Install a release

Download the current signed installer:

- [Apple Silicon](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-arm64.dmg)
- [Intel Mac](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-x64.dmg)
- [Windows 10/11 x64](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-Windows-x64-Setup.exe)

On macOS, open the DMG and drag **AMOS Desktop** into **Applications**. Official
macOS releases are signed with the AMOS Labs Developer ID and notarized by
Apple. Windows releases are Authenticode-signed under the verified Richard
Barkley publisher identity. Run the per-user Windows installer; no administrator
account is required. Both platforms use the stable signed update channel.

## First run

Desktop guides the user through three independent grants:

1. **Connect the company** — browser-based AMOS OAuth identifies the user,
   company, role, and effective scopes.
2. **Use AMOS Intelligence** — automatic routing works immediately with the
   AMOS sign-in and existing credit/overage billing; AWS/customer cloud,
   provider API, compatible endpoint, and local runtime remain advanced options.
3. **Choose a workspace** — optional local folder that AMOS may inspect and
   change through visible approval gates.

After choosing a workspace, the sidebar offers **Auto-approve local work**.
Enabling it requires a native confirmation for the exact folder. It suppresses
repeated prompts for local writes, patches, and shell commands only; changing
the folder turns it off. It never auto-approves Platform company operations or
governed decisions.

Each local approval dialog also offers **Always allow this kind**. That narrower
choice can remember shell commands, file writes, or code patches independently
for the exact workspace while leaving the other local action types ask-first.

The recommended middle option is **Allow for this task**. It authorizes bounded
local commands, writes, and patches for the current task and exact workspace,
then expires when the user switches or clears the task or changes the operating
boundary. It does not authorize AMOS company operations, connected-application
writes, public-browser consequences, or future tasks. Persistent choices are
kept under a secondary disclosure instead of interrupting the primary flow.

Local approvals appear inline in the Operator conversation. The requested tool
action pauses until the user decides, but the composer remains active so the
user can keep typing and queue direction without a modal taking over the app.

The local workspace is not uploaded wholesale to AMOS. Each attachment is
task-local unless the user explicitly selects **Keep in private memory** or
**Add to company memory**.

## Current capabilities

### Company operation

- compact AMOS MCP bootstrap and on-demand engine loading;
- durable company context and connected application tools;
- tenant-scoped decisions and approval center links;
- native approval notifications;
- activity and plain-language proof visibility; and
- model-independent company operation.

### Universal input

- file picker and drag/drop;
- pasted screenshots;
- local PDF and DOCX extraction;
- text, Markdown, structured data, and source files;
- vision-capability checks before images reach a model; and
- per-item task-local, encrypted private-memory, or governed company-memory selection.

### Typed company canvas

Desktop can safely present bounded AMOS and local results as metrics, filterable
tables, time-series charts, Markdown briefs, source lists, and decision cards.
The model supplies a versioned data specification rather than HTML or script.
Every view carries source and freshness metadata, and pending decisions still
open the existing signed-in AMOS approval flow.

Canvas history is session-only in 0.6.0; Desktop does not silently persist a
second offline copy of company data. See [Typed company canvas](CANVAS.md).

### Document artifacts

Desktop can create polished DOCX and PDF files from one bounded, versioned
document specification. V2 includes named templates, customer brand tokens,
logos, headers and footers, raster figures, captions, alt text, and deterministic
bar and line charts. The selected model authors structure and content; local
code owns typography, pagination, file safety, and format generation. Before
any file is written, Desktop renders in memory, reopens the artifacts through
the normal attachment extractor, and verifies their title and signatures. A
single local file-write approval covers the explicit workspace-relative outputs.

After verification, the document opens automatically in the typed canvas beside
chat. Desktop shows inert thumbnails rendered from the final PDF pages,
deterministic layout diagnostics, hashes, and explicit **Open** and **Show in
folder** actions. Regenerating the same artifact refreshes that canvas in place.

Desktop can also create a separate reviewed DOCX from an existing workspace
DOCX using exact anchored replacements, true Word tracked insertions/deletions,
and true inline comments. Finalization accepts, rejects, or preserves changes
and removes or preserves comments without overwriting the source.

Document creation remains available in local-only mode and does not require a
hosted rendering service. See
[Deterministic document artifacts](DOCUMENT_ARTIFACT_ENGINE.md).

### Private memory

- encrypted locally with operating-system protection (Keychain on macOS and
  DPAPI on Windows);
- visible in a dedicated Desktop memory view;
- reusable in a future task without uploading it;
- promoted to company memory only through an explicit user action and the
  existing AMOS governed document path; and
- permanently removable with **Forget**.

Private memory does not create a local company ACL system. Shared, company, and
receipt memory remain authoritative in managed AMOS.

### Coding and local work

- explicit workspace grant;
- bounded file listing, reading, writing, and search;
- Git status and diff;
- validated atomic patches;
- approval-gated shell commands and local mutations;
- scrubbed child-process environment; and
- live tool activity.

For generated static web applications, `desktop_preview_app` runs a
Desktop-owned loopback preview, opens it directly in the governed browser
canvas, and returns semantic plus visual evidence to the model. The preview is
bound to the exact task and origin, serves only allowlisted workspace files,
and cannot call the public internet or other local services. This provides the
create → preview → inspect → iterate loop without an unmanaged background
server or a blanket private-network browser exception.

### Durable task lifecycle

- OpenAI-compatible output streams into the current Operator response;
- Live Work shows planning, action, evaluation, and completion phases;
- the composer remains active during work so the user can steer the same task
  at the next safe model/tool boundary;
- productive tool cycles do not stop at an arbitrary count; repeated
  no-progress or all-error cycles produce a final supported synthesis;
- **Stop safely** aborts the real model, MCP, web, and local-process work;
- signed-in company tasks receive an encrypted local checkpoint;
- unfinished running tasks become interrupted tasks after restart;
- resume rechecks the exact personal identity and tenant, a fresh
  `resume_company` briefing, and the current approval queue; and
- revalidation fills Operator with a no-replay continuation for explicit
  review—it never submits or repeats work by itself.

See [Streaming, cancellation, and restart-safe tasks](TASK_LIFECYCLE.md).

### Intelligence choices

- AMOS-hosted inference;
- Amazon Bedrock;
- customer-controlled OpenAI-compatible endpoints;
- provider APIs, including Moonshot/Kimi and xAI/Grok;
- an optional planner / builder / checker pair that can switch mid-task;
- estimated token and dollar usage on the local task receipt; and
- Ollama or llama.cpp local runtimes.

Desktop can also spawn isolated child tasks on Git worktrees and accepts
commands from the VS Code companion over a loopback token. The companion never
grants company authority. Local Qwen remains the on-device draft layer; the
AMOS Local catalog's move from Qwen 3.6 to 3.8 is independent of these
provider and pairing changes.

### Appearance

- follows the current operating-system light or dark appearance by default;
- switches immediately from the header control;
- supports persistent Light and Dark overrides; and
- keeps the system-following choice available under **Intelligence**.

### Distribution

- Apple Silicon and Intel macOS applications plus Windows 10/11 x64;
- hardened macOS runtime, Apple signing/notarization, and Windows Authenticode signing;
- signed update checks after launch and every six hours;
- native update-available and ready-to-install notifications;
- explicit download and restart/install; and
- no restart while a task is active.

## Update behavior

Packaged applications read the release feed generated alongside each signed
GitHub release. Development builds never contact the production feed.

Update states are:

1. check in the background;
2. notify when a newer signed version exists;
3. wait for **Download**;
4. show progress;
5. wait for **Restart and install**; and
6. refuse restart while AMOS is working.

The macOS menu-bar or Windows system-tray item also exposes update status and a
manual check.

## Run from source

```bash
npm install
npm test
npm run desktop
```

Settings and encrypted provider secrets are stored under Electron's per-user
application-data directory. Use a separate user-data directory when testing
authentication or first-run behavior.

## Build locally

```bash
npm run desktop:dir
npm run desktop:build
npm run desktop:dir:win
npm run desktop:build:win
```

- `desktop:dir` creates an unpacked macOS application.
- `desktop:build` creates unsigned local macOS DMG and ZIP artifacts.
- `desktop:dir:win` creates an unpacked Windows x64 application.
- `desktop:build:win` creates an unsigned local Windows x64 NSIS installer.
- `desktop:release` and `desktop:release:win` create the signed release layouts
  used by CI.

Local builds are intentionally unsigned and cannot validate the production
auto-update chain.

The Windows release packages Ollama's CPU and Vulkan backends with the local
router and omits the two vendor CUDA-version directories. Vulkan remains the
portable GPU path on supported Windows hardware, while CPU fallback keeps the
router and local models functional. CI rejects a Windows installer larger than
1.1 GB so an accidental return to the multi-CUDA payload cannot silently reach
the stable channel.

## Legacy unsigned Windows preview

The production Windows signing identity is configured. The manual `Publish
unsigned Windows preview` GitHub Actions workflow remains only for isolated
signing-infrastructure diagnostics. It publishes a GitHub prerelease containing:

- `AMOS-Desktop-Windows-Unsigned-Preview-x64-Setup.exe`; and
- a dedicated SHA-256 checksum file.

Never direct production users to this build. The preview uses the separate
`com.amoslabs.desktop.preview` application ID,
installs as **AMOS Desktop Preview**, and disables automatic updates. Windows
will report an unknown publisher and may show a SmartScreen warning. It is only
for direct testing and must not be represented as an official or managed
enterprise release.

The preview workflow does not read Windows signing secrets and does not relax
the fail-closed production release configuration.

## Official release process

Pushing a tag matching `package.json`, such as `v0.12.0`, starts
`.github/workflows/release-desktop.yml`.

The protected release environment must also define
`AMOS_ROUTER_GGUF_URL` as an HTTPS URL for the version pinned by
`src/model/intelligence-router-artifact-v1.json`. The release builder streams
that artifact with a 20-minute bound, rejects any byte beyond the signed size,
and verifies the exact SHA-256 before packaging. Local release development may
instead set `AMOS_ROUTER_GGUF_SOURCE` to the qualified GGUF path.

The workflow:

1. runs tests and syntax checks;
2. verifies the tag and signing/notarization configuration;
3. builds, signs, and notarizes Apple Silicon and Intel applications;
4. verifies that the protected Windows signing identity is configured;
5. builds and Authenticode-signs the Windows x64 NSIS
   installer on a native runner;
6. verifies the Windows signature and publisher identity;
7. publishes the verified macOS applications only after both platform builds
   pass, then attaches the Windows installer, blockmap, and
   `latest.yml` to the same release; and
8. extends the release SHA-256 manifest with the Windows artifacts.

Official releases fail closed when Windows signing credentials are absent or a
Windows build or signature check fails. They never produce an unsigned artifact
under the official application identity; unsigned Windows testing remains
isolated in the legacy preview workflow.

Release secrets live in the protected `MAC_CSC_LINK` GitHub environment:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Windows releases use Microsoft Artifact Signing. The private signing key stays
in Microsoft's managed service instead of being exported to GitHub. The
protected `WINDOWS_SIGNING` environment contains these secrets for a narrowly
scoped Entra service principal:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

The same environment defines these non-secret variables from the Artifact
Signing account and public-trust certificate profile:

- `WINDOWS_SIGNING_ENDPOINT`
- `WINDOWS_SIGNING_ACCOUNT_NAME`
- `WINDOWS_SIGNING_CERTIFICATE_PROFILE_NAME`
- `WINDOWS_SIGNING_PUBLISHER_NAME`

The service principal must have only the **Artifact Signing Certificate Profile
Signer** role scoped to the release certificate profile. The release build is
fail-closed: the config rejects missing managed-signing values and
`forceCodeSigning` prevents an official Windows job from producing an unsigned
installer.

After changing the account, certificate profile, identity, or environment
configuration, run the manual `Qualify managed Windows signing` workflow. It
builds the real stable installer, verifies its Authenticode status and exact
publisher subject, and uploads short-lived evidence without publishing a
release.

No signing or notarization secret belongs in the repository.

## Troubleshooting

### The app cannot connect to AMOS

- Confirm the system browser completed login.
- Confirm the AMOS endpoint is HTTPS.
- Disconnect and reconnect to restart discovery and PKCE.
- Review [Authentication](AUTHENTICATION.md).

### A local model is selected but tasks fail

- Confirm its compatible endpoint is running.
- Confirm the configured model supports the required context and tool calls.
- Use a managed or customer-cloud profile for work beyond the device's
  capabilities.

### Set up curated offline intelligence

1. Open **Intelligence**.
2. Confirm **AMOS Local** reports that its included runtime is ready.
3. Review the hardware-aware recommendation and install a curated model.
4. Select **Use with AMOS** to keep live governed company tools, or **Use
   offline** to remove company and public-network tools from the session.
5. Confirm the top bar shows the intended operating boundary before starting.

Desktop starts and stops the loopback-only runtime itself; no separate Ollama
installation, login item, or updater is required. Downloads are resumable,
installed models persist outside the application bundle and can be removed
from the same screen, and the runtime plus catalog are pinned by the signed
AMOS Desktop release. AMOS Local disables Ollama cloud features.
Local-only mode exposes local workspace, private-memory attachment, and typed
canvas tools. AMOS MCP, public web, company-memory promotion, live approvals,
and proof are unavailable until the user explicitly returns online.

### Make a company briefing available offline

1. Connect AMOS with your personal browser sign-in.
2. Open **Memory** while the top bar reads **ONLINE COMPANY**.
3. Select **Make available offline** and confirm the first local copy.
4. Confirm the card shows the company, captured time, expiry, role, and scope
   count.
5. Activate a downloaded local model from **Intelligence**.

The default grant lasts four hours. It is a server-signed copy of the exact
bounded company briefing the user could read at capture time, encrypted with
operating-system protection. In local-only mode the model receives one
sectioned read tool and no AMOS action, approval, web, or company-memory write
tools. Expired context is suppressed. Returning online revalidates the grant
against the live user, tenant, and AMOS signing keys; logout removes it.

See [Signed offline company context](OFFLINE_COMPANY_CONTEXT.md).

### Continue work drafted offline

1. While in local-only mode, ask AMOS to prepare future company work. With a
   valid signed briefing, the local model can stage an encrypted outcome draft.
2. Return to **ONLINE COMPANY** and open **Decisions**.
3. Select **Compare with live company**. Desktop checks the exact user and
   tenant before reading a fresh company briefing.
4. Review the changed sections. Comparisons expire after ten minutes.
5. Select **Continue in Operator**. Desktop fills the composer but does not run
   the task.
6. Review the prompt and press **Run** to explicitly request current online
   evaluation.

No offline tool call is stored or replayed. Current AMOS policy, approvals, and
proof govern any resulting action. See
[Offline draft reconciliation](OFFLINE_RECONCILIATION.md).

### No update appears

- Update checks run only in a packaged signed build.
- GitHub releases must be published, not draft.
- macOS releases must contain `latest-mac.yml` and the correct architecture ZIP.
- Windows releases must contain `latest.yml`, the x64 NSIS installer, and its
  blockmap.
- The installed version must be lower than the release version.

### AMOS cannot read a file

- The path must be inside the selected workspace.
- Symlink escapes and common credential files are intentionally blocked.
- Unsupported binary formats should be connected through AMOS or converted
  before attachment.

## Product roadmap

The next product layers build on the signed distribution foundation:

1. signed device identity and policy-controlled environment grants;
2. presentation artifacts beside the completed typed DOCX/PDF and XLSX engines;
3. Platform promotion and scheduling for stable deterministic browser recipes;
4. richer typed canvas blocks and managed AMOS result adapters;
5. richer private-memory retrieval and sharing proposals;
6. richer retrieval within the bounded signed company briefing;
7. richer offline-draft conflict explanations and lifecycle controls;
8. enterprise/MDM packaging; and
9. Windows on Arm and managed-store distribution.

See [Canvas, offline intelligence, and portable memory](CANVAS-OFFLINE-MEMORY-SPIKE.md).
