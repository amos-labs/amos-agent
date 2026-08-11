# Governed browser and computer use

## Product objective

AMOS Desktop should be able to research public websites, operate authorized web
applications, and fall back to visual computer control without forcing a user
to switch to another AI harness. Browser execution is a local operating
capability, not a new source of company authority and not a substitute for a
durable platform connector.

The preference order is:

1. **Platform connector or MCP capability** for stable company systems,
   normalized data, durable credentials, policy, and receipts.
2. **Deterministic browser automation** for web workflows that expose usable
   DOM/accessibility semantics but no practical API.
3. **Visual computer use** for canvas, remote desktop, legacy, or otherwise
   non-semantic interfaces.

The model decides what workflow is needed and may help author it. A bounded
runtime performs the repeatable navigation, extraction, and interaction. A
consequential browser action remains subject to the same policy and human
decision boundary as the equivalent API action.

## Current foundation

Desktop exposes two request-level public-web primitives outside local-only mode:

- `web_fetch` retrieves a bounded public HTTP/HTTPS response, blocks private
  network targets and credential-bearing URLs, follows bounded redirects, and
  reduces HTML to compact text; and
- `web_search` uses a configured search provider and returns bounded result
  metadata.

For JavaScript-rendered and authenticated pages, Desktop now also exposes the
governed local browser stack:

- `browser_open` creates or navigates a task-, tenant-, and user-bound ephemeral
  Chromium session;
- `browser_snapshot` returns bounded text plus opaque semantic element
  references tied to the current page revision;
- `browser_extract` deterministically extracts article text, tables, lists,
  form structure without values, or one referenced region;
- `browser_click`, `browser_type`, `browser_select`, and `browser_check` operate
  only current opaque references and pause at the exact consequence boundary;
- `browser_wait` performs bounded selector-free waits and returns a fresh
  semantic observation;
- `browser_upload` assigns one exact current task attachment to a current file
  input after one-time approval without exposing its source path;
- `browser_download` activates one exact approved control, quarantines and
  hashes the result, and admits only a supported attachment of at most 20 MB;
- `browser_screenshot` refreshes an opaque local PNG frame rendered in the
  dynamic canvas; and
- `browser_close` destroys the page and revokes its references and frame.
- `browser_recipe_save`, `browser_recipe_list`, `browser_recipe_run`, and
  `browser_recipe_remove` compile and replay encrypted typed semantic recipes;
  and
- `browser_visual_observe` and `browser_visual_act` provide a masked,
  frame-hash-bound vision fallback inside that same isolated browser.

The same task-local session can be shown in a fixed-title **AMOS Secure Browser**
for direct user control. The user enters passwords and MFA there; AMOS receives
neither field values nor cookies. Returning control hides the window and
refreshes the semantic observation.

## Browser runtime

A pinned Chromium runtime runs behind the Desktop main-process boundary using
the Chromium already shipped with Electron. The privileged renderer never
receives raw cookies, passwords, OAuth tokens, browser debugging ports, raw DOM
selectors, or unrestricted automation handles.

The typed primitive set is:

- `browser_open` — create or navigate an isolated task-bound page;
- `browser_snapshot` — return a bounded accessibility/DOM snapshot with stable
  element references and current origin;
- `browser_extract` — deterministically extract a table, list, article, form,
  or user-selected region;
- `browser_click`, `browser_type`, `browser_select`, and `browser_check` —
  interact only with a current validated element reference;
- `browser_wait` — wait for a bounded settled, URL-text, or visible-text
  condition;
- `browser_screenshot` — capture a bounded visual observation for the active
  task and dynamic canvas;
- `browser_download` — route a completed file through the normal attachment,
  hashing, size, and workspace-approval path;
- `browser_upload` — select an already approved local artifact without exposing
  arbitrary filesystem paths; and
- `browser_close` — destroy the task session and revoke its handles.
- `browser_recipe_*` — save, list, deterministically run, and remove encrypted
  identity-pinned semantic workflows; and
- `browser_visual_observe` / `browser_visual_act` — transiently show a masked
  browser frame to a qualified vision model and execute one frame-bound input.

