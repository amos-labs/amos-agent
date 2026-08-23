# AMOS recursive intelligence program

## Program decision

AMOS Labs will pursue a recursively improving AI research system whose first
economic environment is AMOS and whose long-term objective is frontier-general
intelligence.

The program does **not** assume that a fixed Qwen swarm, one teacher model, or
one large pretraining run is the winning architecture. The unit that improves
is the complete research organism:

```text
models + agent runtime + tools + data + evaluators + trainers
       + experiment memory + compute allocation + human governance
```

AMOS supplies real work, authenticated state, tool receipts, corrections, and
business outcomes. A separate scientific portfolio prevents the program from
overfitting to company operations. Model weights, scaffolds, training recipes,
and inference strategies remain replaceable experimental components.

## North star

Build the fastest trustworthy learning system, measured as:

```text
verified capability gained
---------------------------------
accelerator hours x calendar time
```

The long-term win condition is a model and runtime that outperform the best
available frontier controls across a broad, frozen portfolio of reasoning,
research, coding, multimodal, tool-use, long-horizon, calibration, robustness,
and efficiency evaluations.

Before that claim is available, the program advances through narrower,
falsifiable gates. “Frontier” always means parity or superiority against a
pinned control under a declared inference, time, tool, and cost budget. It
never means subjective answer resemblance.

## Program laws

1. **The learner never owns its scoreboard.** Research agents cannot change
   sealed evaluations, promotion rules, budget ceilings, audit history, or
   production authority.
2. **Only verified improvement compounds.** A persuasive research report is
   not an improvement. Code, weights, or data must reproduce a measured lift.
3. **Generalization is the gate.** Development-score gains do not promote a
   candidate that regresses on sealed tasks, new domains, or safety canaries.
4. **Capability and authority remain separate.** A more capable model never
   receives credentials, approval power, or production deployment authority
   merely because it improved an evaluation.
5. **Models are components, not identities.** Qwen, Kimi, DeepSeek, GPT-OSS,
   frontier APIs, and future checkpoints compete through capability contracts.
6. **Real outcomes outrank synthetic agreement.** Tool receipts, executable
   tests, environment state, and downstream outcomes outrank model votes.
7. **Research rights are explicit.** Every datum and teacher output carries a
   permitted-use record. Availability through an API is not training consent.
8. **Negative results are retained.** Failed experiments, crashes, regressions,
   and evaluator exploits become searchable research evidence.
9. **Compute follows evidence.** No phase receives a larger compute envelope
   until the preceding phase demonstrates a reproducible improvement slope.
10. **Production is not the laboratory.** Self-modification occurs in isolated
    experiments. Promotion is versioned, reversible, and independently gated.

## The two coupled flywheels

### Economic flywheel: AMOS

AMOS performs real governed work and produces consent-aware experience:

```text
objective -> context -> plan -> calls -> policy -> execution -> receipt
          -> correction -> downstream outcome
```

This flywheel should first create the best company-operating intelligence per
unit of cost and human attention. Revenue finances the research program.

### Scientific flywheel: general capability

The scientific portfolio targets capabilities that do not reduce to AMOS:

- software engineering and executable repair;
- mathematics and formal reasoning;
- scientific hypothesis generation and experiment design;
- multimodal understanding;
- unfamiliar tool acquisition;
- long-horizon planning and recovery;
- uncertainty calibration and contradiction handling;
- adversarial robustness and evaluator-gaming resistance; and
- automated AI research itself.

The two flywheels share infrastructure and verified learning methods, but keep
separate evaluation denominators.

## Nested organism architecture

This program is the micro-scale continuation of the original AMOS organism
thesis, not a separate metaphor.

The early `amos-automate` design described a bounded autonomous economic
organism that senses external demand, commissions work, verifies outcomes,
updates trust, reinvests its metabolism, and repeats. The managed platform made
that macro loop operational as:

```text
goal -> observation -> proposal -> approval -> action/effect
     -> measurement -> keep/discard/revert
```

The recursive-intelligence program applies the same control loop to the
organism's cognitive machinery:

