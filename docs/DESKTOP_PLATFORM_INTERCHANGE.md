# Desktop and platform interchange

## Product position

AMOS is an agent-independent governed company brain. Claude, Codex, and other
compatible MCP clients remain complete, first-class ways to use it. AMOS Desktop
is the enhanced first-party operating surface, not a replacement for those
clients. The managed platform and company brain remain the system of record,
policy boundary, credential broker, and audit ledger.

Desktop should expose any routine operation that the brain can safely describe
and authorize. The same underlying capability must remain discoverable and
usable through supported external MCP clients. Sending a user to the managed
website is reserved for platform administration, recovery, or a capability the
current client does not yet support.

This is not a second implementation of AMOS in Electron:

- Desktop owns presentation, local model execution, local encrypted preferences,
  native human confirmation, and orchestration of a signed-in user session.
- The platform owns tenant identity, connector credentials, normalized company
  data, ingestion, authorization, approvals, durable company state, execution,
  receipts, and audit history.
- Every company read and action initiated in Desktop crosses the same governed
  MCP/API boundary as every other AMOS client.
- OAuth tokens never enter the renderer or model. A manually entered API key
  may exist transiently in the dedicated Connections password field and its
  direct submission object; it never enters chat/model context, application
  state, telemetry, drafts, settings, or local storage and is cleared when the
  setup completes or is cancelled.
- No company capability is implemented only inside Desktop. Desktop-specific
  conveniences compose public, governed platform capabilities.

## Implementation status — August 10, 2026

The first major Desktop-harness foundations are shipped: the conversation-first
shell, inline governed progress, dynamic canvas, encrypted restart continuity,
mid-task steering, native OpenAI Responses and Anthropic Messages adapters,
managed local intelligence, and local-primary AMOS Router integration.

The routing hardening slice makes ownership explicit. Only the official
Desktop `amos-hosted` profile can receive the local classifier; selected-provider
and external-client paths are structurally excluded and covered by negative
tests.

Bedrock protocol binding is now model-qualified rather than provider-wide. A
signed descriptor catalog selects OpenAI Responses or Anthropic Messages plus
the exact Mantle base path, API-key header, capabilities, reasoning controls,
and verified regions. Invalid model, region, path, and credential-origin
combinations fail before settings are persisted. The enterprise SigV4 adapter
uses the standard AWS credential chain entirely in the main process and has
passed live text, usage, two-turn tools, streaming, vision, cancellation, and
provider-error qualification. API-key mode remains available explicitly.
Account-specific Marketplace and data-retention policy remain external gates;
AMOS discovers and reports them without changing account policy.

The first local artifact slice is also implemented: a versioned document spec
now drives deterministic DOCX and PDF renderers, output approval, hashing, and
reopen verification. It is a Desktop-local engine, not a company capability or
an inference-routing concern. Verified documents now open in a bounded, inert
typed-canvas preview with deterministic layout diagnostics, same-path revision
updates, and main-process-validated local open/reveal actions. Final file
pagination remains authoritative.

The next product slices, in order, are:

1. add images, charts, reusable templates, page-faithful thumbnails, and editing
   to the local artifact engine, followed by spreadsheet and presentation
   contracts;
2. add the governed browser runtime for JavaScript pages, authenticated web
   workflows, deterministic browser recipes, and bounded computer-use fallback;
3. add consent-aware Router corrections/export and a sealed qualification gate;
4. complete the acceptance audit for the shipped Automations, Tasks, and
   governed forking surfaces and close issue 47; and
5. add enterprise device inventory, revocation, and environment grants tracked
   in issue 17.

## Client parity

The platform contract is the product. Desktop, Claude, Codex, and future clients
are presentations of that contract.

- Tools, resources, schemas, and proof receipts remain available through MCP.
- Connector setup may use platform-issued links, allowing any client to begin a
  connection without handling credentials.
- A saved briefing definition can be represented as a normal brain resource,
  even when Desktop adds richer layout, refresh controls, or local shortcuts.
- Approval remains a platform capability. Desktop may provide a native human
  ceremony, while Claude and Codex continue to use the existing hosted human
  ceremony without losing functionality.
- Capability discovery describes presentation options such as
  `desktop_native_dialog`; it must not hide the underlying operation from other
  authorized clients.