The implemented semantic and file-transfer subset enforces short-lived element references tied to
the page revision, task, account, and tenant. Navigation invalidates prior
references. Consequential actions also bind to a material-page marker, exact
target descriptor, origin, payload hash, and fresh local screenshot. Drift
while approval waits cancels execution. Free-form model text cannot mint a
browser handle, selector, frame, approval, filesystem path, or privileged
action.

Uploads begin with a current task attachment ID. Desktop re-reads retained or
source bytes, verifies exact size and SHA-256, then stages a mode-0600 immutable
copy inside the browser session's private transfer directory. The Electron main
process transiently attaches Chromium's DOM protocol only long enough to assign
that copy to the approved file input and verify the selected filename and byte
count. Neither the renderer nor the model receives the original path, staged
path, or protocol handle.

Downloads never ride through generic `browser_click`: surprise downloads are
canceled and the model must use `browser_download` against a fresh opaque
reference. An approved result is quarantined, capped at 20 MB both before and
during receipt, hashed, removed from quarantine, and passed through the existing
supported attachment extractor. It remains a task attachment in the composer.
The dynamic canvas shows its name, size, and digest; **Save copy…** is a separate
native user ceremony that chooses the only external destination.

## Website data ingestion

Loading website data is not one undifferentiated feature:

- Static public content stays on `web_fetch` because it is cheap, deterministic,
  and easy to bound.
- JavaScript-rendered public content uses `browser_snapshot` plus
  `browser_extract`.
- Authenticated company data should normally become a governed connector or MCP
  result. Browser extraction is appropriate for a bounded workflow or bootstrap,
  not an invisible long-term system of record.
- Data selected for company memory is submitted through an explicit ingestion
  proposal with source URL, capture time, content hash, tenant, and freshness.
  Merely viewing a page never promotes it to company truth.

Successful browser work can compile into an encrypted deterministic automation
recipe with declared origins, exact semantic element contracts, named runtime
inputs, bounded waits, zero implicit retries, checkpoints, and receipts. The
recipe continues without a model while the declared page contract holds. It
stores no CSS/XPath selectors, typed values, credentials, cookies, attachment
paths, file bytes, or replay authority. DOM/ARIA drift produces a bounded
failure and opens an AI-assisted repair task; it never silently changes the
target or submits a different form.

Local recipes run on demand in the current Desktop identity and task boundary.
Unattended schedules belong to a governed Platform automation or connector,
where durable credentials, policy, device availability, retries, and proof can
be operated explicitly rather than hidden in a laptop cron job.

## Authentication and session isolation

- Browser profiles are isolated by exact AMOS user, tenant, task, and declared
  environment grant.
- Authentication happens through user-visible browser or operating-system
  ceremonies. The model cannot ask for, read, type, or retrieve a password,
  MFA code, recovery code, bearer token, or cookie.
- Where the Platform already brokers OAuth, Desktop uses the governed connector
  instead of copying that session into Chromium.
- Local authentication state stays in the ephemeral Electron session for that
  exact task and is destroyed on close, task/account/company switch, or runtime
  reset. It is never copied into AMOS, another task, or the system browser.
- Cross-account task switching closes or detaches the old session before any
  new page becomes available.
- Private-network and localhost access remain denied unless an explicit
  environment grant names the origin and capability.

## Consequence policy

Read-only navigation and extraction may proceed inside an approved origin and
task grant. The following actions are consequential and require an explicit
typed decision unless a narrower platform policy already authorizes them:

- submitting or changing business data;
- sending messages, comments, applications, or forms;
- purchases, payments, bookings, bids, or contractual acceptance;
- uploading a file or disclosing company/private information;
- deleting, publishing, deploying, granting access, or changing permissions;
- entering an authentication or recovery ceremony; and
- navigating to a new unapproved origin as part of an authenticated workflow.

The decision view shows the origin, action, human-readable field changes,
destination, files, and a fresh screenshot. Approval binds to that exact page
revision and action payload; any navigation or material DOM change invalidates
it.

## Computer-use fallback

