# First run and operating boundaries

AMOS Desktop is the cold path. The first-run screen asks what you want to
operate and persists that choice so a restart does not send you back through
onboarding.

The product loop is the same on every path: describe the work, build or change
something, ask for the next step, delegate a bounded task, and keep a local
receipt. Desktop Operator plus Northwind is how a new person should feel that
loop. Claude or Codex as an MCP client is a later appendix, not the first
screen.

Completion is stored as `onboardingCompletedAt` and `onboardingBoundary` in
Desktop settings (`personal`, `northwind`, or `company`). Those keys survive
process restart because `sanitizeSettings` keeps them.

Anonymous usage events stay off until the first-run privacy choice. Telemetry
never gates **Enter**.

## My workspace

**Your model, this computer.** No AMOS account is required. Hosted `auto` is
not available here and needs a sign-in — use **Northwind** or **My company**
for AMOS Intelligence.

Recommended intelligence:

- a measured local profile (GPT-OSS 20B / Qwen 27B Q4) when this computer can
  run it; or
- a provider key you already have (OpenAI, Anthropic, Bedrock, Kimi, or a
  compatible endpoint).

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
off until a local profile or BYO key is saved and a folder is chosen.

## Northwind demo

Northwind is the featured hosted-`auto` path. The demo launches the public
Playground in a browser. After abuse checks create a short-lived Northwind
tenant, the Playground sends the tenant-scoped key to a one-time loopback
receiver using an HTML form POST. The key does not enter the browser URL,
history, query logs, or referrer.

Desktop stores the expiring demo credential with the same owner-only token
store used for OAuth, switches to an app-owned demo workspace, and labels the
entire session **Northwind demo**. The demo uses real AMOS tools, policy,
approvals, receipts, and metered hosted intelligence against sample data. It
cannot connect credentials, spend real money, or escape the demo tenant.

Connecting a real company replaces the demo credential and restores the
previous personal workspace.

### Privacy-safe activation measurement

AMOS Desktop creates one random installation UUID on first launch and stores
it in the app data directory with owner-only permissions. It is not derived
from hardware, an advertising identifier, an email address, or another device
fingerprint.

Nothing is sent until the user chooses **Allow**. After opt-in, the
installation UUID lets AMOS distinguish a download from a successful first
launch, a selected operating boundary, completed onboarding, a first task, and
a completed tool-backed Northwind task. A person and company are attached only
after the browser hands off an authenticated demo or the user completes AMOS
OAuth. Access and refresh tokens are never stored in the telemetry file.
Telemetry is best-effort and never controls product access, policy, billing,
or authorization.

## My company

The normal OAuth path supplies durable company memory, applications, engines,
goals, policies, approvals, and receipts. Hosted `auto` works after sign-in.
The selected model and local workspace remain independent of the company
connection.

## Intelligence posture

There is no anonymous hosted `auto`.

| Path | Intelligence |
| --- | --- |
| My workspace | Local profile or BYO key. Hosted `auto` requires sign-in. |
| Northwind | Hosted `auto` against the demo tenant. |
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
