# Local frontier intelligence research program

## Thesis

Frontier-quality local intelligence may be approached from two independent
directions that become more valuable when combined:

1. **Run more compressed capacity on smaller hardware.** ExpertCache explores
   how oversized sparse models can execute on Apple Silicon without placing the
   complete expert tensor in the active Metal working set.
2. **Extract more capability from smaller models.** A knowledge-integration
   engine should help a resident model activate, reconcile, and compose
   knowledge that is independently recoverable from its weights but unreliable
   under one-pass autoregressive decoding.

Neither direction alone establishes general frontier parity. The program asks
whether their combination can reach frontier-level outcomes on bounded,
verified workflows while remaining local, private, and economically useful.
AMOS is the product proving ground: it supplies real tool work, governed state,
receipts, corrections, and outcome evidence. Governance remains deterministic
code and is not part of the model-capability claim.

## North star

The ultimate target is:

> GPT-OSS 120B, executing locally through ExpertCache and strengthened by the
> knowledge-integration system, reaches GPT-5.6-Sol-level outcomes on a broad,
> frozen, reproducible suite of agentic work.

“GPT-5.6-Sol-level” means measured parity with a pinned GPT-5.6-Sol control,
not a subjective resemblance or a claim that the checkpoints are equivalent.
The comparison must record model version, reasoning effort, tool surface,
context package, inference budget, retries, and evaluator version. It must grow
from bounded capability domains toward a broad portfolio:

1. recoverable-knowledge integration and cross-domain reasoning;
2. difficult coding with executable verification and repair;
3. long-horizon planning and state revision;
4. unfamiliar tool discovery and dependent tool use;
5. contradictory evidence, provenance, and calibrated abstention; and
6. verified AMOS company workflows.

Quality parity and local performance are separate gates. A system that matches
the control but takes unusable time has achieved a research result, not the
product target. Conversely, fast output that does not match verified outcomes
does not count as intelligence parity.

## The integration hypothesis

Model weights do not contain a directly queryable fact database. They encode
distributed, context-sensitive regularities. A model may demonstrate each fact,
rule, or procedure needed for a problem under separate elicitation and still
fail when it must jointly:

- activate the relevant components;
- discover their relationships;
- resolve conflicts and authority;
- preserve a coherent working belief across steps;
- transfer an abstraction to an unfamiliar setting;
- predict consequences or counterfactuals; and
- revise the synthesis after new evidence.

The operational hypothesis is therefore narrow and falsifiable:

> On tasks where a smaller model independently recovers the required knowledge
> components, a structured activation, reconciliation, composition, prediction,
> and verification procedure can improve combined-task performance.

This is different from retrieval. Retrieval supplies information that may be
absent from the weights or prompt. The integration engine tests whether a
better inference procedure can use knowledge already shown to be recoverable.

## Program architecture

```text
                         local frontier intelligence
                                      |
                 +--------------------+--------------------+
                 |                                         |
       capacity and systems                       integration and inference
          ExpertCache                                  resident model
                 |                                         |
    120B feasibility -> speed              probe -> workspace -> reconcile
                 |                           -> compose -> predict -> verify
                 +--------------------+--------------------+
                                      |
                           AMOS governed workflows
                                      |
                    tools, receipts, corrections, outcomes
```

The resident 20B-class model should remain the interactive actor. An oversized
120B model can serve as a difficult-case planner, teacher, or batched verifier.
ExpertCache experts are computation blocks selected by the model's
authoritative router; they are not treated as independently addressable
semantic records.

## Track A: oversized sparse inference

The current ExpertCache artifact has demonstrated the complete 63.4 GB GPT-OSS
120B MXFP4 checkpoint on a 64 GiB M1 Max, bit-exact tested trajectories,
decision-grade real-prompt prefill improvement from 5.75 to 9.80 tokens/second,
and bounded execution on a physical 16 GiB M1 Pro. Serial decode near three
tokens/second on 64 GiB and 0.72 tokens/second in the bounded 16 GiB gate are
feasibility results, not an interactive product contract.

### Device-class targets

