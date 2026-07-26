# AMOS Desktop

AMOS Desktop is the native distribution of the open-source AMOS Agent. It gives
people a focused way to use their chosen intelligence with the governed AMOS
company brain and an explicitly granted local workspace.

The desktop application is the primary user experience. The CLI remains
available for developers, CI, and controlled automation.

## Install a release

Download the current signed macOS installer:

- [Apple Silicon](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-arm64.dmg)
- [Intel](https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-x64.dmg)

Open the DMG and drag **AMOS Desktop** into **Applications**. Official releases
are signed with the AMOS Labs Developer ID and notarized by Apple.

## First run

Desktop guides the user through three independent grants:

1. **Connect the company** — browser-based AMOS OAuth identifies the user,
   company, role, and effective scopes.
2. **Choose intelligence** — AMOS-hosted, AWS/customer cloud, provider API,
   compatible endpoint, or a supported local runtime.
3. **Choose a workspace** — optional local folder that AMOS may inspect and
   change through visible approval gates.

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

### Private memory

- encrypted locally with macOS Keychain protection;
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

### Intelligence choices

- AMOS-hosted inference;
- Amazon Bedrock;
- customer-controlled OpenAI-compatible endpoints;
- provider APIs, including Moonshot/Kimi; and
- Ollama or llama.cpp local runtimes.

### Distribution

- Apple Silicon and Intel macOS applications;
- hardened runtime, signing, and notarization;
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

The menu-bar item also exposes update status and a manual check.

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
```

- `desktop:dir` creates an unpacked application.
- `desktop:build` creates unsigned local macOS DMG and ZIP artifacts.
- `desktop:release` creates the release-layout artifacts used by CI.

Local builds are intentionally unsigned and cannot validate the production
auto-update chain.

## Official release process

Pushing a tag matching `package.json`, such as `v0.4.0`, starts
`.github/workflows/release-desktop.yml`.

The workflow:

1. runs tests and syntax checks;
2. verifies the tag and signing/notarization configuration;
3. builds Apple Silicon and Intel applications;
4. signs and notarizes both architectures;
5. produces DMG installers and ZIP update payloads;
6. generates blockmaps and an architecture-aware `latest-mac.yml`;
7. validates that both architectures are present;
8. writes SHA-256 checksums; and
9. publishes one non-draft GitHub release.

Release secrets live in the protected `MAC_CSC_LINK` GitHub environment:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

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
2. Install and launch Ollama if the local runtime is not ready.
3. Review the hardware-aware recommendation and download a curated model.
4. Select **Use offline** on an installed model.
5. Confirm the top bar reads **LOCAL-ONLY** before working without live company
   access.

Downloads are resumable through Ollama, installed models can be removed from
the same screen, and the catalog is part of the signed AMOS Desktop release.
Local-only mode exposes local workspace, private-memory attachment, and typed
canvas tools. AMOS MCP, public web, company-memory promotion, live approvals,
and proof are unavailable until the user explicitly returns online.

### No update appears

- Update checks run only in a packaged signed build.
- GitHub releases must be published, not draft.
- The release must contain `latest-mac.yml` plus the correct architecture ZIP.
- The installed version must be lower than the release version.

### AMOS cannot read a file

- The path must be inside the selected workspace.
- Symlink escapes and common credential files are intentionally blocked.
- Unsupported binary formats should be connected through AMOS or converted
  before attachment.

## Product roadmap

The next product layers build on the signed distribution foundation:

1. streaming output, cancellation, and durable resumable tasks;
2. signed device identity and policy-controlled environment grants;
3. richer typed canvas blocks and managed AMOS result adapters;
4. richer private-memory retrieval, sharing proposals, and capsule export;
5. deeper offline retrieval against a server-authorized company cache;
6. portable encrypted memory capsules and reconnect reconciliation; and
7. Windows installers and enterprise/MDM packaging.

See [Canvas, offline intelligence, and portable memory](CANVAS-OFFLINE-MEMORY-SPIKE.md).