- New features are not complete until they have a client-neutral MCP/API
  contract, proof behavior, and at least one non-Desktop path.

Inference routing is intentionally not part of client parity. The local tiny
classifier is a first-party Desktop implementation detail for the managed AMOS
Intelligence request path. Claude, Codex, and other MCP-controlled clients keep
their controller's model choice and never receive, invoke, configure, or emit
Desktop routing state. Direct-provider profiles inside Desktop are likewise
pinned and pass through their native adapter without local classification.

Desktop can enhance the experience with local intelligence, richer visuals,
notifications, secure operating-system dialogs, offline drafts, and persistent
navigation. Those enhancements must not fork company logic or make an external
client less capable than it was before.

## Conversation-first Desktop shell

Chat is the primary operating surface. Dedicated pages remain durable places
to browse and administer company state; they are not prerequisites for doing
the same authorized work conversationally.

- The navigation rail collapses so the conversation can use the window.
- Model progress, workflow selection, governed tool use, approvals, and
  outcomes appear as a transient inline activity stream in the conversation.
  Desktop presents useful progress and reasoning **summaries**, never hidden
  chain-of-thought or credential-bearing tool payloads. Completed work collapses
  to a bounded summary; durable proof remains under Activity & proof.
- A dynamic canvas is a contextual work surface beside chat, not a navigation
  destination. It may resize or close without deleting its task-local view.
- Typed UI actions carry an explicit, language-neutral presentation intent.
  Free-form conversation uses model judgment through the always-visible,
  authority-free `desktop_request_work_surface` tool; regex matching is only a
  defensive hint and never the deciding product contract.
- Briefings is the library for saved definitions, templates, and reopening
  current work surfaces. It does not own the live company result or replace the
  conversation.
- Responsive layouts may temporarily prioritize either chat or the work
  surface, but both remain parts of one task rather than separate workflows.

When a Platform tool returns a typed UI action, any client may present it. The
current action envelope is additive to the normal MCP result:

```json
{
  "schema": "amos.ui_action.v1",
  "authority": "amos_platform",
  "type": "open_url",
  "purpose": "oauth_consent",
  "label": "Connect Example App",
  "url": "https://provider.example/authorize?...",
  "expires_at": "2026-07-31T12:10:00Z"
}
```

Desktop renders only the narrow typed actions it understands and still applies
local URL/protocol checks. Free-form model text cannot mint a privileged button.
Claude, Codex, and other MCP clients receive the same action and may render a
link or use another appropriate affordance.

## Session continuity and rehydration

Refreshing or relaunching Desktop must not make the operator rediscover the
selected project, recently completed objective, or known local artifacts. A
bounded rehydration package may persist locally when it remains an orientation
layer rather than a second company system of record:

- the package is encrypted with operating-system storage and pinned to the
  exact user, tenant, operating boundary, and selected workspace;
- it contains recent user/assistant milestones, local receipt references, and
  safe workspace-relative artifact and Git metadata;
- it never stores tool arguments, raw tool output, credentials, bearer tokens,
  pending execution authority, or replay instructions;
- likely secrets are redacted before encryption, and demo or machine-principal
  sessions do not create a company continuity package;
- rehydrated content is explicitly untrusted orientation. AMOS must reinspect
  local files and reread current platform sources, receipts, policy, and pending
  approvals before relying on it or acting;
- **Clear session** removes the matching local continuity package, in-memory
  conversation, and the exact authenticated user's platform `active` lane so a
  later refresh cannot resurrect it. An older or unavailable server never
  blocks the local clear; Desktop shows that the shared clear still needs to be
  retried.

The platform remains authoritative for company data, shared continuity,
durable operations,
approvals, and proof. Client-neutral fork manifests and platform memory remain
the portability path for continuity across devices and Claude/Codex; this local
package only prevents a first-party Desktop restart from erasing useful working
context.

## The interchange contract

Desktop discovers capabilities from the platform instead of hard-coding which
features a tenant has. A bounded capability response should identify:

```json
{
  "client": {
    "kind": "official_desktop",
    "approval_decision_mode": "desktop"
  },
  "surfaces": {
    "briefings": true,
    "connections": true,
    "receipts": true
  },
  "connections": {
    "catalog": true,
    "hosted_oauth": true,
    "customer_aws_lake": true
  }
}
```