```text
capability goal -> failure/observation -> research proposal -> approval
                -> experiment/training -> evaluation
                -> promote/discard/revert
```

The architecture is therefore nested:

| Scale | Organism | Fitness signal | Effectors | Heritable artifact |
| --- | --- | --- | --- | --- |
| Cell | One experiment | pre-registered metric and reproduction | one patch, data change, training or inference run | experiment record and artifact |
| Organ | Research/model system | sealed capability portfolio | research agents, trainers, evaluators | promoted runtime, dataset, recipe or checkpoint |
| Organism | One company brain | governed company outcomes | goals, missions, humans, models and connected tools | reusable engine, workflow, adapter or policy |
| Ecosystem | Open agent economy | externally purchased, independently verified work | companies, providers, humans and agents | portable proof receipt, reputation and package |

Each scale has local state and a local fitness function, but all scales use the
same constitutional pattern: intent, bounded authority, declared validation,
execution evidence, independent judgment, measured outcome, and reversible
retention.

### Functional correspondence

| Organism function | Macro AMOS company/economy | Micro research organism |
| --- | --- | --- |
| Sensory system | company metrics, external demand, connected-system state | evaluations, traces, failures, anomalies, literature and experiment results |
| Nervous system | policy, company gate, goal contracts, receipt graph | evaluation constitution, experiment scheduler, promotion and rollback gates |
| Metabolism | customer revenue, treasury and operating budgets | compute, data, model access, engineering time and capital |
| Executive function | owner, council, goals and mission planner | research orchestrator, portfolio allocator and human promotion owner |
| Effectors | humans, agents, engines and connected tools | coding agents, data pipelines, trainers, inference runtimes and evaluators |
| Memory | company brain, proof ledger and reusable packages | experiment ledger, datasets, artifacts, failures and candidate lineage |
| Adaptation | interventions, automations, engines and operating changes | runtime mutations, curricula, adapters, training recipes and model weights |
| Reproduction | reusable packages, providers, tenants and spin-outs | new specialists, research agents, checkpoints and independent lab instances |

### Cross-scale flow

The macro organism provides ecological grounding and resources to the micro
organism. The micro organism improves the cognition available to the macro
organism. Verified improvements can then propagate outward as open models,
packages, evaluation methods, or proof-carrying capabilities:

```text
external world
    -> AMOS companies create real demand and proof receipts
        -> research organism identifies repeated cognitive limits
            -> experiments improve runtime, training, or models
                -> qualified intelligence returns to AMOS companies
                    -> better outcomes create more demand and research capacity
```

This closes the gap that the original thesis identified as load-bearing: a
self-improving system cannot learn only from its own outputs. AMOS company work
provides external economic signal; the general scientific portfolio provides
independent reality checks beyond business software.

## Qwen swarm and model-level target

The Qwen swarm is the first concrete cognition architecture for the program,
not a temporary demo that disappears when training begins. It evolves through
three forms while retaining the same evidence and evaluation contracts.

### Swarm Mode v0: logical agents over one backbone

Direct Qwen remains the low-latency default. A complexity/budget router may
send harder work to a maximum of three logical workers:

1. an explorer that finds hypotheses and missing evidence;
2. a builder/domain specialist that develops the candidate solution; and
3. a skeptic/verifier that challenges claims, runs checks, and prepares the
   integration evidence.

A deterministic mission compiler gives each worker a typed work unit. Workers
coordinate through one typed evidence board containing claims, sources,
artifacts, tests, uncertainty, conflicts, and completion state—not through an
unbounded shared chat transcript. A verifier/integrator produces the final
answer only from board entries and execution receipts that survive challenge.

On a Mac, these workers share one loaded Qwen 27B checkpoint, runtime, prefix
cache, and KV infrastructure. They are distinct contexts and roles, not three
copies of the weights. In AWS, the same worker contract uses one private vLLM
endpoint with continuous batching; workers fan out physically only when
measured parallelism justifies another replica.

