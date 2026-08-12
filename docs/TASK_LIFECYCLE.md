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

## Projects and supervised work

Projects are durable, user-private operating areas supplied by AMOS Platform.
They group tasks, bounded orientation instructions, portable resource
references, and default token, cost, tool-call, wall-time, and parallel-run
ceilings. They do not copy task transcripts and do not grant approval or
execution authority.

The Desktop **Activity Center** projects the Platform task-run inbox across all
Projects. It shows bounded progress, cumulative usage, stalled work, budget
ceilings, and cooperative stop controls. A task-run record is coordination
metadata, not evidence that an external effect occurred; governed receipts
remain the proof source for every business action.

Desktop now uses a bounded multi-run manager. The Operator is the selected run,
not the only run: opening or creating another conversation leaves the previous
worker active in the background. Each run isolates:

- cancellation and steering queues;
- model/runtime selection and streamed output;
- attachments, canvas state, and browser sessions;
- approval prompts and pending local operations;
- checkpoints, continuity manifests, usage, and receipts; and
- the monotonic Platform heartbeat/report sequence.

Platform atomically admits Project-backed work under that Project's parallel
ceiling. Desktop sends monotonic progress and 30-second heartbeats with
cumulative token, cost, and tool-call usage. Explicit cancellation or an
exhausted Platform budget returns `continue: false`; Desktop cooperatively
aborts only that worker and then acknowledges its terminal state so capacity is
released. Personal tasks use the same isolated local manager without creating
Platform coordination records.

The concurrency contract is covered by four simultaneous tasks across two
Projects, independently admitted at two lanes per Project. Streaming events,
steering, cancellation, canvases, approvals, continuity, and completion are
bound to their originating task; a background completion cannot write into the
conversation currently visible in Operator. Relaunch still recovers
non-terminal workers as interrupted work that requires revalidation—never
silently replaying them.

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

AMOS-hosted model calls allow up to 11 minutes on Desktop, with the platform
returning first inside that boundary. Long tasks retain up to 224 complete
model-message blocks before compacting older tool activity and allow up to
32,768 completion tokens. These are per-call/context limits rather than a
license to push bulk records through a prompt: large datasets should run in a
bounded deterministic job and return compact evidence, aggregates, and
artifact references to the model.

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
