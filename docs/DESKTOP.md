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

Public release artifacts must be:

1. Signed with the AMOS Labs Developer ID Application certificate.
2. Built with hardened runtime.
3. Submitted to Apple's notarization service.
4. Stapled and validated before publication.

The repository includes the hardened-runtime entitlement file and
electron-builder packaging configuration. Signing identities and notary
credentials belong in CI secrets, never the repository.

## Next production slices

1. Stream model output and expose cancellation.
2. Enroll each desktop with an AMOS device key and sign local-action receipts.
3. Persist resumable task checkpoints through AMOS.
4. Add AWS profile/SigV4 support for Bedrock.
5. Add a curated local model installer for supported Mac hardware.
6. Add automatic signed updates.
7. Add MDM-friendly enterprise packages and policy-controlled local grants.