The first contest is pre-registered and blind: direct Qwen versus Qwen Swarm
versus a pinned Opus 5 control on complex research, finance, planning, and build
tasks. Reports show both unconstrained quality and matched time/token/cost
results. A swarm win that merely spends three times the inference budget is
reported honestly rather than collapsed into one score.

### Specialist swarm: shared backbone plus adapters

Once successful and failed trajectories are verified and rights-cleared, the
logical roles become learned specialists. One shared Qwen backbone exposes
role-specific LoRA/adaptor experts for exploration, tool use, construction,
verification, recovery, and integration. A learned phase router selects the
smallest sufficient expert set and reasoning depth under the mission budget.
The base weights remain shared; adapters are loaded, composed, or batched
without multiplying the full 27B residency.

Frontier models may grade, teach, or generate candidates only when their terms
explicitly permit the intended use. Rights-approved open-weight models, AMOS-
owned outcomes, deterministic verifiers, and explicitly licensed teachers are
the durable training sources. Provider output access alone never implies a
right to train a competing model.

### Model-level organism

The ambitious target is an agentic mixture of experts with persistent governed
state:

- shared recurrent workspace tokens encode the evidence-board state between
  phases without granting the model authority over the authoritative ledger;
- specialist adapters or native experts activate by task phase;
- confidence, disagreement, novelty, and remaining budget determine reasoning
  depth, branching, and stopping;
- successful AMOS mission traces and externally verified outcomes train the
  policy; and
- expensive swarm solutions are distilled back into a faster direct-model
  path, while irreducibly hard work continues to use the swarm.

This is the program's compounding loop: scaffold improvements create better
trajectories; trajectories create better specialists and routing; specialists
make the swarm cheaper and stronger; distillation raises the direct baseline;
and the stronger baseline searches for the next model and architecture gains.
The evaluation constitution, not any worker or router, decides what survives.

## One proof-carrying learning protocol

Do not create a second conceptual protocol for model research. Generalize the
earlier AMOS `ExperimentProposal`, proof receipt, and `ImpactOutcome` primitives
into a shared learning envelope.

### Canonical learning chain

```text
Observation
  -> ExperimentProposal
      -> approved budget, scope, duration, predictions and rollback
          -> ExecutionReceipts
              -> ImpactOutcome
                  -> challenge/reproduction
                      -> keep, discard, quarantine or revert
```

The domain payload changes by scale, while the lifecycle remains consistent:

| Field | Company intervention | Model/research experiment |
| --- | --- | --- |
| Hypothesis | action should move a business metric | change should improve a capability or efficiency metric |
| Supporting observations | company evidence packets and performance gaps | failures, ablations, prior experiments and research evidence |
| Proposed actions | governed tools, tasks or automations | code patch, data recipe, training run or inference treatment |
| Budget | money, API credits, actions and wall time | accelerator hours, tokens, API cost, storage and wall time |
| Success criteria | pre-registered business movement | development and validation movement plus sealed promotion floors |
| Risk | consequence class and company authority | editable surface, capability level, containment and dual-use risk |
| Rollback | reverse or disable the intervention | restore parent artifact, runtime, dataset and capability contract |
| Outcome | measured company effect and attribution method | reproduced capability/efficiency effect and generalization evidence |

Every research candidate therefore produces ordinary proof-carrying work. The
research system does not receive a special exemption from the rules it is
trying to improve.

### Open protocol, protected evaluation

The original north star requires an open receipt schema and open proof gate.
Research integrity requires hidden evaluation instances. These are compatible:

- publish the evaluation contract, receipt format, scoring methodology,
  promotion rules, and verifier implementations where safe;
- protect sealed task instances, labels, customer-private evidence, credentials,
  and contamination canaries; and
- export signed aggregate evidence and portable reputation without exporting
  protected contents.

The rules of the game remain inspectable and forkable; the unrevealed exam and
private company state remain protected.

## System boundary

```text
                         immutable evaluation constitution
                  budgets | sealed suites | policy | audit | rollback
                                         |
 real environments -> experience ledger -> research orchestrator
                                         |
                          propose experiments and allocate trials
                                         |
                 isolated code / data / training / inference sandboxes
                                         |
                             candidate artifacts and reports
                                         |
                      independent reproduction and evaluation
                                         |
                 reject and learn <- promotion gate -> candidate registry
                                                        |
                                             shadow -> canary -> production
```

