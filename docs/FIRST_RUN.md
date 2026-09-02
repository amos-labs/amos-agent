# First run and operating boundaries

AMOS Desktop is the cold path. The first-run screen is one column of
ready and optional steps, not a marketing page. **AMOS Intelligence ·
Automatic** is ready by default; a new user does not choose a provider or
model before they can start. Connecting an AMOS account and one real business
system is the recommended activation path. A workspace folder remains
optional, and Desktop still works with a document, screenshot, or conversation
if the user skips connection. The selected boundary persists so a restart does
not send a configured user back through onboarding.

The product loop is the same on every path: describe the work, build or change
something, ask for the next step, delegate a bounded task, and keep a local
receipt. Desktop Operator on the user's own evidence is how a new person should
feel that loop. Claude or Codex as an MCP client is an advanced alternative,
not the first screen.

The product promise is one trusted assistant that helps a person run their
businesses from a conversation, including from a phone: it understands the
person, each company, the current goal, and the connected systems; turns ideas
into an inspectable plan; acts within standing authority; asks only when a
decision or approval is truly needed; and proves what changed. Agents, swarms,
Missions, memory, checkers, and automations are internal machinery. They are
valuable only when they help the person reach a business outcome faster and
must not become the product's organizing language.

Completion is stored as `onboardingCompletedAt` and `onboardingBoundary` in
Desktop settings (`personal`, `northwind`, or `company`). `northwind` remains
only for backward compatibility with existing demo sessions. Those keys survive
process restart because `sanitizeSettings` keeps them. An expired Northwind
demo is not a live boundary: Desktop clears the Northwind completion and
reopens first-run so the user is not left in a dead Online company shell.

Anonymous usage events stay off until the first-run privacy choice. Telemetry
never gates **Enter**.

## Intelligence — ready automatically

First-run reports the active intelligence; it does not ask the user to choose
infrastructure before they understand the product:

- **AMOS Intelligence · Automatic** — the default. It routes each step to the
  appropriate hosted model and requires no model selection on first run.
- **AMOS Local** and **bring your own provider** remain available from
  Intelligence & Settings. They are deliberate advanced choices, not competing
  onboarding doors.

The user can change intelligence at any time without changing the company,
workspace, or conversation they are operating.

## Connect one app — the activation step

The company step is optional for Enter. Foreground work in Desktop is a real
free product, not a timed demo: a signed-in person can use AMOS-owned
intelligence, local files, attachments, public research, and up to two
connected business apps for safe foreground reads and analysis. That access
exists to prove a real outcome on the person's own evidence—not to advertise a
connector count. AMOS becomes the paid operating system when the person asks
it to change company systems or keep working across systems, people, and time.

That puts the upgrade at the moment of expanded value:

- **Run this every week** — schedules and deterministic automations;
- **Continue while I am away** — Missions, goals, and background work;
- **Act across live company systems** — writes, cross-app workflows, durable
  memory, policy, approvals, and receipts; and
- **Share this with the team** — shared context, decisions, and concurrency.

The first empty state therefore leads with outcome-oriented jobs plus one
prominent route to connect real business evidence. The connection prompt must
say what it unlocks: the first verified answer or useful move on live data. It
must not present connection setup itself as the outcome.

Copy states why, automations first:

- Run automations on a schedule or ad hoc — app to app, inbox to ledger,
  ticket to fix — that run outside of Desktop.
- Connect the systems you already run so AMOS is not guessing from chat.
- Keep durable company memory, policy, approvals, and receipts.

The commercial boundary is free-to-start foreground Desktop work, followed by
the paid operating layer when the person needs more hosted usage or asks AMOS
to keep working across systems, people, and time. Desktop does not hard-code a
trial length or price; the account and website surfaces own current commercial
terms. Skipping an upgrade never blocks eligible foreground Desktop work.

The membership should be expressed in customer terms: it includes a pool of
verified automated outcomes. AMOS may count an outcome only after its checker
passes, its receipt is durable, and any required approval is complete. Model
tokens, thinking time, retries, partial work, failed runs, and a model saying
"done" are never outcomes and must never be billed as if they were.

For an ordinary foreground Desktop task, "verified" means authoritative tool
evidence or a successful OperationReceipt proves what actually happened. A
Mission is stronger: its explicit completion contract must also pass the
registered checker. The first useful outcome does not need to be forced through
a Mission merely to earn the word; the UI must remain honest about which proof
level it has.

The outcome catalog should stay legible to the customer—examples include a
reconciled period, a qualified prospect, a completed follow-up, an approved
invoice sync, or a verified weekly operating brief. Conversation itself stays
unmetered within fair use. An outcome is priced only when AMOS can define its
completion contract before execution and show the supporting evidence after.

Returning users see their active company instead of trial acquisition copy.
"Reconnect" is reserved for an authentication session that actually needs to
be renewed.

## Northwind demo — legacy only

Northwind is no longer offered in customer first-run. New users should reach a
verified outcome on their own document or connected business system rather
than learn a sample company. Existing and internal demo sessions remain
supported.

The legacy demo launches the public Playground in a browser. After abuse
checks create a short-lived Northwind tenant, the Playground sends the
tenant-scoped key to a one-time loopback receiver using an HTML form POST. The
key does not enter the browser URL, history, query logs, or referrer.

