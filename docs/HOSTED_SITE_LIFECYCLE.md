# Desktop hosted-page execution and review

Ordinary online page creation and editing now have a bounded completion path on the user's configured model. A saved file is evidence of a write, not proof of a working page, form or business outcome. Simple questions retain the ordinary answer path.

## Execution

Desktop supplies a short build/check plan for explicit hosted-page work and activates the lifecycle when a real site authoring tool is used. The plan asks for a clear audience/message, deliberate visual direction, useful CTA, truthful claims, mobile layout and the actual lead-form contract. Routine design choices do not introduce approval requests.

The controller retains successful file contents and hashes outside the compacted conversation for the current run. Existing files require prior authenticated source evidence; an observed newer manifest invalidates stale source. Different files can be written separately. Repeated attempts on the same path are bounded, with one additional repair after concrete checker feedback. The generic engine gateway and typed capability wrappers use the same rules. New user steering invalidates the prior review and resets the scoped repair allowance while retaining completed work.

At completion, Desktop reads the draft manifest, matches it to the saved source, checks forms through Platform's no-effect validator, and requests an independent source review with no tools. The reviewer uses the configured runtime, including manual tier selection, and reports its usage through the normal token/cost accounting. Source input is bounded; a review has a sixty-second deadline within the task's existing cancellation and budget limits. An unavailable reviewer or incomplete source is an unfinished check, never a pass.

When a known private preview and the task browser are available, Desktop also observes 1280×800 and 390×844 layouts. It checks DOM geometry, image load state, section links and form structure, restores the original viewport and displays its screenshot in the existing browser canvas. The operation reads no field values, follows no links, submits no forms, and preserves the browser's navigation, tenant/task, public-URL and user-control boundaries. These observations do not establish aesthetic quality or delivered CRM attribution.

The final status read must still match the reviewed manifest and form configuration. A changed revision invalidates review. One repair is allowed; unresolved checks then produce a usable partial result and retain the recovery checkpoint. Steering or cancellation arriving during a reviewer call invalidates its old verdict.

## Outcomes and presentation

`AgentLoop.run()` keeps its string return contract. `lastOutcome` and the `agent_outcome` event carry bounded `{status, reason, verified}` metadata. Guarded synthesis, exhausted repetition and empty-response recovery are interruptions. Controller supervision, receipts, immutable local episodes, history and the renderer receive the same terminal status. Successful tool calls alone no longer trigger the first-verified-outcome metric. Source review remains `verified:false`; it cannot stand in for full user-outcome verification or training consent.

Receipts retain their existing digest schema, encoding the outcome in a reserved metadata event. Legacy receipt/episode inputs keep their prior shape. Local episode export remains disabled under the existing consent rules.

The existing run-status area shows planning, building, checking, repair and partial/ready stages while preserving diagnostic activity. Failed Stop requests restore a usable control. Late cancellation responses cannot affect a newer task. Selected active-task snapshots restore their progress; changing conversations clears unrelated progress.

## Platform contracts and release dependency

- `site_status({slug})`: tenant-authorized `draft_manifest` with file hashes and `lead_form.submission_contract`.
- `get_site_file({slug,path,published:false})`: the matching draft file's `slug`, `path`, UTF-8 `content`, `sha256`, `size`, `mime`, and optional encoding/manifest selection. Desktop verifies the bytes itself. This additive producer contract must be deployed before existing-page edit acceptance is called ready.
- `validate_site_lead_form({slug,published:false})`: a no-effect report with `files[].path`, `files[].sha256`, `issues`, `ready`, manifest selection and the submission contract. A hashless report cannot attest to the reviewed revision. An explicitly unpublished draft is expected; Desktop never publishes a page to make intake readiness green. Platform PR879 repairs validator false-positive cases and adds this revision binding.
- Private preview links come from successful `put_site`. Missing links are not silently regenerated. Rotation invalidates previous links and must remain an explicit action. Shared continuity keeps redaction; Platform's formatting repair preserves Markdown independently.

Source checks, automated browser observations, a successful live form submission and connected ad-to-books attribution are separate evidence levels. The last two remain outside these automatic checks.

## Validation and release acceptance

Behavioral regressions cover tool-result retention (PR279), interruption status (PR280), same-batch write gates, current-source requirements, tenant/hash mismatches, changed revisions, unavailable/malformed validators, misleading validator text, reviewer token/cost accounting, repair bounds, steering during review, Stop races, restored progress and read-only browser inspection. The combined suite passed 1,050 tests before PR submission; CI must validate the final committed head.

Before releasing and claiming partner readiness, deploy the compatible Platform contracts and repeat creation, revision, reopen and restart in the installed Desktop. Inspect desktop/mobile rendering, test Auto and manual Frontier with actual served-model evidence, and keep actual CRM/email submission tests explicitly scoped. This document does not claim those live acceptance checks have already passed.
