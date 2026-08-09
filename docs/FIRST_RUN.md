# First run and operating boundaries

AMOS Desktop does not require a company connection before it becomes useful.
The first-run screen asks which boundary the user intends to operate.

## My workspace

Personal workspace mode exposes:

- one explicitly selected local folder;
- documents, screenshots, and private memory the user deliberately supplies;
- bounded local file, Git, patch, and shell tools;
- public web tools when enabled; and
- a customer-selected cloud, private, or local model.

It does not expose AMOS company tools, company memory, company policy,
organizational approvals, or company receipts. Local mutations remain
approval-gated. `desktop_inspect_project` is the preferred first coding tool:
it inventories a bounded project, omits secret-like files, and reports the
stack, manifests, scripts, Git state, README excerpt, likely checks, and
suggested tasks.

## Northwind demo

The demo launches the public Playground in a browser. After abuse checks create
a short-lived Northwind tenant, the Playground sends the tenant-scoped key to a
one-time loopback receiver using an HTML form POST. The key does not enter the
browser URL, history, query logs, or referrer.

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

The installation UUID lets AMOS distinguish a download from a successful first
launch and a completed, tool-backed Northwind task. A person and company are
attached only after the browser hands off an authenticated demo or the user
completes AMOS OAuth. Access and refresh tokens are never stored in the
telemetry file. Telemetry is best-effort and never controls product access,
policy, billing, or authorization.

## My company

The normal OAuth path supplies durable company memory, applications, engines,
goals, policies, approvals, and receipts. The selected model and local
workspace remain independent of the company connection.

## Intelligence cost posture

New installations use **AMOS Intelligence · Automatic**. Desktop sends the
stable `auto` model alias without a user-selected reasoning tier. The managed
platform selects the least expensive qualified intelligence for each step,
escalates when requirements demand it, and records the exact routed model and
cost without retaining prompt or response content.

## Local proof

Every Desktop task produces an operating-system-encrypted, digest-addressed
local receipt with its boundary, workspace label, model profile, status,
bounded tool-event sequence, and finish time. These receipts prove local
execution history; they are not AMOS company receipts and never imply that a
business system changed.
