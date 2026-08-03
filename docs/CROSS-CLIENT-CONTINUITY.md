# Cross-client working continuity

AMOS continuity is automatic in the normal path and quiet in the interface.
The user should be able to finish work in Desktop and resume through another
AMOS-compatible client without learning a memory-management system.

## Contract

- Desktop writes a bounded checkpoint after a completed, personally signed-in
  online company task.
- AMOS Platform stores the latest lanes by authenticated user, tenant, and
  context key. The default lane is `active`.
- A new Desktop runtime compares the shared and encrypted local manifests and
  restores the newer matching state.
- `resume_company` includes the latest lane. Clients that need only working
  state can load the company engine and call `hydrate_context`.
- Claude, Codex, or another MCP client can call `capture_context` before an
  intentional client change or at a natural completed-work boundary.
- When the user clears a session, Desktop calls `clear_context` for the exact
  authenticated user, tenant, and `active` lane before removing the encrypted
  local package. API keys and other machine principals cannot capture, hydrate,
  clear, or receive user-private continuity through `resume_company`.

The checkpoint contains objective, outcome, typed action status, decisions,
commitments, corrections, open loops, safe artifact references, receipt
references, source client, and model handoffs. It does not contain raw chat,
tool arguments, source contents, credentials, current permissions, or replay
authority. Server limits reject transcript-sized captures and evict older
transitions before the manifest can grow beyond its storage budget.

## Boundaries

Continuity is not company memory. Every field is client-reported, so a resumed
model must re-read identity, policy, approvals, receipts, and authoritative
company sources before relying or acting. A checkpoint cannot prove an action
ran and cannot authorize it to run again.

Tenant switching is an advanced Desktop setting. The OAuth token is rotated to
the selected advertised membership, and Desktop clears runtime context,
attachments, canvases, approvals, connection metadata, activity, and the prior
tenant's shared checkpoint before refreshing the target company.

Clearing a continuity lane does not clear company memory, receipts, approvals,
another teammate's lane, or any named lane that the user did not select.

AMOS cannot recover private state from a third-party client that never calls
`capture_context`. Clients without AMOS MCP need a separate explicit export or
handoff; their vendor-controlled transcript is outside AMOS's reach.

## Next frontier: physical and digital continuity

The same state contract can eventually connect digital agents with embodied
systems. A physical handoff needs stricter fields than a software-only one:
timestamped sensor evidence, observed location, device capability, uncertainty,
safety-interlock state, and short-lived action authority. Physical commands must
never be inferred from a continuity checkpoint or replayed from history; the
robot must re-observe its environment and pass its current safety policy before
acting. This is a future architecture direction, not part of the version-1
Desktop continuity protocol.
