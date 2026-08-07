## What changed

- preserve the active-task composer state so background renders and renderer refreshes keep `Steer AMOS` and the safe-stop controls active
- add an OS-encrypted, user/tenant/workspace-pinned session continuity package for recent milestones, receipt references, and safe local artifact/Git metadata
- restore bounded prior conversation context after relaunch while requiring fresh local and Platform validation before acting
- route canvas approval buttons and AMOS approval links through the live in-app Decisions/native approval flow
- document the rehydration boundary and add focused regression coverage

## Why

Background state refreshes could overwrite the active composer label with `Run with AMOS`. Relaunching Desktop also discarded useful completed-task context, forcing users to rediscover the selected project and recently edited artifacts. Canvas-generated approval links could open the hosted app even when native Desktop approval was already available.

## Security and governance

- continuity is encrypted with OS storage and scoped to the exact user, tenant, operating boundary, and workspace
- likely credentials and high-entropy secrets are redacted before persistence
- raw tool arguments, raw tool output, bearer tokens, pending execution authority, and replay instructions are not stored
- demo and machine-principal company sessions do not create company continuity records
- rehydrated context is explicitly untrusted and must be revalidated against current files, Platform data, receipts, policy, and approvals
- AMOS Platform remains authoritative for approval state and execution

## Validation

- `npm run check`
- `npm test`: 211/212 pass in the sandbox; the only sandbox failure is the loopback OAuth listener blocked with `EPERM`
- `node --test test/demoAuth.test.js` outside the sandbox: 2/2 pass
- focused continuity, controller, renderer, canvas, remote-projection, and agent-loop tests: 33/33 pass
- `git diff --check`