The platform may omit or disable capabilities based on principal type, OAuth
client, role, tenant policy, or subscription. Desktop must fail closed and fall
back to the managed surface when a capability is not advertised.

Client-specific presentation metadata is additive. Authorization continues to
be determined by the user's identity, tenant role, policy, and requested
operation—not by choosing Desktop instead of Claude or Codex.

## Briefings

“Briefings” is the user-facing name for reusable governed company work surfaces.

- Templates are platform-owned reusable objectives, allowlisted source plans,
  and presentation intentions. Desktop never substitutes a bundled catalog.
- A saved `BriefingDefinition` is durable tenant state: title, objective,
  template/source plan, bounded parameters, presentation preference, version,
  creator, and lifecycle. It stores neither credentials nor a cached answer.
- A `BriefingRun` is an immutable, attributable evidence snapshot. Manual and
  scheduled runs use the same contract, and every declared source re-enters its
  current tenant, RBAC, policy, and connector gate before it is read.
- A `BriefingSchedule` stores cadence and in-app delivery metadata only. It
  stores no bearer token or execution authority. Activating or resuming standing
  work is governed; every run re-resolves the creator's current active
  membership and role, so revocation fails closed.
- Desktop renders a deterministic sidecar and provides Save, Run now, Open
  latest, Schedule, Pause, and Resume controls. Claude, Codex, and every other
  authorized MCP client can list, create, run, retrieve, archive, and schedule
  the same definitions and runs.
- Local-only work may continue to use encrypted identity-pinned definitions,
  but online company Briefings are platform-owned and portable across clients.

Initial templates:

- Daily company brief
- Portfolio performance
- Lead-source ROI
- Goals and progress

Built-in templates remain objective-led and company-neutral. They must not
introduce coaching, training, content, or another predetermined intervention
unless the user requests it or cited company evidence makes it relevant.
Connection and capability labels are platform facts: Desktop and its model must
not describe data, an engine, or a capability as “locked” unless the current
platform result explicitly reports that state.

Portfolio, operating-unit, lead-source, and goal views bind to the
platform-owned Company Performance Loop. The platform exposes generic operating
units, metric definitions, time-bounded observations, cited benchmarks, source
classification, and goal-compatible signals through MCP. “Franchise” is one
supported operating-unit type, not a Desktop-only or Neighborly-specific data
model.

Desktop adds a deterministic `performance` presentation intent for
`get_performance_snapshot`. It may format percentages and rank cited gaps, but
it must preserve current/prior periods, source references, classification, and
the platform's non-causal interpretation rule. It must not infer missing facts,
persist result payloads inside saved briefing definitions, or promote sample
data as connected customer data.

## Native Desktop approvals

API keys remain machine principals and cannot approve work. The official
Desktop may provide a controlled human approval ceremony, but neither a
forgeable request header nor a dynamically registered OAuth `client_name` is
proof that the caller is Desktop:

1. `GET /api/v1/approvals` returns `decision_mode: "desktop"` only when the
   caller's OAuth grant is bound to an active, browser-consented installation
   public key. All other callers receive `hosted`.
2. Desktop's main process requests the exact pending approval and displays an
   operating-system modal containing the operation, origin, summary, request
   time, and bounded arguments. The safe default is Cancel.
3. The renderer and the model cannot choose the modal result and never receive
   the bearer token.
4. After the user chooses Approve or Deny, the main process requests a
   short-lived, decision-bound server challenge and signs it with the
   installation's non-exported Ed25519 private key.
5. The platform verifies the OAuth token/key binding, signature, challenge
   expiry and single use, tenant, user role, pending state, and idempotency.
   Execution retains the original requester's bounded authority, while the
   receipt records the human approver.
6. If any check fails or the capability was not advertised, Desktop opens the
   hosted review page.

The installation key is created locally and its public half is bound during the
browser OAuth consent ceremony. The private half is encrypted with operating
system storage and is never sent to the renderer, model, or platform. Hardware
backing or biometric confirmation can strengthen this ceremony later; they do
not change the rule that only the platform decides whether a client can record a
human decision.

The existing hosted approval path remains supported for Claude, Codex, and other
MCP clients. Native Desktop approval is an additional verified ceremony, never a
requirement for using or approving AMOS work.

