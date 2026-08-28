# Research experiment protocol

## Purpose

The research experiment protocol is the provider-neutral, proof-carrying
contract for AMOS recursive-intelligence work. It specializes the original
AMOS `ExperimentProposal` and `ImpactOutcome` lifecycle for model, runtime,
data, training, and research-system experiments.

The initial implementation is a local, provider-neutral contract and evidence
store:

- `src/research/experimentProtocol.js`
- `src/research/evaluationAttestation.js`
- `src/research/experimentStore.js`
- `src/research/qwenResearchEnvironment.js`
- `test/researchExperimentProtocol.test.js`
- `test/researchEvaluationAttestation.test.js`
- `test/researchExperimentStore.test.js`
- `test/qwenResearchEnvironment.test.js`

The Qwen worker can execute explicitly supplied research fixtures against a
pinned local endpoint or a private AWS vLLM endpoint reached through an SSM
tunnel. It does not schedule a company mission, ingest customer
data, approve a company action, or deploy a candidate. Those integrations
require separate gated slices.

## Ownership boundary

The managed-platform autonomous-goals project owns:

- company goals and allowed-action snapshots;
- durable missions and mission steps;
- schedulers, claims, leases, pause/resume, and Decisions;
- company policy, approvals, execution, and operation receipts; and
- cloud-resident continuation.

AMOS Desktop owns:

- Projects and task presentation;
- local/background model runs;
- restart and sleep recovery;
- user steering and inline Decisions; and
- projection of managed mission state.

The research protocol owns:

- immutable research hypotheses and observations;
- editable-surface and research-level declarations;
- compute, cost, token, storage, and wall-time budgets;
- evaluation-manifest identity and protected partition metadata;
- data permitted-use declarations;
- candidate, parent, and exact rollback identity;
- measured research outcomes and reproduction evidence;
- deterministic promotion eligibility; and
- a hash-chained experiment event record.

No research contract grants company authority. No company goal implicitly
becomes a model-training experiment. A later adapter may cite governed mission
receipts as research observations only under the appropriate data-use contract.

## Contract set

### Evaluation manifest

Schema: `amos.research-evaluation-manifest`, version 1.

The manifest contains identifiers and digests rather than hidden task contents.
It defines four partitions:

| Partition | Required visibility |
| --- | --- |
| `development` | `research-visible` |
| `validation` | `aggregate-only` |
| `sealed` | `custodian-only` |
| `canary` | `custodian-only` |

A frozen manifest requires:

- non-empty domains and holdout dimensions;
- positive case counts and SHA-256 digests for every partition;
- exactly one primary metric;
- at least one hard safety-floor metric;
- at least three promotion repetitions; and
- independent reproduction.

The research agent may receive the manifest, development cases, and aggregate
validation results. It must not receive sealed/canary contents or labels.

### Experiment proposal

Schema: `amos.research-experiment-proposal`, version 1.

A valid proposal binds:

- proposer identity and, for a model proposer, its capability contract;
- hypothesis and supporting observation digests;
- exact parent candidate and source revision;
- research level and editable surfaces;
- resource ceilings;
- development/validation predictions;
- evaluation-manifest identity and digest;
- data manifests and their permitted uses;
- required review path; and
- an exact rollback to the parent artifact.

Proposals cannot name sealed or canary predictions. L3 and higher treatments
require an explicitly training-permitted data manifest. L3/L4 require an
independent reviewer; L5/L6 require council review with at least two approvals.

### Experiment outcome

Schema: `amos.research-experiment-outcome`, version 1.

An outcome binds itself to the proposal, evaluation manifest, source revision,
candidate artifact, execution environment, actual resource usage, measurements,
safety results, reproductions, and proof receipts. Completed outcomes require
measurements and cannot carry failure details. Failed and aborted outcomes must
carry a bounded failure description.

Outcomes report evidence. They do not self-promote.

### Promotion decision

`evaluateResearchPromotion` fails closed and returns explicit rejection
reasons. Promotion requires:

- a frozen evaluation manifest;
- a completed, changed candidate artifact;
- every resource ceiling preserved;
- required development/validation predictions satisfied;
- sufficient primary-metric lift on the sealed partition;
- required repetitions;
- canary or sealed safety-floor evidence;
- bounded secondary regressions;
- a matching independent reproduction; and
- at least one proof receipt.

Passing this pure function makes a candidate structurally eligible. A governed
human or promotion service must still record the decision and perform the
shadow/canary deployment process.

### Experiment ledger

Schema: `amos.research-experiment-ledger`, version 1.

