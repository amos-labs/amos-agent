# Muse local intelligence from first principles

## The objective

The product objective is not to make a 30B model indistinguishable from a
frontier model on every prompt. It is to make the complete local AMOS system
reach the same verified outcome on the largest safe portion of AMOS work, at a
latency users will accept, while escalating the remainder.

This creates three separate claims that must not be collapsed:

1. **Model capability:** can Muse solve the task without assistance?
2. **Integrated-system capability:** can Muse plus AMOS memory, tools,
   decomposition, verification, and repair solve it?
3. **Product coverage:** what fraction of real traffic can that system handle
   within quality, safety, and latency gates?

The August 12 paired diagnostic produced a strong initial capability signal:
Muse, Sonnet, and Muse with DFlash each reached 32/32 after symmetric human
adjudication of exact-keyword scorer false negatives. That is not yet a
production parity claim, but it makes adaptation worth pursuing.

## 1. The physical inference system

Muse Glimmer is a dense transformer. The evaluated GGUF contains approximately
27.9 billion parameters compressed into 16.8 GB across 52 layers. Dense means
that every generated token uses the whole transformer; there is no sparse
expert working set to cache as there is in GPT-OSS 120B.

For one request, latency is approximately:

```text
request latency
  = prompt ingestion
  + generated tokens / sustained decode rate
  + tool, queue, and orchestration overhead
```

Prompt ingestion is parallel across many input tokens. Autoregressive decode is
serial because the next token depends on all preceding tokens. On the physical
M1 Max, the pinned runtime processed prompts at roughly 60–95 tokens/second but
sustained only 7.19 generated tokens/second across the paired suite. The plain
Muse arm generated 3,873 tokens over 18 calls, so serial generation dominated
its 593 seconds of request time.

This yields three multiplicative speed levers:

1. increase generated tokens per second;
2. reduce the number of generated tokens needed for a verified outcome; and
3. avoid model calls when cached state or deterministic computation is enough.

The second and third levers are part of the intelligence architecture, not just
runtime engineering.

### Why GPT-OSS ExpertCache mechanisms do not copy directly

ExpertCache exploits GPT-OSS's mixture-of-experts structure. Direct selected-
expert views, expert grouping, route prediction, expert prefetch, and expert
residency policies operate on sparse expert tensors. Muse has no routed expert
tensors, so those mechanisms have no corresponding unit to cache.

The experimental discipline does transfer: frozen workloads, cold/warm and
counterbalanced treatments, sustained rather than burst throughput, artifact
hashes, memory and power controls, and rejection of optimizations that lose on
physical hardware.

### How DFlash is supposed to work

Ordinary decoding asks the full target model for one next token at a time.
DFlash adds a 1.6 GB draft network that proposes a block of up to 16 future
tokens. The target verifies the proposal in parallel and accepts the matching
prefix. If many draft tokens are accepted, one expensive target pass advances
several tokens. If few are accepted, drafting and verification add work without
enough forward progress.

Its break-even condition is conceptually:

```text
accepted tokens per verification pass
  > draft overhead + larger verification cost + added memory/thermal cost
```

The first M1 Max treatment failed this condition. Compared with plain Muse,
DFlash produced 6.7% more output tokens, reduced measured decode throughput
from 7.19 to 6.31 tokens/second, and increased request time from 593 to 713
seconds. It is therefore rejected for the pinned M1 Max configuration. It may
still win on a newer runtime, different Apple generation, another workload, or
a drafter adapted to AMOS trajectories.

## 2. The integration problem

Weights are not a directly queryable fact database. They encode distributed,
context-dependent regularities. A model can recover every ingredient of an
answer independently yet fail to activate, reconcile, and compose them in one
generation.

The integration engine should make that composition explicit:

```text
request
  -> classify task and risk
  -> load the smallest authoritative context
  -> identify facts, unknowns, and dependencies
  -> delegate deterministic subproblems to tools
  -> construct a candidate plan or answer
  -> verify state transitions and claims
  -> repair once when the failure is understood
  -> answer locally or escalate with the evidence collected
```

The division of labor is important:

- Muse interprets language, plans, selects tools, and synthesizes results.
- AMOS supplies current authenticated state, tenant boundaries, policy,
  receipts, and idempotency.
- Deterministic tools perform arithmetic, lookup, schema validation, code tests,
  and state-transition checks.