Desktop stores the expiring demo credential with the same owner-only token
store used for OAuth and switches to an app-owned demo workspace. It uses the
currently selected intelligence and does not reintroduce a customer first-run
provider chooser.

The hosted balance comes from `/v1/intelligence/status`; Desktop does not
infer it from rendered messages. The persistent Northwind banner shows the
remaining balance and exposes **Connect my company**, **Change intelligence**,
and **Leave demo**. Leaving restores the prior local workspace and returns to
the starting-point screen.

The demo uses real AMOS tools, policy, approvals, receipts, and metered hosted
intelligence against sample data. It cannot connect credentials, spend real
money, or escape the demo tenant.

## This computer / your provider

Local and BYO-provider modes are configured later from Intelligence & Settings.
They remain useful for privacy, customer-owned inference, and specialist
workloads, but they are not first-run decisions. A BYO provider may bill its
own usage separately.

Recommended intelligence:

- a measured local profile (GPT-OSS 20B / Qwen 27B Q4) when this computer can
  run it; or
- a provider key you already have (OpenAI, Anthropic, Bedrock, Kimi, or a
  compatible endpoint).

Installing an AMOS Local model only downloads it. Selecting **Use with
company**, **Use in personal workspace**, or **Use local-only** then sets both
the `ollama` provider and that exact model in one action; there is no separate
provider-selection step. Local-only also disables company and public-network
tools.

Unqualified Compact and Balanced (4B / 8B) may still be chosen for personal or
ungoverned work. They are badged **Unmeasured — not for governed work** and are
not recommended. Choosing them does not mark Desktop unconfigured.

Personal workspace mode exposes:

- one explicitly selected local folder;
- documents, screenshots, and private memory the user deliberately supplies;
- bounded local file, Git, patch, and shell tools;
- public web tools when enabled; and
- the customer-selected cloud, private, or local model.

It does not expose AMOS company tools, company memory, company policy,
organizational approvals, or company receipts. Local mutations remain
approval-gated. `desktop_inspect_project` is the preferred first coding tool:
it inventories a bounded project, omits secret-like files, and reports the
stack, manifests, scripts, Git state, README excerpt, likely checks, and
suggested tasks.

A workspace folder is optional: it is the folder AMOS may read and change with
approval. Chat works without one; local file, Git, patch, and shell tools wait
until a folder is chosen.

Intelligence and workspace selection are independent. Choosing, activating,
or saving intelligence keeps the person in **Intelligence & Settings** until
they explicitly return to setup; it never opens or requires the workspace
picker. Intelligence can be changed later from the account menu or the native
**AMOS Desktop → Intelligence & Settings…** menu (`Cmd+,` on macOS). The native
**File** menu also exposes **Choose Intelligence…**, **Memory & Context…**, and
the separate **Choose Workspace…** action. The installed version and
**Check for Updates…** are available in both the native **Help** menu and the
account switcher.

### Privacy-safe activation measurement

AMOS Desktop creates one random installation UUID on first launch and stores
it in the app data directory with owner-only permissions. It is not derived
from hardware, an advertising identifier, an email address, or another device
fingerprint.

Nothing is sent until the user chooses **Allow**. Consent is tri-state:
unanswered, declined, or allowed. Boundary, onboarding, and first-task
milestones queue only while unanswered and flush after Allow. Decline
discards the queue and later milestones; a later opt-in does not send
them. The official client has no opt-out event. After opt-in, the
installation UUID lets AMOS distinguish a download from a successful first
launch, a selected operating boundary, completed onboarding, a first task, and
a completed tool-backed Northwind task. A person and company are attached only
after the browser hands off an authenticated demo or the user completes AMOS
OAuth. Access and refresh tokens are never stored in the telemetry file.
Telemetry is best-effort and never controls product access, policy, billing,
or authorization.

The activation funnel ends at `desktop_first_verified_outcome`, emitted once
only after a task completes with at least one successfully completed tool
result. A model saying that work is complete is not sufficient evidence. The
event contains only the boundary, a coarse evidence class, and a bounded tool
count—never prompts, responses, filenames, tool names, or company data.

## Intelligence posture

There is no anonymous hosted `auto`.

| Path | Intelligence |
| --- | --- |
| New Desktop install | Hosted `auto`; no provider choice in first-run. |
| Local / personal workspace | Local profile or BYO provider selected later in Settings. |
| My company | Hosted `auto` after OAuth 2.1 + PKCE + installation key. |
| Existing Northwind session | Current selected intelligence; legacy support only. |

On Northwind and My company, Desktop sends the stable `auto` model alias
without a user-selected reasoning tier. The managed platform selects the least
expensive qualified intelligence for each step, escalates when requirements
demand it, and records the exact routed model and cost without retaining
prompt or response content.

## Also use AMOS from Claude

After My company succeeds, Claude or Codex can still connect as an MCP client.
That paste-URL path is not the first-run screen and is not a primary CTA.

## Local proof

Every Desktop task produces an operating-system-encrypted, digest-addressed
local receipt with its boundary, workspace label, model profile, status,
bounded tool-event sequence, and finish time. These receipts prove local
execution history; they are not AMOS company receipts and never imply that a
business system changed.
