# AMOS Desktop

AMOS Desktop is the user-friendly distribution of the open-source AMOS Agent.
It is an operator console, not a replacement for the managed platform and not a
revival of the deprecated hosted harness.

## Alpha capabilities

- macOS desktop shell
- AMOS OAuth 2.1 + PKCE
- signed-in user, company, role, and effective-scope identity
- provider and infrastructure selection
- hardware-aware local-model guidance
- local workspace picker
- document and source-file upload with local PDF/DOCX/text extraction
- drag-and-drop attachments and pasted screenshots
- explicit per-attachment choice between task-local use and governed company memory
- vision-capability enforcement before an image reaches a model
- repository search, git inspection, and approval-gated atomic patches
- real AMOS Agent task loop
- live tool activity
- local shell and write approval modal
- direct link to the durable AMOS approval inbox
- tenant-scoped decision inbox with 30-second background refresh
- native approval notifications and a persistent menu-bar/system-tray surface
- one-click, session-authenticated approval review (the AI remains unable to approve itself)
- signed update checks on launch and every six hours
- native update-available notifications with explicit download and restart/install controls
- local session activity
- provider secrets encrypted with operating-system-backed `safeStorage`

## Run locally

```bash
npm install
npm run desktop
```

The desktop settings file is stored under Electron's per-user application data
directory. Provider secrets are encrypted before being written. AMOS OAuth
credentials remain owner-only and isolated inside the same application data
directory.

## Package

```bash
npm run desktop:dir
npm run desktop:build
```

`desktop:dir` creates an unpacked application for local testing.
`desktop:build` creates macOS DMG and ZIP artifacts for Apple Silicon and Intel.

Pushing a version tag such as `v0.2.1` runs
`.github/workflows/release-desktop.yml`. The workflow verifies the package
version, signs and notarizes both architectures, verifies that every required
installer exists, and then publishes all release assets in one explicit GitHub
release:

- `AMOS-Desktop-macOS-arm64.dmg` — Apple Silicon
- `AMOS-Desktop-macOS-x64.dmg` — Intel
- matching ZIP archives for update infrastructure
- `latest-mac.yml` and blockmaps used by the signed in-app updater

The app never installs an update in the middle of a task. It announces a signed
release, waits for the user to download it, and exposes **Restart and install**
only after the download completes. Development builds do not contact the
production update feed.

The permanent dashboard download URLs are:

```text
https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-arm64.dmg
https://github.com/amos-labs/amos-agent/releases/latest/download/AMOS-Desktop-macOS-x64.dmg
```

The release job targets the `MAC_CSC_LINK` GitHub environment and fails closed
unless the following environment secrets exist:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

These supply the AMOS Labs Developer ID Application certificate and Apple
notarization credentials. The repository includes hardened-runtime entitlements
and a release-only electron-builder configuration; secrets never belong in the
repository. Keep local development builds unsigned with `desktop:dir` or
`desktop:build`.

## Next production slices

1. Stream model and terminal output and expose cancellation.
2. Add durable, resumable plans and task checkpoints shared with AMOS.
3. Enroll each desktop with an AMOS device key and sign local-action receipts.
4. Add explicit, policy-controlled environment grants for repositories, folders,
   local applications, and private-network connectors.
5. Add local project memory with explicit promotion, refresh, and forgetting rules.
6. Add AWS profile/SigV4 support for Bedrock.
7. Add a curated local model installer for supported Mac hardware.
8. Ship signed Windows installers and MDM-friendly enterprise packages.
