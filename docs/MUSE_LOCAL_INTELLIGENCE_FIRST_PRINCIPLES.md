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

### Program decision — August 12, 2026

The primary product path is now a compact AMOS-specific student, not continued
optimization of the unchanged 30B target. Muse remains the capability teacher,
local reviewer/fallback, and regression control. Dense Muse runtime work
continues only when a bounded experiment has a plausible path to a material
gain.

The student contract is deliberately physical:

| Property | Gate |
| --- | ---: |
| Primary deployment host | physical 16 GB Apple Silicon Mac |
| Target quantized artifact | approximately 7 GB |
| Hard artifact ceiling | 8 GB |
| Minimum context | 8,192 tokens |
| Maximum qualification swap growth | 1 GB |
| Initial 16 GB speed floor | 10 sustained decode tok/s |
| 16 GB product target | 15 sustained decode tok/s |
| M1 Max development target | 15 sustained decode tok/s |
| Output-token target | at most 60% of plain Muse on matched verified work |

Two students race under the same contract: a runtime-native 8–14B model with a
mature Metal/training/export path, and a structurally reduced Muse derivative.
The Muse-derived arm continues only if it can be trained and exported without a
long-lived private runtime fork and beats the runtime-native arm at equal
artifact size.

### First base race and training proof — August 12, 2026

Ministral 3 8B is the selected v0 runtime-native student base. Its official
5.20 GB Q4_K_M artifact sustained 28.29 decode tok/s on the M1 Max and completed
the frozen AMOS suite in 83.42 seconds with 1,128 output tokens. It scored raw
14/32 and adjudicated 20/32. The remaining failures—correlated Bayes, deadline
feasibility, receipt-complete reporting, and executable portfolio code—are
specific verified teaching targets, not evidence of parity.

Qwen 3.5 9B cleared the native speed screen at 24.74 tok/s but lost the product
comparison. Its non-thinking arm scored raw 12/32 and adjudicated 18/32, failed
both critical tool flows, emitted 4,719 output tokens, and required 256.38
seconds. Thinking mode fixed two generic reasoning cases only after 156–185
seconds per case and still failed the authority/receipt case. Qwen remains a
secondary teacher/capability experiment rather than the v0 student base.

The Ministral path also passed a complete local QLoRA compatibility spike with
`mlx-vlm` 0.6.12: 22.28 million LoRA parameters trained for two steps at a 6.84
GB peak, the 89.2 MB adapter saved, and the adapter reloaded for correct local
inference at 29.34 tok/s. This proves the architecture and toolchain can train;
three examples and two gradient steps make no quality claim.

The first corpus gate is now met. A deterministic generator produces 1,000
training and 200 validation trajectories across 600 whole-split scenario
families, with the registered 25/25/20/15/15 skill mix. The corpus contains 660
complete tool trajectories, 180 executably checked code trajectories, and 90
bug-repair prompts. It is entirely synthetic and contains no customer records.
Its frozen dataset identity is
`e91df542b734f363dd1abbd02cd5d2e08eb1c3efae248d19fe9a0d7eefabfe95`.

A second two-step QLoRA spike closed a trainer correctness gap: stock
`mlx-vlm` preserved tool-call messages but did not pass each row's tool
definitions into Ministral's chat template. The AMOS wrapper now fails closed
unless the native available-tool, tool-call, and tool-result markers are all
present. Four complete tool trajectories trained successfully with loss
1.08→0.40, held-out loss 1.06→0.35, and 9.84 GB peak memory. This remains
compatibility evidence, not a quality or physical-16-GB claim.

### First rank-16 treatment: narrow learning, broad regression

The first 1,000-step rank-16 treatment trained successfully at an 11.47 GB
peak. Synthetic held-out loss fell from 1.133 to 0.023, and the step-600
checkpoint completed 34/36 exact unseen synthetic trajectories versus 0/36
for the unadapted base. It reproduced native tool calls, dependent recovery,
concise final reports, and executable micro-code on that distribution.

The frozen suite rejected the treatment. Step 200 scored raw 6/32 and a
conservative adjudicated 12/32; step 600 fell to raw 0/32 and conservative
adjudicated 6/32. The unadapted base remains adjudicated 20/32. Bayes,
deadline optimization, and both hard code tasks still failed; step 600 also
regressed the stale-reference final report, while idempotent approval still
omitted proposal ID P12. Rank 32 is therefore cancelled.

This result changes the training thesis in an important way: low validation
loss on a narrow synthetic distribution measures imitation of that generator,
not retained intelligence. The next treatment uses lower-rank/lower-rate
adaptation, 50% broad verified capability replay, harder diverse reasoning and
algorithmic families, exact receipt/value grounding, and dual early stopping
on target lift plus capability retention. A newly sealed suite is required
because frozen v1 has now informed the next design.

### Rank-8 retention treatment: partial lift, integration boundary found

The v0.2 treatment implemented that correction with 2,000 training and 400
validation trajectories across 1,200 isolated families. Its mix was 50% broad
capability replay, 25% AMOS tools and authority, 15% hard code, and 10% exact
receipt/value grounding. Rank 8, a 1e-5 learning rate, and 50-step checkpoints
kept peak training memory at 13.02 GB. The untouched base scored 16/40 on a new
suite frozen before corpus generation. Step 150 improved to 20/40 with no
critical failures; step 300 regressed to 18/40 despite a lower validation loss.

This is progress, but not promotion. On the independent original suite, step
150 scored only raw 8/32 and failed both critical final-report contracts. On 39
held-out generated trajectories it was exact on 21: perfect for collider and
Simpson reasoning, fencing, escalation, idempotent proposals, and exact value
grounding, but zero-exact for correlated Bayes, deadline optimization, three
hard-code families, and long recovery synthesis. Some exact misses were benign
paraphrases, but the arithmetic, schedule, and code errors were substantive.

The next move is therefore integration-first, not a larger SFT sweep. The
resident model should express the problem and choose tools; deterministic local
calculators and bounded optimizers should perform arithmetic and search; code
should run through generate-test-repair; and required receipt fields should be
rendered from schema before prose compression. Successful multi-turn verified
trajectories can then be distilled back into the compact model. This preserves
the central hypothesis: useful local intelligence is a property of the model
plus its integration procedure, not parameter count alone.

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

1. Generate and validate family-isolated synthetic AMOS trajectories under the
   executable data contract; teacher agreement alone never creates a gold
   record.
2. Repair the paired evaluator in a new suite version and expand the sealed set
   with genuinely discriminating cases rather than exact-wording traps.
3. Replay a consent-safe sample of routine and balanced routes through Muse and
   the current controls, recording verified outcomes, output tokens, latency,
   repairs, and escalation decisions.
4. Add inference-time integration only to observed failure families. Compare
   base, elicited-note, explicit-workspace, and deterministic-tool arms.
5. Create a small audited corpus of shortest-correct trajectories, including
   negative examples and required escalation.
6. Treat Ministral 3 8B as the selected v0 base; keep Qwen 3.5 9B as a secondary
   teacher/capability challenger and defer the Muse-derived arm until its export
   economics can beat the working runtime-native path.
7. Run supervised adaptation and preference training as separately measured
   treatments.
8. Quantize the adapted model and repeat model-only, integrated, critical-
   safety, and sustained-speed gates on physical hardware.
9. Shadow only workflows that meet both parity and latency gates. Keep hosted
   fallback until local false-success and escalation calibration are measured.

The primary product metric is verified local work completed per wall-clock
minute. Raw benchmark accuracy, raw tokens/second, and percentage of calls kept
local are diagnostics supporting that outcome, not substitutes for it.