The governance kernel stores suite hashes, data rights, environment identity,
random seeds, compute use, source revision, artifacts, results, promotion
decisions, and rollback targets. Research agents may read that evidence but may
not rewrite the authoritative record.

## Evaluation constitution

### Portfolio structure

Every capability domain has four partitions:

- **Development** — visible to researchers and agents.
- **Validation** — callable through an evaluator, with aggregate results only.
- **Sealed** — unavailable to the proposer and used only for promotion.
- **Canary** — adversarial safety, contamination, and reward-hacking cases.

Holdouts are separated by company, time, workflow, repository, problem family,
tool version, and surface form where applicable. Prompt-level random splits are
not sufficient.

### Primary scorecard

Each release reports these dimensions separately:

| Dimension | Examples |
| --- | --- |
| Capability | task success, executable correctness, research reproduction |
| Reliability | variance, recovery, state integrity, false-success rate |
| Generalization | sealed domains, novel tools, temporal and distribution shift |
| Efficiency | wall time, tokens, accelerator hours, memory, dollars |
| Autonomy | longest verified task, intervention rate, useful work per human minute |
| Calibration | abstention quality, confidence/error relationship |
| Safety | tenant isolation, prompt injection, authority and evaluator gaming |

The program may publish a composite research score for ranking experiments,
but no composite can mask a hard safety, rights, or reproducibility failure.

### Frontier quality harness v1

The existing 35-point AMOS local qualification suite is a production contract
floor. It tests protocol grammar, governance, tool selection, recovery, and
small executable tasks; it is not difficult or broad enough to support a
claim that Qwen beats Opus 5. The development portfolio is machine-readable in
`benchmarks/frontier-quality-portfolio-v1.json` and must be frozen only after
every required adapter, task snapshot, license review, and evaluator digest is
pinned.

The six visible challenge missions are a contract smoke test, not a capability
score. The first bounded-v1 Qwen Swarm run completed all 18 attempts, but seven
integrated answers were shorter than 1,000 characters and several were obvious
title or table fragments. `swarm-experiment-opus-complete-v2.json` therefore
makes a substantive answer length a fail-closed transport contract. This catches
missing and truncated synthesis; it does not grade correctness or reward
verbosity. Frontier evidence begins only in the verifier-scored tracks below.

The first hard portfolio uses independent benchmark families rather than many
variants of the same test:

| Track | Capability | Role in the claim |
| --- | --- | --- |
| AMOS private missions | research, finance, planning, artifacts, recovery, and governed execution | ecological validity and a time-separated private holdout |
| SWE-bench Verified | real repository issue resolution | comparable public coding control |
| recent SWE-rebench V2 snapshot | multilingual repository repair from later time slices | contamination control and coding generalization |
| Terminal-Bench 3.0 | long-horizon work in executable terminal environments | broad agent reliability |
| BFCL V4 | single-turn, multi-turn, agentic, and recovery-oriented tool use | model-level function calling |
| tau3 base | conversational policy compliance with stateful tools and simulated users | interactive company-agent behavior |
| SpreadsheetBench 2 | financial modeling, debugging, and visualization across complex workbooks | AMOS-relevant business artifacts |
| OSWorld 2.0 (2026.06.24 release) | multimodal work across real desktop applications | computer use and cross-application execution |

Direct Qwen, Qwen Swarm, and the pinned Opus 5 control run with identical
benchmark adapters and tool authority wherever the official harness permits.
Best verified quality is the primary promotion regime. Matched wall-time and
matched-cost results remain useful secondary diagnostics, while latency,
throughput, accelerator hours, and dollars are always reported. The initial
promotion claim requires at least five statistically significant track wins
against Opus 5, no
statistically significant loss on any required quality track, 35/35 on the
contract floor in three consecutive runs, 100% on private safety canaries,
blind judging where deterministic grading is unavailable, and independent
reproduction. A single aggregate score cannot override a failed floor.

