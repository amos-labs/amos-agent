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
- The renderer and model never receive OAuth tokens or connector credentials.
- No company capability is implemented only inside Desktop. Desktop-specific
  conveniences compose public, governed platform capabilities.

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

Desktop can enhance the experience with local intelligence, richer visuals,
notifications, secure operating-system dialogs, offline drafts, and persistent
navigation. Those enhancements must not fork company logic or make an external
client less capable than it was before.

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

“Briefings” is the user-facing name for dynamic company canvases.

- Templates are reusable questions and layout intentions.
- Saved views store a title, refresh prompt, and source definition locally,
  encrypted and pinned to the signed-in tenant/user.
- Saved views do not cache company results as an alternate system of record.
- Opening or refreshing a briefing queries the brain again so the result is
  current, governed, and attributable.
- A later platform-backed saved-view resource can make definitions portable
  across the user's devices and available to Claude or Codex without changing
  the rendering contract.

Initial templates:

- Daily company brief
- Portfolio performance
- Lead-source ROI
- Goals and coaching

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

## Connections in Desktop

The Connections surface is a projection of the platform connection catalog.
Desktop calls `list_connections` and `list_oauth_providers` and renders:

- connected, attention-needed, and available states;
- ownership (user or shared service account);
- last successful synchronization and data freshness;
- the business capabilities each connection unlocks;
- Connect, Reconnect, Test, Sync, and Disconnect actions when authorized.

Connect and reconnect launch a platform-issued hosted OAuth/link flow. Connector
credentials remain in the platform. Data reads, synchronization, and connector
writes continue through governed platform verbs and produce proof receipts.

## Microsoft 365 and Power BI

The Desktop catalog groups these products under “Microsoft” for a simple setup
experience, but the platform maintains separate connections and tokens:

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

## AWS and data lakes

The catalog must show two distinct concepts:

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

### Weekend

- Build the Neighborly demo dataset/adapter and AWS connection cards.
- Create the Daily company brief and Portfolio performance demo views.
- Script the flow from appointment context to gap diagnosis to recommended
  coaching/LMS action.

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

## Release acceptance criteria

For each Desktop feature, verify:

1. The business capability lives in the platform/brain, not the renderer.
2. Claude and Codex can discover and invoke the underlying capability through
   MCP with their existing authentication model.
3. Existing MCP schemas and behavior remain backward compatible, or a versioned
   migration is provided.
4. Desktop adds presentation or local workflow value without receiving
   connector credentials or bypassing policy.
5. Equivalent proof receipts are produced regardless of client.
6. The non-Desktop happy path is covered by a contract or integration test.
