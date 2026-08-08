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

The primary metric is **conditional integration accuracy**: combined-task
accuracy on the subset where all required atomic probes passed. Report atomic
coverage separately. Never claim an integration failure when the prerequisite
knowledge was not recovered.

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

### Stage B2 — distillation

Collect successful and failed integration trajectories. Train an AMOS Operator
adapter or controller to reproduce useful activation and reconciliation steps
with fewer inference passes. Compare against the explicit engine on held-out
domains and workflow versions.

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

## Combined experiments

Every benchmark release should compare at least:

| Arm | Question answered |
| --- | --- |
| Resident 20B baseline | What does ordinary local decoding achieve? |
| Resident 20B + explicit integration | How much recoverable knowledge can a better inference procedure unlock? |
| ExpertCache 120B | How much does additional compressed capacity contribute? |
| 20B integration + 120B verification | Do the two research directions compound? |
| Qualified frontier control | What practical gap remains? |

Required measurements include atomic coverage, conditional integration
accuracy, verified task outcome, consistency, latency, tokens, memory, thermal
state, and escalation rate. Raw-model, scaffolded-system, and governed-product
results remain separate columns.

## Milestones and gates

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| M0 | Thesis, roadmap, and benchmark contract | Claims and boundaries reviewed; benchmark schema versioned |
| M1 | Integration benchmark v0 | At least 50 audited cases across five categories, with atomic and combined evaluators |
| M2 | Explicit integration engine v0 | Statistically useful lift in conditional integration accuracy with full latency accounting |
| M3 | ExpertCache speculative verifier | Acceptance-adjusted workflow latency beats the resident-plus-existing-review control |
| M4 | Combined local controller | 20B integration + local 120B review closes at least half the measured resident-to-frontier gap on selected workflows |
| M5 | Distilled integration controller | Retains most measured lift with fewer passes and acceptable interactive latency |
| M6 | Latent predictor experiment | Beats explicit and sequence-model controls on held-out integration or planning failures |
| M7 | AMOS shadow deployment | Capability contracts pass without governance regression or false execution claims |

“Closes half the gap” is computed per frozen benchmark and never generalized to
all intelligence. A milestone that fails its gate produces a useful negative
result and redirects the next experiment.

## Immediate execution backlog

1. Land the benchmark schema, deterministic evaluator, and first diagnostic
   fixtures.
2. Run baseline and explicit-integration arms on GPT-OSS 20B.
3. Audit cases where all atomic probes pass but synthesis fails.
4. Expand to 50 cases using those observed failure modes, not generated volume
   alone.
5. Run the same frozen cases through ExpertCache 120B and a frontier control.
6. In parallel, implement the registered 20B-draft/120B-verify experiment in
   ExpertCache.
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
- Require tenant consent and isolation before operational traces enter any
  training corpus.