Public benchmarks are development or validation evidence, not sealed proof.
SWE-bench contamination is specifically controlled with a later untouched
SWE-rebench slice; public task leakage and benchmark-specific scaffold
overfitting remain explicit failure risks. Final superiority requires the
AMOS-private, time-separated mission and canary partitions.

### Promotion requirements

A candidate advances only when:

1. its source, data, environment, and configuration are reproducible;
2. its primary improvement repeats across at least three runs when stochastic;
3. it beats the current champion on the pre-registered primary metric;
4. it does not materially regress sealed secondary domains;
5. every safety and authority floor passes;
6. an independent evaluator reproduces the result;
7. inference and training costs are reported; and
8. a signed rollback artifact exists.

## Research record

Every experiment receives an immutable record containing:

- hypothesis and predicted mechanism;
- parent champion and source revision;
- exact editable and protected surfaces;
- proposer model and research scaffold;
- data manifests and permitted-use ledger;
- training and inference configuration;
- random seeds and environment image;
- wall time, accelerator time, energy where available, and estimated cost;
- development, validation, sealed, and canary results;
- statistical comparison with the parent;
- artifacts, logs, crashes, and observed evaluator exploits;
- keep, reject, reproduce, promote, or quarantine disposition; and
- links to descendants so the experiment tree remains searchable.

This is the program's cumulative scientific memory. Chat transcripts are not a
substitute.

## Capability ladder

The program unlocks broader self-modification in this order:

| Level | Learner may modify | Required proof before unlocking the next level |
| --- | --- | --- |
| L0 Measurement | Nothing; baseline only | Stable, reproducible scorecard and cost accounting |
| L1 Runtime | prompts, context compiler, routing, tools, memory, agent scaffold | Repeated sealed lift without more authority |
| L2 Curriculum | synthetic tasks, hard negatives, sampling, data mixtures | Lift transfers to unseen families and resists contamination |
| L3 Adaptation | LoRAs, specialist heads, preference and outcome tuning | Adapter beats base and runtime-only controls across repeats |
| L4 Training | optimizer, schedule, rewards, architecture components | Replicated iso-compute improvement across seeds and model scales |
| L5 Base model | tokenizer, architecture, pretraining mixture, full weights | Favorable scaling evidence and independent safety qualification |
| L6 Research system | experiment policy, research roles, resource allocation | Faster verified progress on a sealed meta-research portfolio |

Unlocking a level expands the experimental sandbox. It does not expand
production authority.

## Execution phases

Calendar ranges are planning targets, not promotion substitutes. A phase ends
only when its exit gate passes.

### Phase 0 — charter, instrumentation, and frozen baseline

**Target:** weeks 0–3.

1. Approve this charter and name one human promotion owner plus one backup.
2. Define the evaluation schema and specialize the existing AMOS
   `ExperimentProposal` / proof receipt / `ImpactOutcome` envelope for research
   experiments instead of inventing an unrelated experiment lifecycle.
3. Assemble the first portfolio:
   - 120 audited AMOS missions across tool use, planning, evidence, recovery,
     artifact creation, and governed execution;
   - 60 externally sourced or AMOS-owned coding, reasoning, research, and
     long-horizon tasks; and
   - 30 adversarial safety and evaluator-gaming canaries.
4. Split each domain into development, validation, sealed, and canary sets.
5. Hash and freeze the first sealed suite outside the research-agent workspace.
6. Run pinned controls: direct resident Qwen, current Qwen runtime, a qualified
   open-weight larger model, and a qualified frontier control.
7. Record outcome, latency, tokens, retries, tool correctness, intervention,
   cost, and failure taxonomy for every run.
8. Establish the initial champion and publish a baseline report, including
   negative and incomplete results.

**Exit gate:** three repeated baseline runs are stable enough to distinguish a
real improvement; all research artifacts and costs are reproducible from the
ledger.

**Budget rule:** existing local hardware and metered inference only. No new
training cluster.

### Phase 1 — self-improving agent runtime