Visual browser use observes screenshots and proposes pointer/keyboard actions
when semantic browser references cannot express the target. It is deliberately
narrower and higher-friction than semantic automation:

- each observation and action is tied to the current window, screen geometry,
  application identity, and frame hash;
- authentication routes and visible credential/payment/recovery fields are
  unavailable, while every editable value is visually masked;
- the model receives only a transient PNG evidence message—not image bytes in
  tool JSON, activity, receipts, continuity, or renderer state;
- clipboard access is absent and typed text is bounded to the exact approved
  payload;
- destructive or external actions always pause at the consequence boundary;
- a changed frame invalidates stale coordinates; and
- the system records bounded screenshots and action receipts without retaining
  hidden credentials or unrelated screen content.

Only a provider profile advertising vision receives the visual tools. Local
models can still handle deterministic snapshots and recipes. The browser
runtime remains useful when vision is offline: saved deterministic recipes
continue, while unrecognized visual states stop safely.

This slice does not expose the operating-system desktop, other applications,
notifications, the system clipboard, or unrestricted keyboard/mouse control.
General cross-application computer use requires a separate named-app grant,
operating-system accessibility/screen-recording ceremony, secure-surface
masking, and qualification before it can become an AMOS capability.

## Desktop experience

Browser work appears as a task-bound dynamic-canvas sidecar beside Operator:

- current origin and session boundary;
- live or captured page preview;
- concise progress and extraction results;
- pending-action review; and
- an obvious **Take over** control that pauses AMOS and gives the user direct
  interaction without losing the task.

Browser sessions, extracted artifacts, automation recipes, and receipts belong
to the durable task. Forking carries only declared references and screenshots;
it never copies cookies, authentication state, pending submissions, or browser
execution authority.

## Delivery slices

1. **Implemented:** JavaScript page loading, semantic DOM/accessibility
   snapshots, deterministic extraction, screenshots, public-network isolation,
   and dynamic-canvas presentation.
2. **Implemented:** isolated authenticated sessions, typed semantic
   click/type/select/check/wait, direct user takeover, material-drift detection,
   exact-action approval, and post-action receipts.
3. **Implemented:** governed attachment-ID uploads, quarantined downloads,
   attachment hashing/extraction, native user save, explicit file provenance,
   and transfer-storage revocation.
4. **Implemented:** redacted browser recording, encrypted identity-pinned
   semantic recipe compilation, deterministic model-independent replay,
   checkpoints, drift stop, Automations management, and AI-assisted repair
   tasks.
5. **Implemented for the isolated browser:** masked transient vision evidence,
   exact frame/pixel/page binding, bounded click/type/key/scroll, fresh
   approvals, canvas visibility, and authentication takeover.
6. **Desktop handoff implemented:** stable recipes can open focused automation
   tasks for promotion. Durable schedules, connectors, and company-data
   ingestion remain governed Platform deployments rather than laptop-local
   hidden authority.

## Acceptance criteria

- A public JavaScript site can be loaded, inspected, cited, and extracted
  without exposing a browser debugging surface to the renderer or model.
- An authenticated workflow cannot cross user, tenant, task, or profile
  boundaries. Cross-origin transitions require fresh validation and exact
  approval.
- No model can retrieve or type credentials, MFA values, tokens, or cookies.
- Consequential actions bind approval to the exact origin, page revision,
  material-page marker, target, payload, and destination. File-transfer
  approvals additionally bind the exact artifact once that slice is enabled.
- Downloads and uploads use existing workspace, hashing, approval, and receipt
  boundaries.
- Deterministic recipes run without an LLM while their declared page contract
  remains valid and stop safely on drift.
- Visual fallback is offered only to a vision-capable profile, masks editable
  values, binds every coordinate to the exact frame hash, keeps screenshots out
  of persisted/public tool state, and never crosses outside the task browser.
- Browser-created company context retains source, capture time, hash, and
  freshness and is never promoted merely because it was viewed.
- Claude, Codex, and other clients retain the equivalent governed platform
  action when the capability is not inherently local; Desktop-only browser
  execution never becomes hidden company authority.
