# Guided Automation setup

AMOS Desktop turns an Automation request into a visible, governed setup flow
beside the Operator conversation. The user does not need to know MCP verb names
or switch to a separate workflow builder.

```text
plain-language request in Operator
  -> desktop_begin_automation_setup
  -> live Platform Blueprint/template catalog
  -> secure connection setup
  -> active typed operation contract
  -> visible field mappings
  -> schedule, signed webhook, or record-change trigger
  -> non-mutating definition and sample-mapping preview
  -> per-run or exact bounded continuous write authority
  -> inert Platform draft + receipt
  -> exact governed activation request
  -> Automations management surface
```

The work surface shares Operator's existing resizable sidecar with dynamic
canvases. Chat remains available while setup is open. Starting from the
Automations page creates an isolated automation task first, preserving the
previous conversation lane.

## Authority boundary

Desktop projects Platform-owned templates, connections, and active operation
contracts. It does not carry an embedded provider catalog, credential vault,
workflow engine, or approval system.

- OAuth and typed secret collection reuse the existing Connections ceremonies.
- Credentials never enter chat, renderer state, or an Automation definition.
- The renderer submits user-reviewed template parameters to the main process.
- The main process rechecks the current usable connection and active operation
  contract before installation.
- Installation creates a draft only.
- The exact activation arguments returned by Platform remain in main-process
  memory. The renderer receives a display copy, not resubmittable authority.
- Activation uses those untouched server arguments and may park for a company
  decision. Desktop cannot self-approve the pending operation.
- Bounded standing authority is an explicit write-only choice. Desktop validates
  and previews the hourly/daily rate ceiling, lifetime ceiling, expiry, and
  consecutive-failure cutoff; only Platform's signed-in approval execution can
  issue the grant.

Changing account, company, operating boundary, task, or dismissing setup
revokes the transient activation handle.

## Mapping and preview

Destination fields are derived from the selected operation contract's strict
path, query, and body schemas. Each populated row is either:

- an exact typed `trigger.*` reference; or
- an explicit constant JSON value or string.

Required destination fields cannot be skipped. The optional representative
trigger context resolves mappings locally so a user can inspect the resulting
operation payload without calling the external system. Platform validates the
same mapping again when installing and executing the Automation.

## Runtime behavior

The resulting workflow runs through AMOS Platform's deterministic scheduler,
event enrollment, typed mapping, operation-contract, RBAC, policy, approval,
idempotency, and receipt layers. The model helps design and explain the
workflow but is not required while it runs.

Connected writes use per-run governed approval by default. When the live
Platform template advertises the standing-grant contract and the selected
operation is a typed write, Desktop can request bounded continuous operation.
That grant binds the exact tenant, Automation definition/trigger, mapping,
connection, and immutable operation-contract revision. Each claim revalidates
current identity, RBAC, company policy, subscription, limits, expiry, failure
state, and Automation status. Drift or missing authority falls back to per-run
approval; a model outage does not stop a valid deterministic run.

Automations shows live grant status, rate/lifetime/failure counters, expiry,
and revocation. Pause stops future claims. Revoke immediately removes future
authority and requires a newly approved activation to restore it. An external
call already atomically claimed at the same instant may settle and remains
visible in Platform receipts.

Signed webhook selection assumes that the corresponding tenant webhook event
has already been provisioned. Provider-side webhook provisioning is a separate
Platform capability.

## Next production follow-through

The bounded standing-authority slice is implemented across guided authoring,
human approval, deterministic execution, proof, monitoring, and revocation.
The next connector slice is provider-side webhook provisioning plus a clean
API/MCP onboarding path. That lets a software vendor publish typed operations
once while each downstream customer connects and governs its own account. The
vendor application's AWS hosting remains independent of the AMOS execution and
governance contract.