An approval result is part of the platform operation ledger. After the original
pending operation executes once, the platform returns and durably exposes a
bounded `execution_result`, digest, and truncation flag on that same pending id.
Desktop consumes each completed outcome once, inserts it into encrypted task
continuity as an immutable result (never as permission to replay), and renders it
inline. Hosted approval, native Desktop approval, Claude, and Codex therefore
converge on the same result rather than creating a second request and a second
approval. Large results require a bounded/paginated follow-up read.

## Connections in Desktop

The Connections surface is a projection of the platform connection catalog.
Desktop calls `list_connection_catalog` for canonical provider/service metadata
and `list_connections` for tenant-visible state. During a rolling deployment it
may fall back to the older platform-owned `list_oauth_providers` response when
the new tool is unknown; it never falls back to a Desktop-bundled provider list.
It renders:

- connected, attention-needed, and available states;
- ownership (user or shared service account);
- last successful synchronization and data freshness;
- the business capabilities each connection unlocks;
- Connect, Reconnect, Test, Sync, and Disconnect actions when authorized.

Each provider appears in exactly one state section. Once a tenant-visible
connection exists, Desktop removes that provider from Available and shows the
connection only under Connected (the generic “Any API” entry may remain
available because it creates distinct custom providers).

Connect and reconnect use one of two platform-advertised ceremonies:

- `hosted_oauth` asks the platform for a short-lived consent link and opens the
  provider's browser flow. OAuth tokens never enter Desktop.
- `hosted_secret` opens a dedicated Connections modal outside chat. Its labels,
  authentication shape, and safe defaults come from the platform catalog. On
  **Save and connect**, Desktop sends the one-time value through the
  authenticated platform client, clears the fields and submission object, and
  refreshes the credential-free catalog. The Platform validates, encrypts, and
  stores the secret and returns only a sanitized connection result or error.
- typed credential ceremonies (for example a corporation-bound upstream
  service) use the same modal, but the catalog also names the narrow Platform
  setup verb and any non-secret binding field. Desktop may invoke only the
  bounded setup verbs it supports; the Platform performs identity, scope, and
  upstream-contract validation before saving anything.
- `advanced` custom API setup may expose provider tag, HTTPS API root, and
  authentication-shape fields from the catalog. It still submits through the
  public governed connection verb and never becomes a Desktop-only adapter.

Connection ownership remains a Platform rule. An owner using the company
Connections surface creates the explicitly shared service-account connection;
other authorized users create their own identity-bound connection unless the
Platform advertises and authorizes a different ceremony.

The modal value must never be copied into model input, task checkpoints, saved
briefings, renderer state, telemetry, logs, receipts, settings, or Desktop
storage. Data reads, synchronization, and connector writes continue through
governed platform verbs and produce proof receipts.

### Open-world connection capabilities

Supporting a new API must not require a hard-coded Desktop card or a bespoke
server adapter for every endpoint. The canonical extension unit is a
platform-owned, provider-neutral operation contract:

1. Any MCP client may propose inert operation drafts from provider docs,
   OpenAPI, or a request shape the user has reviewed.
2. Each draft binds one connection, semantic operation key, exact HTTP method,
   fixed relative path template, strict path/query/body schemas, non-secret
   headers, evidence, and a `read` or `write` consequence.
3. A signed-in owner/admin activates the exact credential-free manifest under
   the normal approval ceremony. The platform rechecks it before activation.
4. Every client discovers the same active contracts and calls the same generic
   execution verb. The platform pins the revision before policy, validates all
   values, injects the vaulted credential, fixes the origin/method/path, emits a
   receipt, and returns the result.

This permits fixed POST queries, searches, and GraphQL operations to be governed
as reads without weakening raw proxy safety. `PUT`, `PATCH`, and `DELETE` can
never masquerade as reads; contract writes always park. The raw generic proxy
remains available for conservative discovery and treats every non-read method as
consequential. Typed adapters remain appropriate when AMOS must normalize a
business domain, impose provider-specific budgets, or verify a specialized
upstream identity contract—not merely because an API is new.

Customer names, demo priorities, provider availability, setup status, and
service maturity must not be encoded in Desktop HTML or JavaScript. A provider
appears only when the connected AMOS Platform advertises it. Desktop joins
catalog and tenant state by the opaque provider key and renders the returned
labels, grouping, descriptions, capabilities, setup mode, and availability.