**Target:** weeks 4–10.

1. Build a research orchestrator around a fixed model checkpoint.
2. Permit it to modify only a versioned runtime surface: context compilation,
   prompts, tool presentation, planning policy, branching, verification,
   stopping, recovery, and agent coordination.
3. Require one hypothesis per experiment and one changed mechanism where
   practical, so attribution remains possible.
4. Run candidates in isolated worktrees and disposable execution sandboxes.
5. Evaluate development cases automatically; provide validation aggregates,
   never labels or hidden rationale.
6. Maintain an evolutionary archive of champions, diverse near-winners, failed
   branches, and discovered evaluator exploits.
7. Reproduce each proposed champion independently before sealed evaluation.
8. Promote accepted runtime generations through shadow mode only.

**Exit gate:** within at most 150 valid experiments, produce at least ten
accepted runtime generations and a final champion that improves the sealed
portfolio by at least 15% relative while preserving every safety floor. At
least half the lift must remain under an equal-inference-cost comparison.

**Stop condition:** if 100 consecutive valid experiments produce no validation
improvement, pause expansion and audit the search space, evaluator sensitivity,
and base-model capability.

### Phase 2 — verified experience and specialist adaptation

**Target:** months 3–6.

1. Implement the consent-aware training record already defined by the AMOS
   model program.
2. Add deterministic minimization, de-identification, deduplication,
   contamination detection, and a data-rights manifest.
3. Collect verified success/failure/correction pairs from synthetic fixtures,
   AMOS-owned environments, public tasks, and explicit opt-in data only.
4. Build a teacher registry containing capability evidence, deployment,
   license, output-training rights, cost, latency, and retention terms.
5. Generate multiple candidate trajectories only where deterministic tests,
   receipts, or audited graders can select them.
6. Train the first three transferable specialists:
   - tool selection and argument construction;
   - error diagnosis and recovery; and
   - evidence verification and calibrated escalation.
7. Compare adapters against the base, runtime-only champion, and frontier
   control on untouched task families.
8. Deploy qualified adapters in shadow mode, then graduate individual
   capabilities through existing model capability contracts.

**Exit gate:** a specialist configuration preserves safety gates, reduces
frontier escalation or inference cost by at least 30% on its qualified domain,
and improves sealed task success over the Phase 1 champion. The lift must
survive three data/training seeds.

### Phase 3 — automated training research

**Target:** months 5–10, overlapping Phase 2 only after its data contract lands.

1. Use `autoresearch` as the first sealed micro-laboratory: fixed data,
   evaluator, time budget, and protected preparation code.
2. Replace its unstructured loop with the common experiment ledger,
   reproducible environments, branch isolation, and independent promotion.
3. Let research agents alter architecture, optimizer, schedules, batching,
   regularization, and training code on small models.
4. Run multiple independent proposer strategies rather than copies sharing the
   same context: literature-driven, ablation-driven, evolutionary, and
   anomaly-driven.
5. Test retained discoveries across multiple seeds, data subsets, hardware
   budgets, and at least two model scales.
6. Add a meta-evaluation measuring which research policy finds real
   improvements fastest.
7. Distill successful research behavior into a lower-cost research controller.

**Exit gate:** at least five independently reproduced training or architecture
improvements, with at least one delivering either a 10% iso-compute validation
gain or a 20% compute reduction at matched quality across two scales. The
automated research policy must beat a fixed random/search baseline per
accelerator hour.

### Phase 4 — medium-scale general model program

**Target:** months 9–18.

1. Select the base architecture from measured Phase 3 evidence rather than
   brand preference.
2. Build a licensed, versioned general data mixture plus AMOS and scientific
   curricula, with contamination analysis and held-out time slices.
3. Establish scaling curves on small checkpoints before committing to the
   target run.
4. Train successive checkpoints with intermediate capability, calibration,
   safety, and efficiency evaluations.
5. Use the automated research system to propose data, training, and
   architecture experiments within fixed compute envelopes.
6. Evaluate the raw checkpoint, scaffolded system, and governed AMOS product
   separately.
