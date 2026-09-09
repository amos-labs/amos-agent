# Preserve active task evidence during context compaction

AMOS Desktop 1.0.53 generated and saved a synthetic unpublished marketing page through its normal Auto / balanced hosted path. A subsequent design revision repeatedly called `sites_put_site_files` and `sites_site_status` instead of completing. Rick independently reported seeing this looping frequently.

## Reproduced defect

`contextCompiler.conversationTurns` treated the active user-message index as the end of the transcript. When compilation needed to reduce context, every later message was excluded before the normal budget/retention logic ran. This silently discarded successful writes, failed writes, current verification results, and user steering. The exact non-compacted path retained them.

The reduced reproduction preserves the instruction to edit a page but loses the successful save receipt. This is a proven mechanism consistent with the live symptom; it does not establish that every observed loop has this cause. The captured desktop activity did not expose the full model request needed to prove that each live iteration hit this branch.

The fix partitions the full transcript into turns, then applies the existing newest-first budget logic. Small recent tool-call/result pairs remain exact; oversized blocks retain bounded outcome summaries. The existing context budget, role ordering, trust handling, routing, and provider choices remain in force.

## Regression evidence

- Four compiler cases fail before the fix and pass after it: explicit active-task save, inferred latest-task save, steering plus verification after the active-task anchor, and a failed oversized write retaining the original revision and failure reason.
- An AgentLoop case with a 24,000-character generated page forces compaction. The next model input must contain the save receipt; execution must be exactly one save and one status read, followed by completion. It fails on the baseline and passes with the fix.
- Validation: 948/948 tests pass, plus `npm run check`, `npm run postcheck`, and `git diff --check`. The first full-suite attempt could not bind its loopback test server in the sandbox; it passed when rerun with that permission. Existing dependencies were reused after confirming the lockfiles differ only in the root package version.
- This is a deterministic software regression, not a measured improvement in model quality or a substitute for replaying the installed desktop after a release.

## Separate product gap

The default company-action workflow provides planning/verification instructions but has no required artifact-specific checker. The enforced `CodingLifecycle` is only created for paired coding workflows. This page used ordinary Auto routing with pairing disabled, so that lifecycle did not apply.

For substantive deliverables, extend the base hosted path with task planning, execution, and artifact review. Keep simple questions on the direct path. A landing-page review should inspect desktop/mobile rendering, brief and copy fidelity, links, the Platform lead-submission contract, and disclosed integration limits. Bind review evidence to the tenant, site, and saved manifest digest; any later edit invalidates that review. Use bounded repairs and report partial completion when a check cannot run. Do not turn a draft preview or a static form check into a claim of verified CRM delivery, attribution, or revenue tracking.

Platform owns the separately confirmed lead-form contract mismatch and a read-only validation tool. Its fix is not part of this context-retention patch.