## Microsoft 365 and Power BI

The platform catalog groups these products under “Microsoft” for a simple setup
experience, while maintaining separate connections and tokens:

- `microsoft_graph` covers Outlook mail, calendar, contacts, and related
  Microsoft 365 resources. Start with least-privilege delegated access.
- `power_bi` covers workspaces, datasets, reports, and governed DAX queries.
  Power BI uses a different resource audience and tenant controls.

Connector reads should be typed platform verbs rather than arbitrary proxy
requests. In particular, Power BI's `executeQueries` endpoint is an HTTP POST
that performs a read. A `power_bi_execute_query` verb can classify it correctly,
bound the dataset/query/result size, apply policy, and record provenance.

Suggested demo read path:

1. List authorized workspaces and semantic models.
2. Select the Neighborly demo model.
3. Run bounded DAX for revenue, growth, close rate, source ROI, goals, and peer
   quartiles.
4. Normalize results into a franchise-performance snapshot.
5. Ask the brain for the Daily or Portfolio briefing.

Calendar and mail writes, such as scheduling a coach, remain governed actions
and use the normal approval policy.

## Neighborly quarterly evidence and learning loop

The Neighborly demo should accept the quarterly franchise report supplied by
the customer contact as a governed evidence source. The initial path may use a
user-attached report, followed by a repeatable platform ingestion adapter once
its format is known. Before the report is used:

- retain the original file as immutable evidence with tenant, uploader, time,
  and content-hash provenance;
- profile and map its franchise, brand, tier, period, revenue, growth, close
  rate, lead-source, goal, and peer-benchmark fields;
- preserve reported values separately from derived metrics and AI conclusions;
- record the cohort and tier used for each top-quartile comparison;
- make every briefing claim traceable to the report, Power BI result, or other
  durable source; and
- version the mapping so a later quarterly format cannot silently change prior
  conclusions.

Power BI can provide fresher operating measurements between quarterly reports.
AMOS should reconcile source identity and period rather than overwriting the
quarterly evidence. Conflicts and stale data are visible in the briefing.

The target product loop is:

1. AMOS continuously evaluates governed franchise metrics against goals and the
   correct brand, tier, and peer cohort.
2. It identifies a material gap and explains whether the likely driver is lead
   quality, conversion, campaign mix, process, or another evidenced factor.
3. It estimates business impact and proposes a measurable intervention.
4. When learning is appropriate, AMOS searches the licensed Nuvola catalog for
   relevant existing material before proposing new content.
5. If a course should be created, AMOS drafts the audience, objectives,
   evidence, outline, and success measures. A human approves any consequential
   Nuvola write through normal platform policy.
6. Nuvola returns an immutable course/version reference. AMOS assigns or
   recommends it through a governed workflow and tracks completion.
7. Later metrics are compared with the baseline and goal so AMOS can report
   whether the training changed behavior and business results.

This is a closed evidence-to-learning-to-outcome loop, not autonomous content
generation from a weak correlation. The diagnosis, course proposal, approval,
publication, assignment, and measured outcome each retain separate provenance.

## Nuvola Learning MCP connection

Nuvola is a live, production-ready MCP capability owned and operated alongside
AMOS. It already exposes authenticated course discovery, grounded course
authoring, review/build gates, publishing, enrollment, and outcome data. It is
distinct from an ordinary OAuth API connection, but that distinction must not
create a Desktop-only integration or a second governance plane.

**Required canonical execution path:** every AMOS client calls AMOS Platform
MCP. The production adapter must resolve the tenant-bound Nuvola connection,
apply AMOS policy, invoke the allowlisted Nuvola MCP operation, write the AMOS
receipt, and return a bounded result. Until that adapter passes its acceptance
tests, the platform catalog reports `upstream_status: live` separately from
`availability: adapter_required`. Desktop never holds a Nuvola token or calls
Nuvola directly. Nuvola's own authorization and audit remain defense in depth,
not a substitute for AMOS governance.

The platform owns the tenant binding, endpoint allowlist, identity, credential
material, policy, receipts, and durable course references. AMOS Desktop
presents connection health and the best intervention workflow; Claude and
Codex discover the same normalized Nuvola capabilities through AMOS MCP.

The platform integration must define:

- a tenant-scoped Nuvola MCP server registration with pinned HTTPS origin and
  server identity;
