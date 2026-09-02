# Privacy

AMOS Desktop does not send usage analytics until you choose **Allow**. The
default is no send until you answer. First-run milestones that happen before
that answer stay on this computer and flush after Allow. Don't send discards
them, and later milestones after a decline are not saved. A later Allow does
not send work that happened while declined. You can change this later in Settings.

## What Desktop may send

After you opt in, Desktop can send these anonymous events to the AMOS managed
platform (`/api/v1/desktop/events`, stored as `desktop_acquisition_events`):

- `desktop_first_launch` — this installation started
- `desktop_telemetry_choice` — you allowed analytics
- `desktop_boundary_selected` — My workspace, Northwind, or My company was chosen
- `desktop_onboarding_completed` — first-run finished
- `desktop_first_task_started` — the first Desktop task began
- `northwind_demo_value_reached` — a completed, tool-backed Northwind demo task
  (**not anonymous**; see below)

Each event includes a random installation UUID, app version, operating system,
architecture, release channel, and a small non-content context object. The
UUID is not derived from hardware, an advertising identifier, or an email
address.

All events except one are sent with no credential of any kind. The exception is
`northwind_demo_value_reached`: Desktop sends it with the Northwind demo
session's access token in the `Authorization` header so the platform can
attribute demo value to the demo tenant. That means the platform can link this
installation UUID to the demo account. Desktop never attaches a token to any
other event, even when one is sent in the same batch, and the token is never
written to disk by telemetry.

## What Desktop does not send

- Access tokens, refresh tokens, or API keys
- Prompts, completions, files, or attachments
- Company data, receipts, or local workspace contents
- A name, email, or account identifier on the anonymous events. The
  `northwind_demo_value_reached` event is authenticated as described above.

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
