# Parked follow-ups

These are not ship gates for the presentation artifact engine or the Desktop
continuity / provider-retry work.

## Qwen digest drift after PPTX and workspace-focus tools

The presentation toolkit / `desktop_create_presentation` prompt / slide-preview
canvas, and the `desktop_focus_workspace` tool plus inspect catalog, both change
the production tool-schema digest.

- Bound Qwen 3.8 digest (last measured contract):
  `sha256:75f90264b60fe40626caf69c71d4ed3e12f15759406716a1bfa2602905e456b9`
- Current production digest after PPTX:
  `sha256:dfe62bef8cf2582209fe0bb7ccab8d418e5adaf0e3315ff5a8727c28b5ca832e`

Do **not** bump `src/desktop/offlineIntelligence.js` `toolSchemaVersion` by
hand. That digest is a measured identity, not a string to keep tests green.

Qwen stays on the last measured contract. Deterministic Desktop work (PPTX
create/preview/open, workspace focus, the inspect catalog) does not inherit that
old qualification by implication. A digest mismatch is recorded here; it is not
a failing test.

When we come back:

1. Compare `currentProductionToolSchemaVersion()` to the bound digest above.
2. Decide whether a new local-model measurement is actually useful, or whether
   the bound digest should just be promoted after a smoke pass.
3. Only then update the bound digest, prompt version, and
   [local model qualification](LOCAL_MODEL_QUALIFICATION.md) notes from a new
   measured report.

## Models make mistakes; do not over-promise

Requalification-as-a-ship-gate is overkill for this product. AMOS is handling
local work well enough. In general we are not promising any model works. All
models will randomly make mistakes.

Parked: revisit the local-model qualification story so it stays honest evidence
for routing defaults, not a claim of reliability and not a blocker for
deterministic Desktop features.

## Token and turn efficiency

Recent long work spent a lot of prompt tokens on parent-folder inventory,
re-reading the same files, and broad searches after compaction.

Operating rules that would have been cheaper:

- Bind the worktree path in the first successful turn and reuse it.
- Prefer `node --test` on the known files over another repo-wide inspect.
- After a proven smoke, stop gathering.
- Keep follow-ups in this file instead of re-deriving them from chat.
- One Desktop grant should be the worktree, not the parent `ai_co` folder, when
  the work is a single PR.

Not a ship gate. Work after the PR lands.
