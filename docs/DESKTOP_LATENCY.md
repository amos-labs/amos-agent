# Desktop latency profile

AMOS Desktop can feel slow even on Opus 5 and Grok 4.6. The receipts and
guardrails are **not** the main cost. The loop is paying **one full
reasoning model round per serial tool cycle**, often with hidden thinking
unstreamed to the UI, on a prompt that changes tool schemas mid-task and
busts prefix cache.

This is a diagnosis, not a claim that governance should be removed. Proof
still happens after the fact. The user-visible stall is almost entirely
**model-turn shape**, not SHA-256 of receipts.

## What a turn actually does

```text
optional local router classify
  → hydrate continuity
  → compile context + prompt contract
  → model.chat (reasoning + tools)     ← usually the entire wait
  → execute tools (parallel only if every call is read-only)
  → append full JSON tool results
  → maybe compact
  → repeat
```

Receipt write (`localReceiptStore.add`) runs when the **task finishes**, not
per token. Context receipts are in-memory hashes for cache accounting. They
are cheap next to a Grok `high` or Opus thinking pass.

## Ranked causes (Opus / Grok)

### 1. One reasoning pass per tool hop (dominant)

`AgentLoop` may execute several **read-only** tools in parallel. Anything
mutating, or mixed with a write, is **serial**, and the model typically emits
one or two tools per response anyway.

A typical online start is still several hops:

`desktop_activate_toolkit` → `amos_get_started` / `amos_whoami` →
`amos_list_engines` → `amos_load_engine_tools` → the actual engine call.

Each hop is a complete Opus/Grok request. Defaults:

| Provider | Default reasoning |
| --- | --- |
| Grok 4.6 | `high` |
| Kimi K3 | `max` |
| Claude (Anthropic) | `medium` |
| Client timeout | 11 minutes (`LONG_RUNNING_MODEL_REQUEST_TIMEOUT_MS`) |

Five hops at high reasoning is minutes before the user sees an answer, even
if each tool is 50 ms of local work.

### 2. Streaming is swallowed on tool turns (makes it *feel* hung)

In `AgentLoop.run`, `onDelta` only stores `partialResponse`. It does **not**
emit `assistant_delta` while the model is thinking or assembling tool calls.
`assistant_delta` fires only when the turn ends **with no tool calls**.

The UI therefore sits on “Understanding the task…” through the entire hidden
reasoning window and tool-argument generation. That is the same stall people
report in Claude Code when thinking is on — except AMOS multiplies it by the
number of tool cycles.

### 3. Prompt-cache bust when toolkits change

The prompt contract hashes **system + tools + toolkits**. Progressive
activation (`desktop_activate_toolkit`) is correct for schema budget and
wrong for cache: the next turn is a full prefill. Continuity prepend and
workflow injection also sit at the front of the user turn.

Fat system prompt (constitution + operator rules) is amortized **only if**
the prefix is stable. Toolkit changes destroy that.

### 4. Coding-role pairing (when enabled)

If intelligence-role pairing is on and the workflow is coding, Desktop
**requires plan → implement → check** (and repair) as separate model
occupancies, often on **different providers**. That is three (or four)
complete agent runs, not one. Pairing is off by default; it is a huge
multiplier when on.

### 5. Fat tool results in the next prompt

Every tool result is `JSON.stringify(result)` in the transcript. Compaction
keeps the last two exact tool blocks and only kicks in after ~32k raw tool
chars. Until then, each reasoning pass re-reads large MCP payloads.

### 6. Extra model calls that are not the user’s task

- Local router classify before the loop (online, when the router is ready).
- Research-checkpoint **assessment** chat, then a human pause, on long tasks.
- Invalid-completion retry (model returned continuity instead of an answer).
- Coding `completionGate` rejecting a turn that skipped
  `desktop_report_coding_stage`.
- Company-memory screenshot description (extra vision call).

These are real, but they are not every interactive turn.

## What is *not* the bottleneck

| Mechanism | Why it is not the Opus/Grok stall |
| --- | --- |
| Local task receipt | Written once at task end |
| Context-compiler receipt | Sync hash + token estimate, milliseconds |
| Approval / policy | Blocks only consequential writes; reads proceed |
| Guarded stop (repeat tools / error cycles) | Ends a runaway; does not slow a healthy turn |
| SHA-256 / digest of events | Not on the model round-trip |
| Parallel-read execution | Already used when every queued tool is `parallelSafe && readOnly` |

Do not strip receipts or authority to “go faster.” That would not move the
needle compared to (1)–(3).

## Shipped (perceived speed)

Keep governance. Change **turn shape and visibility**.

1. **Stream thinking/status during tool turns.** `AgentLoop` forwards
   `assistant_delta` while the model is still choosing tools. Visible text,
   provider thinking (Anthropic `thinking_delta`, Grok/OpenAI
   `reasoning_content`), and the assembling tool name all reach the chat pane.
   Thinking is **not** written into local receipts or checkpoints.
2. **Lower reasoning on gather hops.** The first inspect/bootstrap cycles use
   `low` (or `medium` if `low` is unsupported) instead of Grok `high` / Kimi
   `max`. Synthesis, repair, and later work keep the configured effort.
Still open:

3. **Prefetch a bootstrap bundle.** One host-owned `amos_get_started` snapshot
   (whoami + engines + loaded schemas) so the model does not spend three
   reasoning passes discovering AMOS. That is a harness repair, not a hidden
   solver, if the payload is the same for every candidate.
4. **Stabilize the tool prefix.** Activate the workflow toolkit **before** the
   first model call when the router already classified the family, so the
   prompt contract does not change on hop 2.
5. **Cap tool-result bytes earlier** for MCP list/overview payloads; keep
   exact receipts on disk, not in the next prompt.
6. **Measure.** Per-turn: `model_wait_ms`, `reasoning_tokens`, `tool_ms`,
   `cache_hit_ratio`, `tool_count`, `schema_tokens`. Until those are in the
   local receipt, we are guessing.

## Honest expectation

Claude Code and Codex feel faster because they stream immediately, often run
one coding occupancy, and do not re-bootstrap a company OS every task. AMOS
is doing more **real** work per user message (workflow, tools, continuity,
company engines). That tax should be **one** extra hop, not one extra
reasoning model per file list.

If after streaming + cheaper gather-hops + bootstrap bundle the loop is still
slow, then the remaining cost is Opus/Grok themselves — and Hosted Qwen at
fixed GPU cost becomes the product answer, not thinner guardrails.
