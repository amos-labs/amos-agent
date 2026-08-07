## Release

Prepare AMOS Desktop `0.17.12` from merged `main`.

This release includes the Desktop continuity and approval-routing improvements from #69:

- keep the active composer in `Steer AMOS` state during background renders
- restore a bounded, encrypted, identity- and workspace-pinned continuity package after relaunch
- route canvas approval actions into the live in-app Decisions/native approval flow

## Validation

- `npm run check`
- `npm test`: 211/212 in the sandbox; the only failure is the loopback OAuth listener blocked by sandbox `EPERM`
- `node --test test/demoAuth.test.js` outside the sandbox: 2/2 passed
- `git diff --check`

After merge, tag `v0.17.12` to trigger signed and notarized macOS publication through the protected release workflow.