7. Release only capability-contract-qualified configurations; retain all prior
   champions for rollback and comparative research.

**Exit gate:** the new model is on the capability/cost Pareto frontier against
current open models, closes at least half the measured gap from the Phase 1
resident baseline to the pinned frontier control on the broad portfolio, and
shows a positive, reproducible scaling slope. It must also beat the best
distilled-adapter alternative sufficiently to justify full-weight training.

**Capital gate:** no large run is authorized without a written scaling
forecast, total-cost envelope, data-rights audit, failure budget, and financing
that does not threaten the AMOS operating company.

### Phase 5 — frontier challenge

**Target:** begins only after Phase 4 passes; timing is evidence-driven.

1. Choose dense, mixture-of-experts, recurrent, retrieval-augmented, or hybrid
   architecture from experiments rather than convention.
2. Secure compute through the economically strongest combination of owned,
   reserved, cloud, and research-partner capacity.
3. Expand automated research across data, architecture, kernels, distributed
   training, inference, evaluation, and curriculum.
4. Maintain independent red-team, research-integrity, and promotion functions.
5. Benchmark continuously against current frontier systems under equal-time,
   equal-cost, and unconstrained-quality regimes.
6. Target staged victories: best governed company operator, best open
   long-horizon agent, best automated researcher per compute, then broad
   frontier parity or superiority.

**Exit gate:** superiority must be independently reproducible across the broad
sealed portfolio and cannot rely on one scaffold, one benchmark family, hidden
human labor, or materially larger inference expenditure that is omitted from
the claim.

## Initial 30-day operating plan

### Days 1–3: establish authority and artifacts

- Approve the charter, north-star metric, program laws, and phase gates.
- Assign the promotion owner, sealed-suite custodian, and data-rights owner.
- Version the evaluation, candidate, teacher, and dataset schemas, plus the
  research specialization of the shared proof-carrying experiment envelope.
- Create a single decision log for scope, metric, and gate changes.

### Days 4–10: create the evaluation spine

- Convert the current AMOS capability suite and local qualification fixtures
  into the common evaluation schema.
- Select and audit the first non-AMOS tasks.
- Build the hidden partition and hash manifest.
- Add cost, latency, token, tool, intervention, and reproducibility telemetry.
- Produce the failure taxonomy used by the research orchestrator.

### Days 11–16: establish controls

- Pin exact inference configurations and prompts.
- Run three baseline repetitions for each control.
- Investigate unstable tasks and remove or repair ambiguous graders before the
  suite freezes.
- Publish baseline report 0 with confidence intervals and per-domain results.

### Days 17–23: build research loop v0

- Create isolated candidate branches and execution sandboxes.
- Implement propose, patch, run, score, retain/reject, reproduce, and promote
  states.
- Protect evaluators and hidden data at the process and credential boundary.
- Import `autoresearch` result logging concepts and the useful SWARM archive
  concept without importing speculative pheromone or digital-emotion claims.
- Test cancellation, timeout, crash recovery, restart, and budget exhaustion.

### Days 24–30: run the first campaign

- Execute at least 25 valid runtime experiments against the development suite.
- Reproduce the best candidates.
- Run validation evaluation for candidates that clear development thresholds.
- Document search yield, experiment throughput, failure modes, and compute.
- Decide whether the Phase 1 search surface is sensitive enough to justify the
  full 150-experiment campaign.

## Repository responsibilities

| Repository or system | Program responsibility |
| --- | --- |
| `amos-agent` | capability contracts, context/runtime experiments, local and hosted qualification runners, product shadow deployment |
| AMOS managed platform | authenticated tools, policy, receipts, consent records, outcome evidence, production authority |
| `autoresearch` | fixed-budget model-training micro-lab and early automated-research benchmark |
| `swarm` | research archive and coordination source material; not a production dependency without requalification |
| `expertcache` | oversized-model inference, verification, speculation, and systems-efficiency research |
| research control plane | experiment ledger, sandbox dispatch, sealed evaluator, candidate registry, promotion, rollback, compute accounting |