| Device | Intended contract | Initial research target |
| --- | --- | --- |
| 64 GiB Apple Silicon | Interactive planner/reviewer | At least 10 accepted output tokens/second or a workflow-level latency win over resident-only generation plus hosted review, without unbounded swap |
| 32 GiB Apple Silicon | Deliberative local reviewer | At least 3 effective tokens/second on physical hardware with bounded memory pressure and cancellation |
| 16 GiB Apple Silicon | Background, privacy-critical, or bounded review | Improve materially over the measured 0.72 tokens/second while preserving the protected swap, thermal, and wall-time gates |

These are research targets, not published capabilities. The 32 GiB target
requires a physical host. Performance may come from avoiding serial 120B decode
rather than making every raw decode token fast.

### Execution order

1. Complete the registered 64 GiB clean/cold matrix, quality suite, and host
   telemetry so optimizations have a trustworthy baseline.
2. Implement resident 20B draft / 120B batched verification. Measure token
   acceptance, accepted tokens per verifier pass, page demand, wall time, and
   quality against both models alone.
3. Add adaptive speculation length based on acceptance and routed working-set
   growth.
4. Measure expert-layout, mixed-bit expert, reusable-view, and page-fault-guided
   scheduling experiments independently.
5. Harden cancellation, memory-pressure response, thermal limits, and rollback.
6. Repeat protected gates on physical 64, 32, and 16 GiB machines before making
   device-class claims.

The primary decision metric is completed verified work per wall-clock minute,
not raw token throughput in isolation.

## Track B: knowledge integration

### Stage B0 — measurement

Build a versioned benchmark in which every integration case contains:

- independent atomic probes for required knowledge components;
- a combined problem that requires their relationship;
- a deterministic or blinded evaluator;
- paraphrase and surface-perturbation variants;
- a category such as causal, temporal, cross-domain, contradiction,
  counterfactual, or tool planning; and
- latency, generated-token, and inference-pass accounting.

Atomic recovery must be reliable rather than a one-prompt recognition event.
Development cases should use repeated probes and semantically equivalent
surface forms. A frozen case declares its atomic reliability threshold before
the combined-task run.

The primary cross-model metric uses the same full-suite denominator. Also report
**conditional integration accuracy** on the subset where the target model
reliably recovered all required atomic components, but label that subset as a
within-model diagnostic because different models may qualify different cases.
Never infer cross-model parity from model-specific conditional denominators.

Stage B0 contains a deliberately small **elicited-note arm**: independently
probe components, pass the raw responses back without evaluator feedback, and
ask the model to reconcile them. This tests activation and externalization but
is not the full integration engine. It provides a lower-complexity control for
Stage B1.

### Stage B1 — inference-time integration engine

Start without training:

1. discover relevant facets and unknowns;
2. elicit independent knowledge components from distinct perspectives;
3. externalize claims, dependencies, conflicts, confidence, and open questions
   into an inspectable working belief graph;
4. construct candidate relationships and syntheses;
5. predict consequences and falsifiers;
6. verify with deterministic checks, tools, perturbations, or a stronger model;
   and
7. return the smallest synthesis that survives verification.

The workspace contains model beliefs, not AMOS facts or authority. Company
truth continues to come from current authenticated state and receipts.

The explicit workspace engine must be evaluated separately from the
elicited-note control. Its working graph should expose claims, dependencies,
conflicts, open questions, predicted consequences, and verification outcomes;
simply appending correct atomic answers to the final prompt does not satisfy
this stage.

Engine v0 uses a gated, schema-constrained workspace. Every elicited probe must
appear as evidence, every derived claim must name its claim dependencies, and
every claim must distinguish its origin from its applicability to the exact
problem. Structural validation and repair may use parser errors, missing-probe
coverage, and dangling-reference errors, but never answer-key feedback. A final
answer produced from an invalid workspace does not count as a workspace-arm
success.

### Stage B2 — distillation

Collect successful and failed integration trajectories. Train an AMOS Operator
adapter or controller to reproduce useful activation and reconciliation steps
with fewer inference passes. Compare against the explicit engine on held-out
domains and workflow versions.

The first two compact-model treatments now constrain this stage. Rank-16 v0.1
learned its narrow generator but catastrophically regressed broader capability.
Rank-8 v0.2 added 50% capability replay and improved a newly sealed suite from
16/40 to 20/40 at step 150, but scored only raw 8/32 with two critical failures
on the independent original suite. It learned bounded tool, authority, causal,
and exact-grounding patterns; it did not acquire reliable correlated arithmetic,
schedule search, executable algorithms, or complete long-flow synthesis.