The ledger stores content digests and a canonical SHA-256 event chain. Its first
event records the proposal. The supported state flow is:

```text
proposed -> approved -> running -> evaluating -> promoted -> reverted
        \-> rejected     \-> aborted     \-> rejected
        \-> quarantined  \-> quarantined \-> quarantined
```

Models may propose, start work, or contribute outcomes. A model actor cannot
record approval, promotion, rejection, quarantine, or reversion. Those events
require a human, hybrid, or governed service actor.

The ledger is also persisted in an append-only, content-addressed local store.
Proposal, evaluation-manifest, outcome, attestation, and ledger values are
immutable SHA-256-addressed objects. Each ledger generation is a new exclusive
head reference; there is no mutable `HEAD` to corrupt or overwrite. A bounded
per-experiment lock serializes writers, stale locks are recoverable, and an
object written before a crash is harmless until an immutable head references
it. Reads recompute every content digest and the complete ledger hash chain.

### Evaluation attestation

Schema: `amos.research-evaluation-attestation`, version 1.

The sealed evaluator signs an exact Ed25519 envelope containing:

- evaluator identity, version, and environment digest;
- proposal, evaluation-manifest, outcome, and promotion-decision digests;
- experiment and candidate identity; and
- the deterministic eligibility bit and sorted rejection reasons.

Verification recomputes the outcome validation and promotion decision before
checking the signature. Changing a measurement, budget usage, safety result,
decision, or referenced artifact therefore fails closed. The evaluator private
key remains outside the candidate/proposer boundary; the store accepts only the
public verification key.

## Research levels

| Level | Examples of editable surfaces |
| --- | --- |
| L1 Runtime | prompts, context compiler, routing, planning, verification, recovery |
| L2 Curriculum | synthetic data, hard negatives, sampling, data mixture |
| L3 Adaptation | adapters, specialist heads, preference and outcome objectives |
| L4 Training | optimizer, schedule, reward model, architecture components |
| L5 Base model | tokenizer, base architecture, pretraining mixture, full weights |
| L6 Research system | experiment policy, research roles, resource-allocation proposals |

A proposal may edit only surfaces at or below its declared level. Advancing a
research level expands the isolated experimental surface, never production
authority.

## Qwen environment and first experiments

Qwen begins in Phase 0, before any fine-tuning or managed-platform integration.
The already qualified Qwen 3.8 27B artifact and selectable Ollama/MTPLX
runtimes become the first research worker. The initial laboratory is local and
L1-only: Qwen may propose changes to prompts, context compilation, routing,
planning, verification, stopping, recovery, and agent coordination. It cannot
change its evaluator, hidden cases, budgets, permissions, or production
candidate.

Schema `amos.qwen-research-environment` records the exact model repository,
revision, artifact-manifest digest, served model ID, runtime version/profile,
runtime release contract, local binary digest, prompt/tool-schema binding,
inference settings, and hardware. Execution refuses a draft environment that
lacks the actual runtime-binary digest. Model/runtime drift and non-loopback
Phase-0 endpoints fail closed.

Each case returns an `amos.qwen-research-observation` containing request,
provider-response, message, data-manifest, and environment digests plus prompt,
decode, cache, and wall-time metrics. The complete provider response remains in
the observation so the response digest is independently verifiable.

The first measured sequence is:

1. Pin the Qwen artifact, runtime, prompt/tool-schema digest, source revision,
   hardware, and inference settings into a reproducible environment manifest.
2. Convert the existing 35-point qualification cases into the first visible
   development manifest; create new validation, sealed, and canary partitions
   rather than pretending the now-visible cases remain hidden.
3. Record a three-run baseline for quality, wall time, prompt time, decode
   throughput, tokens, recovery behavior, and proof receipts.
4. Run one-variable L1 experiments, beginning with context density/prefix
   stability, then routing/branching, stopping/recovery, and coordination.
5. Require a signed evaluator result and independent reproduction before a
   candidate is eligible for shadow use. Production promotion remains a
   separate human/governed-service decision.

Swarm Mode follows that direct baseline immediately: at most three logical
workers share one Qwen checkpoint and coordinate through a typed evidence
board. The direct and swarm routes are compared against each other and a
pinned Fable control under both equal-budget and unconstrained-quality regimes.

The AWS environment is the primary experiment lane because the local 27B
decode rate is insufficient for rapid direct-versus-swarm iteration. Local
Qwen remains the inexpensive development and fallback lane. AWS reproduces the
same proof-carrying worker contract rather than introducing a second research
protocol.