The research control plane should begin as a small isolated service or package.
Create a dedicated repository only after Phase 0 fixes its contracts; do not
prematurely turn the historical SWARM application into the authoritative lab.

## Workstreams and accountable outputs

### W1 Evaluation and research integrity

- Common schemas, sealed suite, graders, contamination checks, statistical
  reports, independent reproduction, and published negative results.

### W2 Experience and data

- Consent-aware trace export, sanitizer, rights ledger, dataset registry,
  teacher registry, and causal/outcome confidence.

### W3 Research orchestration

- Hypothesis generation, experimental patches, sandboxing, search/archive
  policy, failure analysis, research memory, and compute allocation proposals.

### W4 Model and training systems

- Fine-tuning, preference/outcome training, checkpoint registry, distributed
  training, scaling experiments, and artifact reproducibility.

### W5 Inference and product

- Capability routing, context compilation, caching, speculation, ExpertCache,
  shadow/canary deployment, observability, and rollback.

### W6 Governance and security

- Immutable evaluator boundary, secrets isolation, data licenses, autonomy
  floors, budget enforcement, incident response, and production promotion.

### W7 Compute and capital

- Per-experiment cost, utilization, capacity strategy, scaling forecasts,
  financing gates, and make/buy/partner decisions.

## Game-theoretic operating strategy

1. **Do not fight the incumbents' opening.** Avoid a symmetric contest in raw
   pretraining scale until the research engine demonstrates an asymmetric
   efficiency advantage.
2. **Capture external progress.** Requalify strong open releases as candidate
   actors, teachers, verifiers, and research agents. Their improvement should
   raise our baseline without resetting our data or evaluation moat.
3. **Own the feedback loop.** Verified trajectories, hidden evaluations,
   research memory, and real outcome evidence are more durable than any one
   checkpoint.
4. **Win narrower games first.** Establish superiority in governed company
   operation and automated research per compute before claiming general model
   superiority.
5. **Keep optionality.** AWS and other clouds provide elastic teachers and
   experiments; owned or reserved capacity becomes rational only when measured
   utilization and training economics justify it.
6. **Separate cooperation from dependence.** Publish research that attracts
   talent and external validation while retaining customer-private data,
   sealed evaluations, and operational learning systems under their proper
   controls.

## Stop, quarantine, and rollback conditions

Immediately stop or quarantine a campaign when:

- a candidate accesses or appears to infer sealed labels;
- a metric improves through grader exploitation rather than task improvement;
- data provenance or training rights cannot be demonstrated;
- safety, tenant, authority, or false-execution behavior regresses;
- an experiment escapes its declared compute, network, filesystem, or time
  boundary;
- results fail independent reproduction;
- improvement depends on hidden human intervention;
- cost grows faster than capability across two consecutive phase reviews; or
- the program cannot produce validation improvement within its pre-registered
  search budget.

Rollback always restores the last signed candidate, runtime, evaluation
version, and capability contract. A failure may become research evidence, but
it never silently becomes a production feature.

## Standing review cadence

- **Every experiment:** automatic record, cost, result, and disposition.
- **Daily during campaigns:** crash, exploit, budget, and candidate review.
- **Weekly:** improvement velocity, research yield, generalization, and failure
  taxonomy.
- **Monthly:** phase-gate status, compute economics, data rights, and portfolio
  balance between AMOS and general science.
- **Quarterly:** frontier comparison, capital strategy, architecture thesis,
  and whether the automated research system itself is improving.

No meeting or model narrative can override a failed gate. Any change to a
metric, partition, or promotion threshold is versioned and applies only to
future campaigns.

## Immediate decisions required

Before implementation begins, the program owner approves:

1. the north-star metric and first broad scorecard;
2. the Phase 0 portfolio size and initial control configurations;
3. the human promotion owner, sealed-suite custodian, and data-rights owner;
4. the initial inference and experiment budget ceiling;
5. whether the first research control plane lives temporarily in `amos-agent`
   or as an isolated package; and
6. the first 30-day campaign start date.

Once those six decisions are recorded, Phase 0 can begin without additional
architectural decisions.
