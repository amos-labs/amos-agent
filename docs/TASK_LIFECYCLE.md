# Streaming, cancellation, and restart-safe tasks

AMOS Desktop 0.11 gives long work a visible and durable lifecycle without
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

- the user's objective;
- attachment filenames, with a reminder to reattach material;
- high-level completed tool names;
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

This design preserves the product invariant: Desktop supplies continuity and
local execution; AMOS remains authoritative for company identity, memory,
policy, approval, idempotency, and proof.
