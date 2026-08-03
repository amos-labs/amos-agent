# Streaming, cancellation, and restart-safe tasks

AMOS Desktop gives long work a visible and durable lifecycle without
creating a second source of business authority.

## Streaming and progress

OpenAI-compatible providers are called with streaming enabled. Desktop
incrementally assembles assistant text and structured tool calls while showing
bounded phases in **Live Work**:

- understanding current context;
- evaluating results;
- running a named tool;
- producing the response; and
- completing or stopping safely.

Streaming changes presentation, not authority. A partial response cannot call a
tool or approve an action.

## Steering and progress safeguards

The Operator composer remains available while AMOS works. A submitted direction
joins the same task, receipt, and checkpoint at the next safe boundary: after a
complete assistant response or after every tool call in the current batch has a
corresponding result. The UI confirms both when direction is queued and when the
agent applies it.

AMOS does not stop productive work after a fixed number of tool cycles. It
continues until the task completes or the user stops it. Internal safeguards
only detect repeated identical tool/result cycles and consecutive cycles where
every tool fails. If one fires, AMOS performs a tool-free final synthesis that
states what is established, what remains unresolved, and the best next step.

## Safe cancellation

**Stop safely** aborts the active task signal. That signal reaches:

- the model request and response stream;
- AMOS MCP calls;
- public web fetch and search;
- approved shell commands; and
- local Git and patch subprocesses.

Local process trees receive termination and then forced termination if needed.
AMOS actions that already completed remain represented by their managed
receipts; cancellation does not pretend to roll them back.

## Encrypted checkpoints

Before a personally signed-in online company task begins, Desktop:

1. resolves `whoami`;
2. reads a fresh `resume_company` briefing;
3. pins the exact user and tenant;
4. fingerprints the bounded company-briefing sections; and
5. encrypts the task checkpoint through Electron `safeStorage`.

The checkpoint may contain:

- the user's objective and any directions added while the task was running;
- attachment filenames, with a reminder to reattach material;
- high-level completed tool names;
- structured started, completed, or failed tool state without tool arguments;
- a bounded partial response; and
- phase and timestamp metadata.

It does not contain provider keys, OAuth tokens, managed integration
credentials, raw tool arguments, or replay authority.

Completed tasks delete their checkpoint. Canceled, failed, or interrupted tasks
remain visible under **Decisions**.

API-key and machine-principal sessions are intentionally not restart-resumable
through the personal Desktop flow.

## Resume protocol

**Revalidate & resume** does not run the task. It:

1. requires online company mode and a personal AMOS sign-in;
2. verifies the exact user and tenant from a fresh `whoami`;
3. compares fresh `resume_company` section fingerprints with the checkpoint;
4. reads the current approval queue;
5. reports changed company sections and pending approval count; and
6. fills Operator with a no-replay continuation prompt.

The user reviews that prompt and presses **Run** explicitly. The resumed model
must inspect current sources, receipts, approvals, and policy before doing
anything. Mentioning a completed step in a checkpoint is not proof that its
side effect happened.

Completed sessions also produce a compact typed continuity manifest. It keeps
the latest task state, workflow, action outcomes, receipt and artifact
references, open loops, and model-handoff metadata separate from transcript
history. Desktop compiles only the budgeted subset needed for orientation; the
model must still revalidate current evidence and authority.

For personally signed-in online company work, Desktop also sends a smaller
projection of that manifest to AMOS Platform after successful completion. It
contains state rather than transcript, labels the source client and model, and
uses only a portable workspace basename. Platform stores it privately for that
authenticated user inside that tenant. A fresh Desktop runtime prefers it only
when it is newer than the matching encrypted local record; switching companies
clears every live surface before the target tenant's state is loaded.

This design preserves the product invariant: Desktop supplies continuity and
local execution; AMOS remains authoritative for company identity, memory,
policy, approval, idempotency, and proof.