Stage B2 therefore proceeds only after an integration-first v0.3 produces
verified multi-turn successes:

1. route probability arithmetic and bounded planning into deterministic local
   calculators or solvers;
2. run code through generate, execute, diagnose, and repair rather than judging
   one-shot source text;
3. derive mandatory receipt fields from schemas and tool results before any
   optional natural-language summary; and
4. distill those successful engine traces while retaining broad replay and two
   independent evaluation suites.

The kill criterion is now system-level: no treatment advances unless it gains
on both independent suites, has no critical receipt failure, improves
executable code after one repair turn, and recovers base decode speed after
adapter merge.

### Stage B3 — learned latent prediction

Only after B1 identifies repeated failures or excessive scaffolding cost,
prototype a JEPA-inspired module. Candidate objectives include:

- predict a withheld relationship or coherent completed-state embedding;
- predict an action-conditioned next-state or outcome embedding;
- keep paraphrases and equivalent evidence packages consistent;
- separate subtly contradictory or impossible states; and
- rank counterfactual futures by verified goal progress.

The learned predictor is a planning and consistency component. It is not
memory, authorization, proof, or a replacement for the language/tool model.

## Track C: AMOS compact local model

The primary product path is a purpose-trained 8–14B AMOS student that fits as a
resident model on a physical 16 GB Apple Silicon Mac. Muse Glimmer 30B becomes
its teacher, local reviewer, and fallback rather than the default interactive
worker. A qualified frontier model remains the final escalation lane.

The first deployment target is approximately 7 GB at four-bit precision with
an 8 GB artifact ceiling, at least 8K context, no critical memory pressure, no
more than 1 GB swap growth during qualification, and at least 10 sustained
decode tokens/second on the physical 16 GB host. The product target is 15
tokens/second while retaining the frozen workflow contract.

Two construction strategies race:

1. distill verified AMOS trajectories into a runtime-native model with mature
   training, Metal, `llama.cpp`, and GGUF support; and
2. create a structurally reduced Muse student through layer or width reduction
   plus representation, logit, trajectory, and outcome distillation.

The runtime-native arm is the default. The Muse-derived arm proceeds only if
its training and export spike avoids custom-kernel debt and early checkpoints
beat the runtime-native arm at equal artifact size.

The training corpus is governed by an executable contract. Synthetic examples
contain no customer data. Product-derived records are disabled unless the
compiler is explicitly authorized and every record is minimized and tied to a
training-consent receipt. Teacher agreement alone cannot create a gold record;
deterministic, executable, or human verification is required. Entire scenario
families belong to one split so surface variants cannot leak into evaluation.

The first base race selected Ministral 3 8B for v0. On the M1 Max its official
5.20 GB Q4_K_M artifact sustained 28.29 decode tok/s, used 1,128 output tokens
on the frozen suite, and scored adjudicated 20/32. Qwen 3.5 9B decoded at 24.74
tok/s but its production-shaped arm scored adjudicated 18/32, failed both
critical tool flows, used 4,719 output tokens, and took 256.38 seconds. Qwen is
retained as a secondary capability/teacher arm, not the initial deployment
base.

Ministral then passed a local QLoRA architecture spike with a 6.84 GB training
peak and a reloadable 89.2 MB adapter. This is a toolchain proof, not a tuned
candidate. The corpus gate now passes with 1,000 verified synthetic training
records and 200 validation records across 600 split-isolated families. Its
registered mix includes authority/idempotency, deterministic constraints,
tool recovery/evidence, executable code/repair, and abstention/escalation.

The training path also passed a tool-aware QLoRA smoke. The adapter explicitly
injects row-level tool definitions into Ministral's native template and rejects
any render missing available-tool, tool-call, or tool-result markers. Four tool
trajectories trained for two steps at a 9.84 GB peak. Neither corpus size nor a
falling two-step loss establishes product quality.