- A verifier checks the parts that can be checked and prevents confident false
  success.
- The router escalates when evidence is insufficient, consequences are high,
  or local repair repeatedly fails.

This can make a smaller model produce stronger outcomes without pretending the
scaffold changed the model's raw general intelligence.

## 3. Distillation and fine-tuning

The highest-value target is not generic imitation of Sonnet. It is the shortest
correct AMOS trajectory for each qualified task class.

A training example should capture:

- the typed route and risk class;
- the minimal, consent-safe context package;
- the necessary decomposition or working state;
- exact tool calls and tool-result handling;
- recovery from stale or rejected operations;
- verifier outcomes;
- a concise final response; and
- an escalation decision when the local lane should stop.

There are four complementary adaptation targets:

1. **Response distillation** teaches concise, correct final answers and stable
   schemas.
2. **Trajectory distillation** teaches tool selection, ordering, repair, and
   evidence integration.
3. **Preference training** distinguishes safe, verified, concise trajectories
   from verbose, brittle, or falsely confident alternatives.
4. **Routing and abstention distillation** teaches which tasks should remain
   local and which should escalate before an unsafe action or wasted decode.

Training must use the full-precision training checkpoint or a supported adapter
path; the evaluated GGUF is the deployment artifact, not the source to fine-
tune directly. The adapted model must then be merged, quantized, and re-run
through the exact same model-only and integrated gates. A gain before
quantization does not count as a deployable gain until it survives export.

### Why adaptation can improve speed as well as quality

At 7.19 generated tokens/second, every unnecessary 100 tokens costs about 14
seconds. Teaching Muse to emit a 150-token verified trajectory instead of a
500-token wandering trajectory can matter more than a small kernel win.

If adaptation halves generated tokens and a later runtime improvement raises
decode speed by 1.3x, their idealized effects multiply to roughly a 2.6x decode-
latency improvement. Tool shortcuts and avoided calls compound again.

A future AMOS-specific drafter is also possible: if generic DFlash predicts
agentic continuations poorly, a drafter trained on AMOS's tool syntax and
trajectory distribution may obtain a higher accepted-token rate. That is a
later experiment, after concise target trajectories exist.

## 4. The learning loop

The product and research loops can reinforce each other without training on raw
customer work by default:

```text
consented or synthetic task
  -> local Muse attempt
  -> deterministic and human verification
  -> stronger-model repair only when needed
  -> audited gold trajectory
  -> adapter / preference / router training
  -> quantized candidate
  -> frozen offline qualification
  -> bounded shadow traffic
```

Failures should be labeled by cause, because each cause implies a different
solution:

| Failure family | First intervention |
| --- | --- |
| Missing current fact | retrieval or authoritative state, not tuning |
| Arithmetic or constraint error | deterministic solver or executable check |
| Known pieces not composed | integration workspace or trajectory training |
| Wrong tool or order | tool-trajectory distillation |
| Excessive reasoning | concise trajectory distillation and completion budget |
| False confidence | abstention training and verifier-gated escalation |
| Slow tokens | runtime, quantization, kernel, and hardware experiments |
| Poor speculative acceptance | workload-specific drafter or no speculation |

## 5. Immediate experiment sequence

1. Repair the paired evaluator in a new suite version and expand the sealed set
   with genuinely discriminating cases rather than exact-wording traps.
2. Replay a consent-safe sample of routine and balanced routes through Muse and
   the current controls, recording verified outcomes, output tokens, latency,
   repairs, and escalation decisions.
3. Add inference-time integration only to observed failure families. Compare
   base, elicited-note, explicit-workspace, and deterministic-tool arms.
4. Create a small audited corpus of shortest-correct trajectories, including
   negative examples and required escalation.
5. Run the Muse adapter/export compatibility spike, then supervised adaptation
   and preference training as separately measured treatments.
6. Quantize the adapted model and repeat model-only, integrated, critical-
   safety, and sustained-speed gates on physical hardware.
7. Shadow only workflows that meet both parity and latency gates. Keep hosted
   fallback until local false-success and escalation calibration are measured.

The primary product metric is verified local work completed per wall-clock
minute. Raw benchmark accuracy, raw tokens/second, and percentage of calls kept
local are diagnostics supporting that outcome, not substitutes for it.
