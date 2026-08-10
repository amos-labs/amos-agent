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

For JavaScript-rendered public pages, Desktop now also exposes the first local
browser slice:

- `browser_open` creates or navigates a task-, tenant-, and user-bound ephemeral
  Chromium session;
- `browser_snapshot` returns bounded text plus opaque semantic element
  references tied to the current page revision;
- `browser_extract` deterministically extracts article text, tables, lists,
  form structure without values, or one referenced region;
- `browser_screenshot` refreshes an opaque local PNG frame rendered in the
  dynamic canvas; and
- `browser_close` destroys the page and revokes its references and frame.

This slice executes JavaScript and retains a task-local public browsing session.
It deliberately does not click, type, download, upload, persist authentication,
or operate a signed-in application yet.

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
- `browser_click`, `browser_type`, and `browser_select` — interact only with a
  current validated element reference;
- `browser_wait` — wait for a bounded URL, element, download, or network-idle
  condition;
- `browser_screenshot` — capture a bounded visual observation for the active
  task and dynamic canvas;
- `browser_download` — route a completed file through the normal attachment,
  hashing, size, and workspace-approval path;
- `browser_upload` — select an already approved local artifact without exposing
  arbitrary filesystem paths; and
- `browser_close` — destroy the task session and revoke its handles.

The implemented read-only subset already enforces short-lived element
references tied to the page revision, task, account, and tenant. A navigation
invalidates prior references. Free-form model text cannot mint a browser handle,
selector, frame, or privileged action. Click/type/select/wait and file transfer
remain the next delivery slice.

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

Repeated browser extraction can compile into a deterministic automation recipe
with declared origins, selectors, fields, schedules, retry rules, and output
schema. The recipe should continue without a model when the declared page
contract still holds. DOM drift produces a bounded failure and may request AI
repair; it never silently changes the target or submits a different form.

## Authentication and session isolation

- Browser profiles are isolated by exact AMOS user, tenant, task, and declared
  environment grant.
- Authentication happens through user-visible browser or operating-system
  ceremonies. The model cannot ask for, read, type, or retrieve a password,
  MFA code, recovery code, bearer token, or cookie.
- Where the Platform already brokers OAuth, Desktop uses the governed connector
  instead of copying that session into Chromium.
- Local browser state is encrypted or held in the operating-system browser
  profile, expires explicitly, and can be cleared or revoked independently.
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

Visual computer use observes screenshots and proposes pointer/keyboard actions
when semantic browser references do not exist. It is deliberately narrower and
higher-friction than DOM automation:

- each observation and action is tied to the current window, screen geometry,
  application identity, and frame hash;
- password fields, secure system surfaces, notifications, and unrelated windows
  are masked or unavailable;
- clipboard reads are denied by default and writes are bounded to declared text;
- destructive or external actions always pause at the consequence boundary;
- a changed frame invalidates stale coordinates; and
- the system records bounded screenshots and action receipts without retaining
  hidden credentials or unrelated screen content.

Local models can handle deterministic snapshots and simple navigation. A
stronger vision model may be selected only for an explicitly declared visual
fallback. The browser/computer runtime remains useful when that model is
offline: saved deterministic recipes continue, while unrecognized visual states
stop safely.

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
2. Isolated authenticated sessions, typed click/type/select/wait, downloads,
   user takeover, and exact-action approvals.
3. Browser recipe recording/compilation, deterministic scheduled execution,
   drift detection, and AI-assisted repair proposals.
4. Governed visual computer-use fallback for non-semantic pages and approved
   desktop applications.
5. Platform promotion path for browser workflows that should become durable
   connectors, automations, or company-data ingestion adapters.

## Acceptance criteria

- A public JavaScript site can be loaded, inspected, cited, and extracted
  without exposing a browser debugging surface to the renderer or model.
- An authenticated workflow cannot cross user, tenant, task, profile, or origin
  boundaries.
- No model can retrieve or type credentials, MFA values, tokens, or cookies.
- Consequential actions bind approval to the exact origin, page revision,
  fields, destination, and artifacts.
- Downloads and uploads use existing workspace, hashing, approval, and receipt
  boundaries.
- Deterministic recipes run without an LLM while their declared page contract
  remains valid and stop safely on drift.
- Browser-created company context retains source, capture time, hash, and
  freshness and is never promoted merely because it was viewed.
- Claude, Codex, and other clients retain the equivalent governed platform
  action when the capability is not inherently local; Desktop-only browser
  execution never becomes hidden company authority.