The subsequent rank-16 pilot proved that distinction. It reached 34/36 exact
on unseen synthetic families and reduced held-out loss from 1.133 to 0.023,
but step 200 scored only 12/32 after conservative frozen-suite adjudication and
step 600 fell to 6/32. Both trail the unadapted base at 20/32, and critical
receipt/tool failures remain. Rank 32 is cancelled. The next treatment reduces
rank, rate, and steps; mixes 50% broad verified capability replay with targeted
AMOS trajectories; adds harder probability, causality, scheduling, algorithm,
event-reconciliation, and receipt-grounding families; and selects checkpoints
on behavioral retention as well as target lift. Since frozen v1 has now
informed the redesign, v0.2 also requires a newly sealed evaluation suite.

## Combined experiments

Every benchmark release should compare at least:

| Arm | Question answered |
| --- | --- |
| Resident 20B baseline | What does ordinary local decoding achieve? |
| Resident 20B + raw elicited notes | Does component activation alone improve composition? |
| Resident 20B + explicit workspace integration | How much do relation construction, reconciliation, prediction, and verification add beyond elicitation? |
| ExpertCache 120B | How much does additional compressed capacity contribute? |
| 20B integration + 120B verification | Do the two research directions compound? |
| Qualified frontier control | What practical gap remains? |

Required measurements include atomic coverage, conditional integration
accuracy, verified task outcome, consistency, latency, tokens, memory, thermal
state, and escalation rate. Raw-model, scaffolded-system, and governed-product
results remain separate columns. Model version, reasoning effort, completion
budget, stage-specific reasoning budget, structural repairs, and empty-final
behavior are experimental treatments, not incidental settings.

## Milestones and gates

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| M0 | Thesis, roadmap, and benchmark contract | Claims and boundaries reviewed; benchmark schema versioned |
| M1 | Integration benchmark v0 | At least 50 audited cases across five categories, with atomic and combined evaluators |
| M2 | Explicit integration engine v0 | Paired lift over both baseline and elicited-note controls on a frozen denominator, with a 95% interval and full latency accounting |
| M3 | ExpertCache speculative verifier | Acceptance-adjusted workflow latency beats the resident-plus-existing-review control |
| M4 | Combined local controller | 20B integration + local 120B review closes at least half the measured resident-to-frontier gap on selected workflows |
| M5 | Distilled integration controller | Retains most measured lift with fewer passes and acceptable interactive latency |
| M6 | Latent predictor experiment | Beats explicit and sequence-model controls on held-out integration or planning failures |
| M7 | AMOS shadow deployment | Capability contracts pass without governance regression or false execution claims |

“Closes half the gap” is computed per frozen benchmark and never generalized to
all intelligence. A milestone that fails its gate produces a useful negative
result and redirects the next experiment.

## Immediate execution backlog

1. Replace the brittle exact-substring rationale checks in a new paired-suite
   version, then expand it with observed failures and untouched holdouts.
2. Build consent-safe shortest-correct Muse trajectories for the routine and
   bounded-balanced AMOS lanes, including tool recovery and escalation.
3. Measure base, deterministic-tool, elicited-note, and explicit-workspace arms
   only on repeatable local failure families.
4. Build the v0.2 capability-preserving mix and a new sealed suite, then train
   a lower-pressure rank-8 treatment with 50-step behavioral checkpoints.
   Promote no checkpoint that regresses the separate preservation suite, even
   if target loss improves. Keep Muse-derived training as a challenger, not
   the critical path.
5. Re-run the quantized adapted model against the frozen Sonnet and Haiku
   controls with quality, output-token, latency, and critical-safety gates.
6. Continue the registered ExpertCache 120B speed experiments independently;
   do not transfer sparse-expert cache mechanisms to dense Muse.
7. Select the first AMOS shadow workflows only after the benchmark identifies
   a repeatable lift and cost envelope.

## Research integrity

- Do not equate recoverable probe answers with a literal fact stored in one
  parameter or expert.
- Do not select benchmark cases after observing the final comparison arms.
- Keep development, frozen evaluation, and product qualification sets distinct.
- Publish negative results and inference cost alongside gains.
- Treat stronger-model judgments as labels only when independently audited or
  deterministically verified.
- Never expose evaluator pass/fail status, expected labels, or hidden rationale
  checks to an intervention arm.
- Pre-register the primary denominator and paired analysis before running the
  final comparison models; conditional subsets remain diagnostic.
- Require tenant consent and isolation before operational traces enter any
  training corpus.
