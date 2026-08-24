# AMOS intelligence product

AMOS is a company operating system. Intelligence is a replaceable cortex
behind a fixed law: tools, policy, approvals, and receipts do not change when
the model does.

This document is the product contract for how users choose intelligence. It
does not change Desktop's current `auto` implementation until the hosted
organism cutover lands. Until then, [INTELLIGENCE_PROVIDERS.md](INTELLIGENCE_PROVIDERS.md)
describes the live profiles.

## Nested goals

1. **Pragmatic.** Run AMOS on one owned cortex at a known AWS cost, not on a
   stack of frontier product bills.
2. **Proof.** Public, sealed, same-harness tracks (Opus 5 as the control)
   exist so technical buyers will try Hosted. They are a storefront, not the
   factory. A trained benchmark family is never a grade.
3. **North star.** Verified recursive self-improvement of the research
   organism — accepted lifts that raise future lift per accelerator-hour —
   with the learner never owning the scoreboard. The organism research
   program is tracked separately from this product contract.

Hosted AMOS-native quality on *our* work ships when receipts and dollars per
completed job beat “human + Claude Code.” Beating Fable on SWE-Verified is not
a release gate.

## Three doors

The user chooses a **deployment boundary**, not a model aisle. The same
company context, tools, policy, and proof apply to all three.

| Door | Product name | Who pays inference | What it is |
| --- | --- | --- | --- |
| Hosted | **AMOS Intelligence** | AMOS Labs | Default after sign-in. The AMOS organism on the private Qwen cell. |
| Local | **This computer** | The user's machine | Offline, air-gap, no-company, and local-first work. |
| Bring your key | **Your key** | The user, to their vendor | Bedrock, Claude, Codex/OpenAI, Grok, Kimi, or a compatible endpoint. |

Advanced disclosure may still show provider and model. The happy path does not
ask anyone to pick Qwen vs Opus vs Grok.

Connecting AMOS must not overwrite a working local or BYO configuration.
“Prefer my local and frontier models” remains **opt-in** and off by default.
A local GGUF is eligible only if it passes its signed capability contract.

### Hosted is the organism, not a vendor broker

AMOS Hosted intelligence **is** the pinned AMOS Qwen substrate plus the
governed organism (direct path for easy steps, swarm only when the board
requires it). It is not a silent router that buys Claude, Grok, or Bedrock
when a step looks hard.

- Escalation to frontier models on **AMOS's dime** is not the normal path.
- If a user wants Fable, Opus, Grok, or Codex, they open **Your key**.
- Bedrock and customer vLLM are **customer-cloud / BYO**, not Hosted.
- `auto` inside Hosted means organism routing (direct vs swarm vs later
  specialist adapters), not vendor shopping.
- Receipts may name the digest and organism generation. Marketing does not
  require the user to shop models.

Until that cutover, live Hosted `auto` may still select a qualified managed
route. Do not describe that interim as the fixed-cost organism.

### Local

Local AMOS is the privacy and offline door. It uses the managed Ollama or
llama.cpp runtime on the device. It does not create a second company database
or move integration secrets onto disk.

Hosted remains the availability fallback when local is absent, unqualified, or
offline **and** the user is signed in — unless they are in explicit local-only
mode.

### Your key

BYO is the quality, compliance, and existing-spend valve. Power users will
keep a Fable or Grok key for a long time. That is acceptable. Hosted wins when
AMOS-native work on the owned cell is good enough and cheaper than their key.

Planner / implementer / checker pairing is a BYO coding workflow, orthogonal
to the three doors. It does not change policy or proof.

## Fixed cost

To the customer, Hosted is in the subscription (or a simple hosted SKU). No
per-token anxiety.

To AMOS Labs, a GPU hour is a known burn. That is fixed **for a declared
concurrency**, not for infinite tenants.

- Include a fair-use envelope: concurrent hosted runs, queue when the cell is
  hot, no silent frontier overflow.
- Scale a second GPU only from measured queue time.
- Stop idle inference cells; storage and endpoints still cost money.
- Tenant isolation is of **data and receipts**, not a dedicated GPU per seat.
  Continuous batching on one 27B is the economic trick.

Hosted inference is not training consent. Default remains no-train. Tenant
adapters stay isolated. Shared training is an explicit, reviewed opt-in.

## Why Hosted can still be the better AMOS operator

Frontier models are stronger general reasoners. Hosted wins the product if it
is the only cortex that is fluent at AMOS law: typed tools, proposal versus
host authority, approvals, idempotent recovery, and no success without a
receipt. The Qwen adapter and organism exist to make **that** cheap path good
at AMOS, not to impersonate Fable on public coding boards.

Public tracks (Opus 5 in the **same** harness as generation-N Hosted, with
generation 0 as the floor) are how we show the cheap path is not a toy. They
are not how we price the product.

## Cutover checklist

1. Pin the hosted cortex to the AMOS Qwen digest and organism policy digest.
2. Stop managed vendor overflow as the default Hosted behavior.
3. Keep Local and Your key as first-class advanced doors.
4. Price Hosted as included intelligence with a capacity contract, not as a
   pass-through token markup.
5. Point Desktop `auto` at organism routing once (1)–(2) are true, and update
   [INTELLIGENCE_PROVIDERS.md](INTELLIGENCE_PROVIDERS.md) to match the live
   behavior rather than this destination contract.
