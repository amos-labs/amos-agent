# Privacy

AMOS Desktop does not send usage analytics until you choose **Allow**. The
default is no send until you answer. You can change this later in Settings.

## What Desktop may send

After you opt in, Desktop can send these anonymous events to the AMOS managed
platform (`/api/v1/desktop/events`, stored as `desktop_acquisition_events`):

- `desktop_first_launch` — this installation started
- `desktop_telemetry_choice` — you allowed analytics
- `desktop_boundary_selected` — My workspace, Northwind, or My company was chosen
- `desktop_onboarding_completed` — first-run finished
- `desktop_first_task_started` — the first Desktop task began
- `northwind_demo_value_reached` — a completed, tool-backed Northwind demo task

Each event includes a random installation UUID, app version, operating system,
architecture, release channel, and a small non-content context object. The
UUID is not derived from hardware, an advertising identifier, or an email
address.

## What Desktop does not send

- Access tokens, refresh tokens, or API keys
- Prompts, completions, files, or attachments
- Company data, receipts, or local workspace contents
- A name, email, or account identifier on these public events

Telemetry is never used for authentication, billing, policy, or authorization.

## Identity

The installation UUID is created locally and stored with owner-only
permissions in the app data directory. It is not a device fingerprint. Signing
in or starting the Northwind demo can attach that same UUID to the browser
handoff so AMOS can tell a download from a successful launch. That OAuth and
demo install-UUID handoff is independent of Allow / Don't send. A person and
company are attached only after OAuth or the demo handoff.

## Turn off or delete

- First-run or Settings → anonymous usage events → **Don't send**. Nothing
  further is sent.
- Unanswered means nothing is sent.
- Reinstalling AMOS Desktop creates a new installation UUID. Previous
  anonymous events are not tied to you and are not deleted from the platform
  by reinstalling.

See [Security policy](SECURITY.md) for vulnerability reports.
