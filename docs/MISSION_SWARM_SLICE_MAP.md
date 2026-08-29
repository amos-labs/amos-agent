# Mission, Swarm, and Slice 0 boundary

This document preserves the organism work developed in Recursive Intelligence
Slice 0 while defining how it connects to the production Mission runtime. The
layers are complementary. None should silently become a second source of
authority, execution truth, or completion truth.

## Production architecture

```text
Desktop / mobile control surface
              |
              v
Platform Mission kernel
contracts | budgets | claims | execution | checkers | receipts
              |
              v
Swarm intelligence gateway
decomposition | specialists | critique | integration | plan repair
              |
              v
Slice 0 organism learning plane
episodes | failure capsules | simulation | HRR | strategy genes | promotion
```

The Platform is the governor and executor. Swarm is a replaceable intelligence
worker that proposes exactly one contract-shaped next step. Desktop and future
phone surfaces project durable Platform decisions and provide human control;
they do not invent authority. Slice 0 learns from attributed outcomes and may
propose a candidate policy, but only the promotion gate can place that policy
in production.

## What each layer owns

| Concern | Canonical owner | Notes |
| --- | --- | --- |
| Mission objective and finite completion contract | Platform | Immutable for a run; replacement requires new approval. |
| Allowed operations, budgets, claims, idempotency | Platform | A model never grants itself authority. |
| Execution and outcome uncertainty | Platform | Ambiguous effects stop for inspection and are never replayed. |
| Completion | Independent Platform checkers | A worker may request verification but cannot declare success. |
| Planning and specialist collaboration | Swarm | Produces a typed proposal, not an effect. |
| Invalid-plan repair | Swarm gateway | One bounded, no-tools repair pass; no operation is replayed. |
| Decisions and approvals UI | Desktop/mobile | A projection of durable Platform records. Stop and retry are explicit controls. |
| Exact operational history | Platform receipts and Mission steps | Append-only truth used for audit and episode construction. |
| Cross-run learning | Slice 0 | Simulations, episodes, capsules, strategy genes, router policies, and HRR. |
| Associative world recall | Slice 0 HRR | Derived belief/index only; never truth, authority, or proof. |
| Candidate promotion and rollback | Evaluation constitution | Shadow, canary, independent checks, and signed rollback target. |

## Similar-looking artifacts that are not duplicates

- `mission_steps` are operational facts. Learning episodes are immutable,
  rights-scoped representations derived from those facts for evaluation or
  training.
- Platform checkers authorize completion. Benchmark verifiers measure whether
  a candidate organism or model deserves promotion.
- The Platform scheduler runs real bounded work. The Slice 0 simulator searches
  policies and strategies in controlled environments.
- A durable Mission Decision is the record. A Desktop decision card is only its
  human-readable projection.
- Mission budgets cap one authority envelope. Provider metering accounts for
  tenant and infrastructure usage across envelopes.
- Exact receipts preserve reality. HRR retrieves related strategies and beliefs
  without replacing the exact evidence ledger.

## Typed feedback and learning attribution

Every attempt must be attributed before it becomes reward or punishment:

1. malformed model plan: repair inside Swarm; no company effect;
2. intelligence transport failure: bounded retry or fallback; no company effect;
3. accounting or persistence failure before dispatch: infrastructure failure;
4. contract, policy, or budget rejection: return the exact rejection as planner
   feedback; no company effect;
5. uncertain post-dispatch outcome: stop and inspect; replay forbidden;
6. checker failure: genuine task evidence and negative learning signal; and
7. independently verified completion: positive learning episode.

Infrastructure failures must not reduce a strategy's organism reward. Contract
rejections may train proposal quality, but cannot be confused with tool failure.
Every failure capsule records its class, evidence, whether an external effect
could have occurred, the safe recovery action, timing, and cost.

## Quality, speed, and adaptive effort

Speed is contextual rather than universally dominant. Each Mission should
eventually compile an effort policy from user intent, consequence, uncertainty,
and interaction mode:

| Mode | Optimize first | Typical behavior |
| --- | --- | --- |
| Interactive | time to useful progress | fast direct path, stream early, bounded background enrichment |
| Balanced | verified quality per elapsed time | direct attempt with conditional specialists and checks |
| Deep | best verified result | broader Swarm search, critique, and additional evidence |
| Autonomous | outcome within explicit budget/deadline | checkpointed execution with adaptive depth and notifications |

Wall time, time to first useful result, tokens, GPU time, dollars, checker
quality, and user intervention are all recorded. They remain separate metrics;
a fast failure cannot beat a slower verified success. The organism may learn a
stopping and routing policy from these outcomes, but it cannot override the
Mission's deadline, budget, consequence policy, or user-selected mode.

## Canonical learning flow

```text
approved Mission contract
  -> Swarm plan
  -> Platform validation / claim / execution
  -> independent checker result
  -> signed receipt and Mission step
  -> rights-filtered learning episode or failure capsule
  -> exact store + derived HRR projection
  -> simulation / strategy-gene candidate
  -> development and sealed evaluation
  -> shadow / canary / production promotion or rollback
```

Customer-private traces are not silently admitted to model training. The
episode builder must apply the configured data-rights policy before an episode
enters simulation, adapter training, distillation, or shared learning.

## Repository transition

Do not split Slice 0 merely to make the tree look cleaner. First freeze the
Mission-planner envelope, attributed learning-episode schema, receipt links,
HRR projection contract, and promotion interface. Once those boundaries are
stable, the organism kernel can move to a dedicated service/repository while
this repository retains the client, gateway adapter, and compatibility tests.

