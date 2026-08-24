# First run and operating boundaries

AMOS Desktop is the cold path. The first-run screen is one column of
required and optional steps, not a marketing page. The only required step is
**choose intelligence** (AMOS Intelligence, this computer, or your key).
Connecting AMOS Platform and a workspace folder are optional; Desktop still
works if they skip. The selected boundary persists so a restart does not send
a configured user back through onboarding.

The product loop is the same on every path: describe the work, build or change
something, ask for the next step, delegate a bounded task, and keep a local
receipt. Desktop Operator plus Northwind is how a new person should feel that
loop. Claude or Codex as an MCP client is a later appendix, not the first
screen.

Completion is stored as `onboardingCompletedAt` and `onboardingBoundary` in
Desktop settings (`personal`, `northwind`, or `company`). Those keys survive
process restart because `sanitizeSettings` keeps them. An expired Northwind
demo is not a live boundary: Desktop clears the Northwind completion and
reopens first-run so the user is not left in a dead Online company shell.

Anonymous usage events stay off until the first-run privacy choice. Telemetry
never gates **Enter**.

## Intelligence — required

First-run asks how AMOS should think before it asks for a company:

- **AMOS Intelligence (Hosted)** — the default. Included with an AMOS
  account. Enter is available immediately; signing in and connecting company
  systems remain optional on the same screen.
- **This computer** — AMOS Local. No AMOS subscription. The recommended
  local model for this computer is selected on the same form.
- **Your key** — OpenAI, Claude, Grok, Kimi, or a compatible endpoint. No AMOS
  subscription; the provider may bill its own usage.

Personal + AMOS Intelligence + no OAuth stays **not configured**.

## Connect your company — the retention step

The company step is optional for Enter and required for a customer that
stays. Chat without the company is a trial. AMOS becomes the operating
system after it can see their apps and run work on a schedule, ad hoc, or
app-to-app.

Copy states why, automations first:

- Run automations on a schedule or ad hoc — app to app, inbox to ledger,
  ticket to fix — after you close Desktop.
- Connect the systems you already run so AMOS is not guessing from chat.
- Keep durable company memory, policy, approvals, and receipts.

The commercial boundary is a 14-day free trial and plans starting at
$99/month. Skipping it does not block Enter. Operator then hits the same
message again until at least one application is connected.

Returning users see their active company instead of trial acquisition copy.
"Reconnect" is reserved for an authentication session that actually needs to
be renewed.

## Northwind demo

Northwind sits under the optional Platform step: a realistic but intentionally
bounded sample company. The demo launches the public Playground in a browser. After abuse
checks create a short-lived Northwind tenant, the Playground sends the
tenant-scoped key to a one-time loopback receiver using an HTML form POST. The
key does not enter the browser URL, history, query logs, or referrer.

Desktop stores the expiring demo credential with the same owner-only token
store used for OAuth, switches to an app-owned demo workspace, and returns to
first-run for an explicit intelligence choice:

- AMOS Intelligence is preselected and includes 30 hosted messages per demo;
- AMOS Local uses an installed model on the person's computer with no AMOS
  subscription; and
- BYOK uses the person's selected provider credential with no AMOS
  subscription (the provider's own usage charges may still apply).

The hosted balance comes from `/v1/intelligence/status`; Desktop does not
infer it from rendered messages. The persistent Northwind banner shows the
remaining balance and exposes **Connect my company**, **Change intelligence**,
and **Leave demo**. Leaving restores the prior local workspace and returns to
the starting-point screen.

The demo uses real AMOS tools, policy, approvals, receipts, and metered hosted
intelligence against sample data. It cannot connect credentials, spend real
money, or escape the demo tenant.

## This computer / your key

**Your model, this computer.** No AMOS account or AMOS subscription is
required. Hosted `auto` is not available here and needs a sign-in — use
**AMOS Intelligence** or **Northwind** for AMOS Intelligence. A BYOK provider
may bill its own usage separately.

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

Personal + AMOS Intelligence + no OAuth stays **not configured**. Enter stays
off until a local profile or BYO key is saved. A workspace folder is optional:
it is the folder AMOS may read and change with approval. Chat works without
one; local file, Git, patch, and shell tools wait until a folder is chosen.

The readiness row is path-aware: its intelligence check remains incomplete
until the person chooses a starting point. The stored hosted default therefore
does not appear as a completed choice on an untouched first-run screen.

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

## Intelligence posture

There is no anonymous hosted `auto`.

| Path | Intelligence |
| --- | --- |
| My workspace | Local profile or BYO key. Hosted `auto` requires sign-in. |
| Northwind | Hosted `auto` with 30 included demo messages, AMOS Local, or BYOK. |
| My company | Hosted `auto` after OAuth 2.1 + PKCE + installation key. |

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