It reproduces the same worker protocol in an ephemeral, network-bounded
inference cell with a pinned image and model artifact. One private vLLM endpoint
uses continuous batching for logical swarm workers; additional physical
replicas require measured utilization. GPU training enters at L3/L4 only after
data rights, trajectory quality, and the baseline evaluator are proven. This
avoids paying for a training cluster before the research loop can distinguish
a real improvement from evaluator overfitting.

## Next implementation slices

1. Convert the first qualification fixtures into a development dataset and
   create genuinely protected validation/sealed/canary replacements.
2. Add a CLI that initializes an experiment, runs a fixed-budget Qwen baseline,
   validates/signs the evaluator result, and exports a portable proof bundle.
3. Implement Swarm Mode v0: mission compiler, three logical roles, typed
   evidence board, verifier/integrator, and direct-versus-swarm evaluator.
4. Stage the pinned AWS Qwen FP8 and vLLM artifacts, deploy the private G7e
   inference cell, and record the first three-run direct baseline.
5. Reproduce the proof bundle locally or on a second AWS cell as an independent
   check; local speed is not a prerequisite for beginning AWS experiments.
6. Add a managed-platform adapter only after the autonomous-goals contracts
   stabilize. The adapter exchanges IDs and signed receipts; it does not share
   goal tables or lifecycle ownership.
7. Connect `autoresearch` through the protocol as the first fixed-budget L4
   laboratory after the L1 loop and data gates are proven.

## Swarm Mode v0 experiment runner

Swarm Mode v0 is implemented as a research-only scaffold. It does not add a
second production agent loop or managed-platform goal lifecycle. The runner
uses one endpoint and at most three logical worker roles:

1. `explorer` and `builder` run concurrently against the shared checkpoint;
2. both append typed claims, evidence, proposals, and risks to a
   content-addressed evidence board;
3. `verifier` challenges that board after the first wave completes; and
4. an integrator produces the visible answer while preserving unresolved
   risks.

The direct and swarm paths share two protocol safeguards. An answer reserve
prevents hidden reasoning from consuming the entire completion, and a
sequential-tool policy prevents a dependent tool call before its required
identifier exists. Recovery consumes the reserved portion of the original
completion budget; it does not silently grant extra tokens. Swarm stages use
provider-enforced JSON Schema, and the research runner fails closed when a
response exhausts its token budget or violates a typed stage contract.

The first AWS Swarm v0 qualification on 2026-08-22 deliberately failed this
contract gate. Qwen completed the underlying reasoning, but the original
128-token answer reserve truncated six direct answers and 33 of 36 typed swarm
stages required recovery; only three stage envelopes parsed successfully. The
run is preserved as development evidence in
`benchmarks/results/qwen-swarm-v0-contract-qualification-2026-08-22.json`.
It is not evidence that either control won. A first hard-gated rerun showed
that 768 visible-answer tokens were still insufficient for Direct Qwen. The
corrected quality regime therefore reserves 3,072 tokens for direct and
integrated user-facing answers and 1,024 tokens for bounded typed specialist
output. It caps answers at 900 words, enforces JSON Schema, and rejects
truncation before the controls are compared. A truncated partial first-pass
answer also consumes the reserved no-reasoning answer pass; nonempty partial
content never bypasses recovery.

The visible development mission manifest is not sealed evidence. It exists to
debug the scaffold before running the private and public frontier portfolio.
Run one control through the loopback research endpoint with:

```bash
npm run research:swarm -- \
  --control qwen-swarm \
  --repetitions 3 \
  --output /tmp/qwen-swarm-v0.json
```

Use `qwen-direct` for the direct control. For Fable, start the loopback Bedrock
benchmark gateway with the US system inference profile
`us.anthropic.claude-fable-5`, then run
`--control fable-control`. Each report binds the source revision, experiment
configuration, mission manifest, control, proof-carrying observations, typed
board, budgets, timing, and output-token usage. A report is development
evidence only until answers are anonymized, blindly judged, repeated at least
three times, and evaluated under the frozen frontier portfolio.

The runner writes a report even when a control fails. Completed cases remain
in the report and a bounded failure receipt records the mission, repetition,
timestamp, error type, and error message. Both successful and failed reports
are written atomically and content-addressed before the process returns its
exit status. This prevents a late budget exhaustion, provider timeout, or
typed-contract failure from erasing the earlier evidence in a long run.

The 2026-08-23 challenge run exposed a different failure mode: adding tokens
did not make Swarm reliable. The same partner-capacity mission passed as an
isolated 16,384-token probe and then exhausted the integrator's 7,168-token
allocation during the full run. The bounded-v1 treatment therefore keeps the
9,984-token contest budget while limiting each specialist to three compact,
decision-useful board entries and giving the integrator an explicit finite
answer envelope and stopping rule. Direct Qwen remains an ablation and runtime
baseline; the target quality contest is complete Swarm Qwen versus Opus.

