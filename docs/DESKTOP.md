# AMOS Desktop

AMOS Desktop is the user-friendly distribution of the open-source AMOS Agent.
It is an operator console, not a replacement for the managed platform and not a
revival of the deprecated hosted harness.

## Alpha capabilities

- macOS desktop shell
- AMOS OAuth 2.1 + PKCE
- provider and infrastructure selection
- hardware-aware local-model guidance
- local workspace picker
- real AMOS Agent task loop
- live tool activity
- local shell and write approval modal
- direct link to the durable AMOS approval inbox
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

1. Stream model output and expose cancellation.
2. Enroll each desktop with an AMOS device key and sign local-action receipts.
3. Persist resumable task checkpoints through AMOS.
4. Add AWS profile/SigV4 support for Bedrock.
5. Add a curated local model installer for supported Mac hardware.
6. Add automatic signed updates.
7. Add MDM-friendly enterprise packages and policy-controlled local grants.