- a tool allowlist and normalized schemas for catalog search, course retrieval,
  draft creation, publication, assignment, and completion/outcome reads;
- separate read and write consequences, with human approval for course
  creation, publication, assignment, or learner-impacting changes;
- bounded inputs and outputs that prevent report data, credentials, or unrelated
  company context from being forwarded;
- installation health, last successful call, license state, and data freshness
  in the platform connection catalog; and
- receipts that link the AMOS diagnosis and approved proposal to the exact
  Nuvola course/version without granting Nuvola general AMOS authority.

Nuvola's present owner-level MCP identity makes the AMOS tenant-to-Nuvola
corporation binding especially important. Callers may never select an arbitrary
Nuvola corporation. The connection record pins that mapping, and the platform
injects or validates it server-side. Longer term, Nuvola should issue
organization-scoped service authorization so both systems independently enforce
the same boundary.

Desktop may show Nuvola only when the platform catalog advertises it. It must
render upstream maturity, AMOS adapter availability, and tenant connection
state as separate facts and may not promote `upstream_status: live` into an
AMOS-supported or tenant-connected claim.

## AWS and data lakes

When the platform implements and advertises these surfaces, the catalog must
show two distinct concepts:

- **AMOS Data Lake — Included.** Connected-system data ingested by AMOS is
  stored and queried by the platform. Desktop shows coverage, freshness, and
  available datasets; it does not ask the customer for AWS credentials.
- **Customer AWS Data Lake — Optional connection.** For a customer's existing
  S3/Glue/Athena environment, AMOS supplies a unique external ID and account
  principal. The customer creates a least-privilege cross-account role. AMOS
  assumes the role with temporary credentials and validates only the approved
  buckets, catalogs, workgroups, and regions.

Do not accept long-lived AWS access keys for this product path. Test and
discovery calls must be read-only, tenant-pinned, bounded, and receipted.

## Multi-account identity, companies, and organization hierarchy

Single-account AMOS remains the default experience. The signed-in identity card
still looks and behaves normally, but clicking it opens the account menu. The
menu can add another AMOS account, switch accounts, sign out of the active
account, and check for Desktop updates. This is the same mental model as a
Google account switcher, not a portfolio-wide Platform identity.

Each added account completes an independent browser OAuth ceremony. Desktop
stores each complete OAuth session as a separate operating-system-encrypted
record and keeps the active-account index local. The Platform receives no list,
link, identifier, telemetry field, or other signal describing the other
accounts present on that computer. Selecting an account changes which isolated
OAuth record is used; it never asks one Platform account for permission to see
or activate another.

AMOS keeps four concerns separate:

- a local Desktop account profile containing one independently authenticated
  human login;
- one tenant-scoped user membership, role, and grants per company; and
- non-authorizing parent/child organization relationships such as portfolio,
  division, business unit, region, brand, franchise, subsidiary, or managed
  company.

An organization relationship never grants access. A coach who works across
franchises, or an executive who manages several companies, must hold an explicit
membership in each company. Operating units remain inside one tenant when they
are only analytics dimensions; a related tenant is appropriate when the unit
needs separate users, connections, credentials, policies, approvals, receipts,
or durable state.

Within one active account, Desktop may also discover the optional `amos_tenants_endpoint` and
`amos_tenant_switch_endpoint` fields from the OAuth authorization-server
metadata. That secondary selector covers only memberships already visible to
that one login. It does not replace **Add another account**, bundle a tenant
list, infer membership from hierarchy, or send a tenant ID through normal
company-tool arguments.

When the user switches an independently authenticated account:

1. Desktop refuses the switch while work is active, then activates only the
   selected locally encrypted OAuth record;
2. Desktop cancels local approval prompts and clears the old runtime,
   conversation, attachments, canvas result handles, transient briefing
   results, approval list, connection projection, company cache, notification
   cursor, and shared-continuity projection;
3. locally durable private memory, task checkpoints, saved briefing
   definitions, receipts, and restart continuity remain encrypted and are
   filtered by the exact user and tenant before they can be listed or loaded;
4. Desktop reloads identity, policy, approvals, connections, intelligence
   status, receipts, and continuity under the newly active OAuth session; and
5. the Platform sees only ordinary requests from that selected session and
   never records a cross-account switch receipt because no cross-account event
   occurred on the Platform.

