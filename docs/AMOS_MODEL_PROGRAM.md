# AMOS model program

## Thesis

AMOS does not need to train a general frontier model to own valuable
intelligence. It can build a family of smaller models that outperform generic
models on governed company operations because AMOS observes the complete work
loop:

```text
objective
  -> evidence and authority available
  -> plan and tool calls
  -> policy and approval result
  -> execution receipt
  -> human correction
  -> measured downstream outcome
```

Most model providers see prompts and responses. AMOS can see whether a proposed
action was allowed, whether it actually executed, how a human changed it, and
what happened afterward. That is a differentiated training substrate.

Receipts are evidence, not automatically training consent and not automatic
causal labels.

## First product: AMOS Operator

Start from an Apache-2.0, tool-capable 20B-class base such as GPT-OSS 20B. The
first model should target:

- AMOS bootstrap, engine selection, and progressive tool loading;
- tenant-safe argument construction;
- workflow and skill selection;
- dependent multi-tool sequencing;
- evidence conflict and provenance;
- approval, parked, executed, failed, and denied state distinctions;
- context-compiler packages and durable task continuation;
- code generation followed by tests, repair, and receipt;
- concise business-readable explanations; and
- deterministic escalation when outside its capability contract.

Governance remains code. A better-trained model does not replace tenant
scoping, policy, budgets, approval gates, or receipt generation.

## A model family, not one giant model

The likely end state is:

- **AMOS Router** — a small model or classifier that selects workflow, skills,
  context budget, and qualified intelligence profile;
- **AMOS Operator** — a 20B-class tool and company-work model;
- **AMOS Evidence** — retrieval, contradiction, provenance, and receipt
  interpretation;
- **AMOS Code** — verified software and automation work; and
- **AMOS Reviewer** — a stronger verifier, initially hosted and potentially
  backed by [ExpertCache](https://github.com/amos-labs/expertcache) or a private
  inference pool.

The first release can combine Router, Operator, and Evidence in one fine-tuned
20B model. Split models only when measurements show a quality, latency, privacy,
or deployment advantage.

## Training data contract

Every example must carry:

- example and dataset version;
- synthetic, AMOS-owned, tenant-opt-in, or tenant-isolated classification;
- tenant and user identifiers removed or replaced with stable pseudonyms;
- source and context fingerprints rather than unnecessary raw documents;
- visible tools, schemas, workflow, skill, and operating boundary;
- proposed calls and actual structured tool results;
- policy, approval, execution, and receipt states;
- human correction, denial, or acceptance;
- verification results;
- downstream outcome window and attribution confidence; and
- retention, geographic, and permitted-use policy.

Default customer operation does not become shared model training. Offer three
separate contracts:

1. **No training** — inference and receipts only;
2. **Tenant improvement** — isolated retrieval, prompts, or adapters for that
   tenant; and
3. **Shared improvement opt-in** — explicitly licensed, minimized, reviewed,
   and de-identified examples.

Secrets, credentials, raw tokens, personal data without a lawful purpose, and
cross-tenant identifiers are excluded before dataset creation.

## Data sources

Build the first corpus from:

- synthetic AMOS qualification fixtures;
- public or AMOS-owned sample companies;
- human-authored gold tool traces;
- stronger-model traces accepted only after deterministic verification;
- failed local-model traces paired with corrected outcomes;
- approval-state and tenant-boundary adversarial generation;
- code tasks with hidden tests and repair transcripts; and
- explicitly opted-in, human-reviewed production examples.

Do not use approval alone as a positive label. Humans may approve a weak action,
deny a good action for external reasons, or edit wording without changing the
underlying decision.

## Training sequence

### 1. Supervised behavior

Teach the harmony/tool format, engine loading, AMOS vocabulary, compact
responses, and correct state narration using gold traces.

### 2. Rejection sampling

Generate several candidate plans with a stronger teacher. Keep only candidates
that pass deterministic policy, tool-schema, tenant, receipt, and executable
tests.

### 3. Preference optimization

Create pairs from:

- verified versus invalid tool sequences;
- accurate versus false execution claims;
- grounded versus uncited/conflicted answers;
- accepted human edits versus the superseded draft; and
- efficient versus wasteful plans with equivalent verified outcomes.

### 4. Outcome-aware tuning

Use business outcomes only where the measurement window and attribution are
credible. Optimize bounded decisions, not raw metric movement. A campaign that
improved during a seasonality spike is not automatically a good training label.

### 5. Distill escalation

Train the student to recognize when a frontier reviewer changed its answer,
which verification failed, and when local execution should stop and escalate.
Calibrated abstention is a model capability.

## Evaluation

Hold out by company, time, workflow template, and tool version. Random prompt
splits leak near-duplicate receipts and overstate performance.

Release gates for the first AMOS Operator:

- at least 14/16 on the current hard qualification suite;
- 100% on a 10,000-case deterministic tenant-boundary set;
- at least 99.5% correct parked/executed/failed state classification;
- at least 95% correct dependent tool sequencing on held-out workflows;
- executable verification on all generated code before a success claim;
- at least 15 generated tokens/second on a 64 GB Apple Silicon reference
  machine;
- resident footprint below 24 GiB at 128K context; and
- a measured reduction in managed-model escalations without a governance
  regression.

The tenant and approval thresholds are deliberately higher than general answer
quality because deterministic enforcement and structured rendering should
carry those critical states.

## Minimal program

1. Freeze qualification suite v1 and produce 5,000 synthetic/adversarial traces.
2. Export a consent-aware training record from local and managed receipt
   pipelines.
3. Build a deterministic sanitizer and dataset ledger.
4. Fine-tune a GPT-OSS 20B adapter on gold tool/state traces.
5. Compare base versus adapter on untouched companies and tool versions.
6. Merge or serve the adapter only after capability-contract review.
7. Run it first in shadow mode: local model proposes, existing route executes.
8. Graduate workflows individually from observe to draft to propose.

## Strategic payoff

The defensible asset is not merely a checkpoint. It is the governed improvement
system:

- durable company context;
- structured action and policy evidence;
- reproducible evaluation;
- safe deployment and rollback;
- per-tenant adaptation without cross-tenant leakage; and
- outcome-aware routing between local, private, and hosted models.

That lets AMOS improve specialty intelligence continuously while remaining
model-independent.
