# Research experiment protocol

## Purpose

The research experiment protocol is the provider-neutral, proof-carrying
contract for AMOS recursive-intelligence work. It specializes the original
AMOS `ExperimentProposal` and `ImpactOutcome` lifecycle for model, runtime,
data, training, and research-system experiments.

The initial implementation is a pure local contract module:

- `src/research/experimentProtocol.js`
- `test/researchExperimentProtocol.test.js`

It does not execute a model, schedule a mission, store customer data, approve a
company action, or deploy a candidate. Those integrations require separate
gated slices.

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

The ledger is presently a deterministic value object, not a persistent store.

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

## Next implementation slices

1. Add signed evaluation-result envelopes so the sealed evaluator—not a caller
   assertion—attests measurements and safety floors.
2. Add a local append-only experiment store with atomic writes, locking,
   content-addressed artifacts, and recovery tests.
3. Add a CLI that validates manifests/proposals/outcomes, evaluates promotion,
   and exports portable proof bundles.
4. Convert the first existing AMOS qualification fixtures into a development
   evaluation manifest without moving sealed data into Desktop.
5. Add a managed-platform adapter only after the autonomous-goals contracts
   stabilize. The adapter should exchange IDs and signed receipts, not share
   tables or lifecycle ownership.
6. Connect `autoresearch` through the protocol as the first fixed-budget L4
   laboratory.

## Explicit non-goals for version 1

- Autonomous production deployment.
- A second company-goal or mission implementation.
- A second approval or Decision surface.
- Customer-trace export without consent and permitted-use evidence.
- Model self-approval or evaluator mutation.
- Storage of sealed task contents in the experiment ledger.