When the user instead switches between memberships advertised inside one
active account:

1. the platform verifies the target membership and recalculates its role/scopes;
2. the platform mints a fresh OAuth token bound to the target user and tenant and
   writes a `switch_tenant` receipt;
3. Desktop preserves the verified installation key but clears the old company
   cache, runtime conversation, attachments, transient briefing results,
   approval list, connection projection, and notification cursor;
4. Desktop reloads identity, approvals, connections, intelligence status, saved
   briefing definitions, and company list from the target boundary; and
5. encrypted task checkpoints remain local references only and retain their
   existing user/tenant revalidation requirement before any continuation.

Both kinds of switch fail closed while a task is running. API keys and machine
clients cannot enumerate local Desktop accounts or switch human memberships.
No renderer, model prompt, task checkpoint, telemetry event, or Platform call
receives OAuth or refresh-token material. The source token remains pinned to
its source identity/company; switching never creates a token with
portfolio-wide or cross-account authority.

The client-neutral platform contract is documented in
`docs/MULTI-COMPANY-IDENTITY.md` in the managed-platform repository. Owner/admin
hierarchy management, membership invitations, portfolio navigation, and
aggregate analytics are subsequent platform milestones built on that boundary.

## What still belongs on the managed website

- tenant creation, ownership transfer, and destructive account administration;
- billing and legal acceptance;
- OAuth provider administration requiring client secrets;
- emergency credential recovery;
- unsupported or legacy flows explicitly identified by capability negotiation.

Everything else should be queryable or actionable in Desktop through the brain.

It must also remain queryable or actionable through the relevant governed MCP
tool. Desktop-only presentation is acceptable; Desktop-only business capability
is not.

## Automations as a first-class operating surface

Automations belongs immediately after Connections in primary Desktop
navigation. The product progression is deliberate:

1. connect governed company systems;
2. give AMOS current context and deterministic data to analyze;
3. build and operate reusable automations from platform primitives; and
4. optionally attach those automations to a bounded, governed goal-pursuit loop
   that observes results and proposes or performs allowed adjustments.

This is a projection of the existing platform Automation engine, not a second
Electron implementation. The platform already owns automation definitions,
triggers, deterministic steps, enrollment and run state, pause/resume behavior,
policy, approvals, receipts, and goal-pursuit primitives. Desktop calls the
client-neutral `list_automations`, `set_automation`, `pause_automation`, and
`resume_automation` capabilities and renders their credential-free result.
Claude, Codex, and other compatible MCP clients retain the same capability.

The Automations page is for durable management: status, trigger and step
summaries, bounded outcome metrics, refresh, pause, resume, and entry into
conversational authoring. Direct controls remain typed platform calls. The AI
helps a user design, explain, revise, and validate the definition; once saved,
the durable automation should continue through deterministic primitives when
the model is unavailable unless a declared step explicitly requires model
judgment.

Authoring integrates with the task manager without inventing false lineage:

- **Build automation** starts a new root task with an automation-builder intent.
- **Work on this with AMOS** starts a focused task carrying an immutable
  reference to the selected platform automation.
- **Fork from here** inside an existing conversation creates a true governed
  child fork and records the parent task plus exact source milestone.

The first Desktop slice may open a new named context lane before the searchable
task manager is visible, but it must preserve the prior lane and must never
implement “new task” by deleting shared or encrypted continuity. The following
task-manager slice adds **Tasks** immediately after Operator in primary
navigation. A chat is the interface; a task is the durable object that owns its
context lane, dynamic canvas, artifacts, decisions, automation or goal
references, and lineage. The page exposes active, waiting-for-user, recent, and
forked tasks with search, rename, pin, archive, lineage, and safe resume.

The user-facing vocabulary reflects that distinction instead of forcing the
storage model into chat. **Operator** uses **New conversation** and **Fork
conversation** because those are the actions a person recognizes while talking
with AMOS. **Tasks** remains the management page for the durable work containers
behind those conversations. Starting a conversation creates its task
automatically; the first message becomes its initial objective and title. A
user never has to visit Tasks before starting or branching a conversation.

Memory remains an important settings and context surface, but it is not a daily
operating destination. Its page stays intact and opens from **Accounts &
Settings → Memory & context** instead of occupying primary navigation.