For accounts that keep Bedrock's default retention mode, the alternate
`benchmarks/swarm-experiment-opus-v0.json` configuration replaces Fable with
the already-qualified `us.anthropic.claude-opus-5` control. Direct Qwen, Swarm
Qwen, and Opus must all use that same configuration and mission manifest so
their report digests remain comparison-compatible. Selecting Opus does not
authorize sending private or customer data; only explicitly approved research
fixtures may cross that provider boundary.

### Blind quality comparison

`src/research/blindComparison.js` creates two digest-bound artifacts from two
or more compatible experiment reports:

- `amos.blind-comparison-bundle` contains the common mission evidence,
  anonymized candidate answers, and a fixed six-dimension scoring rubric. It
  contains no control, model, provider, endpoint, source-report, or run
  identity metadata.
- `amos.blind-comparison-mapping` contains the case-specific candidate-to-
  control mapping and source digests. It is a private evaluator-custodian
  artifact and must never be given to the judge.

Candidate labels are independently shuffled for each case with a secret of at
least 32 bytes. The secret itself is never stored in either artifact; only its
SHA-256 digest appears in the private map. The CLI writes both artifacts with
mode `0600`, rejects incomplete or digest-tampered reports, and requires every
control to contain the same mission/repetition set:

```bash
openssl rand -out /tmp/amos-blind-salt.bin 32
chmod 600 /tmp/amos-blind-salt.bin
npm run research:swarm:blind -- \
  --report /tmp/qwen-direct.json \
  --report /tmp/qwen-swarm.json \
  --salt-file /tmp/amos-blind-salt.bin \
  --bundle /tmp/qwen-blind-public.json \
  --mapping /tmp/qwen-blind-private.json
```

The judge receives only the public bundle and scores correctness, evidence
grounding, completeness, actionability, calibrated uncertainty, and concision
from one to five. It must rank every candidate; explicit ranking groups encode
ties. Judgment validation fails closed on missing cases, unknown or duplicate
candidates, incomplete dimensions, or out-of-range scores. Unmasking occurs
only after a complete judgment and emits control-level rank and dimension
totals bound to the bundle, private map, and judgment digests.

The original three cases remain fast contract fixtures. The visible
`benchmarks/swarm-challenge-missions-v0.json` suite adds six multi-constraint
development missions for quality iteration: cash allocation, partner capacity,
incident reconstruction, zero-downtime migration, experiment portfolio
selection, and KPI reconciliation. It is intentionally visible and cannot
serve as sealed promotion evidence. Run it by passing
`--missions benchmarks/swarm-challenge-missions-v0.json` to
`research:swarm`.

The corrected stage-budget qualification completed on 2026-08-22. Direct Qwen
and Swarm Qwen each completed nine runs; all 36 Swarm stages satisfied JSON
Schema and neither control returned a truncated final answer. Warmed decode
was approximately 95 tokens/second. On these three visible missions, Swarm
cost 2.297x the wall time and 2.929x the output tokens of Direct Qwen. A manual
audit found useful explicit risks but also one absolute-loss error and
unsupported benchmark claims, so no quality winner is declared. The compact
qualification record is
`benchmarks/results/qwen-swarm-v0-stage-budget-qualification-2026-08-22.json`.
Blind judging and the Fable control remain mandatory.

### Run the local baseline

Start AMOS Local so the selected runtime is listening, then run:

```bash
npm run research:qwen-baseline -- \
  --runtime ollama \
  --runtime-binary "/Applications/AMOS Desktop.app/Contents/Resources/ollama/ollama" \
  --url http://127.0.0.1:11435 \
  --repetitions 3 \
  --suite all \
  --output /tmp/amos-qwen-phase0-baseline.json
```

For MTPLX, use `--runtime mtplx`, its exact 2.8.3 binary path, and
`--url http://127.0.0.1:18081`. The command probes the served model, hashes the
runtime binary and benchmark script, pins the source revision and environment,
runs every repetition, and emits one content-addressable baseline report. It
labels the current qualification fixtures `development`; they are visible in
the repository and are not valid sealed evidence.

## Explicit non-goals for version 1

- Autonomous production deployment.
- A second company-goal or mission implementation.
- A second approval or Decision surface.
- Customer-trace export without consent and permitted-use evidence.
- Model self-approval or evaluator mutation.
- Storage of sealed task contents in the experiment ledger.
