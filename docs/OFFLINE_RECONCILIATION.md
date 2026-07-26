# Offline draft reconciliation

AMOS Desktop 0.10 lets a local model prepare future company work without
turning offline reasoning into a queued command.

## What is saved

When a valid server-signed company briefing is available, local-only mode adds
`desktop_stage_offline_proposal`. The tool stores:

- a business-readable title, objective, and summary;
- up to ten proposed outcomes;
- assumptions that must be checked after reconnecting;
- the signed briefing's user, tenant, role, scope fingerprint, capture time,
  and expiry; and
- SHA-256 digests of the briefing sections used as the comparison baseline.

The complete draft store is protected by Electron `safeStorage`, written
atomically with owner-only permissions, and capped at 50 drafts. It contains no
OAuth token, provider key, credential, approval, opaque record ID requirement,
or replayable tool arguments.

## Reconnect flow

Offline drafts appear in **Decisions**. Returning online does not submit them.
For each draft, the user must:

1. connect through their personal AMOS sign-in;
2. choose **Compare with live company**;
3. pass an exact user and tenant match before Desktop reads live company state;
4. let Desktop obtain a fresh, read-only `resume_company` briefing;
5. review which signed briefing sections changed or disappeared; and
6. explicitly choose **Continue in Operator**.

The comparison is valid for ten minutes. It always records
`replay_allowed: false` and requires fresh evaluation even when no changed
section is detected.

**Continue in Operator** only fills the composer with an explicit
reauthorization prompt. It does not press Run. The prompt treats the draft as
untrusted, tells the online model to reread current authoritative sources,
forbids stale IDs and arguments, and requires current AMOS policy. The user
must review the prompt and press **Run** before any online evaluation begins.
Consequential work then follows the ordinary AMOS park, approval, and receipt
flow.

## Security invariants

- A model cannot choose the user or tenant attached to a draft.
- A different user or tenant cannot compare or continue the draft.
- Identity is checked before live company state is fetched.
- Offline work is an outcome proposal, never a stored tool invocation.
- Reconnect never silently replays, submits, approves, or executes work.
- Removing or clearing a signed briefing does not erase the encrypted draft;
  the original identity pin remains and must still match online.
- Logging out keeps private local drafts but removes the signed company
  briefing. Another account cannot continue those drafts.

See [Signed offline company context](OFFLINE_COMPANY_CONTEXT.md),
[Safety](SAFETY.md), and [Memory](MEMORY.md).