## First-class task forking

Post-Neighborly, task forking is a first-class Desktop and platform milestone.
Desktop provides **Fork from here** on any user/assistant milestone and **Fork
task** in the task menu. The operation creates a governed fork manifest rather
than copying transcript text.

The manifest records:

- parent task/thread ID and exact source message/event ID;
- objective and user-editable fork name;
- tenant/user identity and an immutable company snapshot or reference cursor;
- relevant durable memory, evidence, and source references;
- the active briefing/view definition;
- local project roots and Git repository, branch, commit, and dirty-state
  metadata;
- model/runtime selection as a preference, never as company business state;
- provenance linking parent and child for audit and lineage navigation.

The creation sheet contains Name, Objective, Context scope (**Everything**,
**From here**, or **Selected artifacts**), and Workspace mode (**same working
directory**, **new Git worktree**, or **context-only**). Before creation it
shows exactly what carries over and what does not. After creation Desktop opens
the child beside the parent and provides obvious lineage and back navigation.

Fork safety is fail-closed:

- never copy or replay pending approvals, queued writes, credentials, bearer
  tokens, refresh tokens, or execution authority;
- a child may reference an existing pending operation only by immutable ID and
  must re-fetch and revalidate it before acting;
- encrypted local-only material stays local and tenant/user identity-pinned;
- a company snapshot is evidence context, not replay authority;
- the child receives model/runtime choices only as preferences;
- manifest creation and reads are governed platform/MCP capabilities, so Claude
  and Codex remain able to create and inspect forks while Desktop supplies the
  richer UI.

The existing task-checkpoint infrastructure is a useful source for local
milestone and workspace metadata, but it must not become the company system of
record. A minimal safe implementation may reuse checkpoint serialization only
after introducing the client-neutral fork-manifest schema and the exclusions
above. This milestone follows the Neighborly-critical Briefings, approvals, and
Connections slices.

## Neighborly delivery sequence

### Wednesday–Thursday

- Ship Briefings naming, templates, and encrypted saved view definitions.
- Enable the native approval ceremony in Desktop.
- Add the trusted-Desktop decision mode and enforcement to the managed platform.
- Add the first Connections catalog projection.

### Thursday–Friday

- Add curated Microsoft Graph and Power BI providers.
- Implement typed, bounded Outlook/calendar reads and Power BI discovery/query.
- Normalize franchise, source, goal, and peer-comparison data for briefings.
- Inspect and map the customer-provided quarterly franchise report when it
  arrives, preserving the original report and versioned mapping as evidence.

### Weekend

- Build the Neighborly demo dataset/adapter and AWS connection cards.
- Create the Daily company brief and Portfolio performance demo views.
- Script the flow from appointment context to gap diagnosis to recommended
  coaching/LMS action.
- Present Nuvola as a live learning service, while clearly showing whether the
  tenant's governed AMOS Platform connection has been configured and tested.

### Monday

- Rehearse with production-shaped data, exercise expired-token and unavailable
  source paths, verify receipts, and freeze the demo build.

### Tuesday

- Run the demo from Desktop with the managed platform visible only through live
  data, policy, and proof—not as a second UI the presenter must operate.

### Post-Neighborly

- Define the governed fork-manifest MCP/API resource and lineage model.
- Ship the Desktop fork sheet, workspace/worktree modes, and side-by-side
  parent/child navigation.
- Add cross-client contract tests proving Claude and Codex can create/read
  manifests and that authority-bearing state is never inherited.
- Complete the governed AMOS Platform-to-Nuvola MCP adapter, course/version
  references, and evidence-to-training-to-outcome measurement loop.

## Release acceptance criteria

For each Desktop feature, verify:

1. The business capability lives in the platform/brain, not the renderer.
2. Claude and Codex can discover and invoke the underlying capability through
   MCP with their existing authentication model.
3. Existing MCP schemas and behavior remain backward compatible, or a versioned
   migration is provided.
4. Desktop adds presentation or local workflow value without retaining,
   exposing, or sending connector credentials through model context, and
   without bypassing policy.
5. Equivalent proof receipts are produced regardless of client.
6. The non-Desktop happy path is covered by a contract or integration test.
7. Desktop contains no customer-specific roadmap, provider list, or provider
   status; those facts come from the authenticated platform catalog.
