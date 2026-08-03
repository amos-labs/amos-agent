# AMOS context compiler

Large context windows are useful capacity, not a substitute for selecting the
right evidence. AMOS should compile a bounded working set for each model turn
from durable company memory, current company state, local material, policy, and
the task at hand.

The goal is to make a 32K–128K window behave like a much larger organizational
memory without silently discarding authority, provenance, or contradictory
evidence.

## Implemented Desktop slice

Desktop now compiles restart continuity from a versioned,
provider-neutral `amos.continuity_manifest` instead of replaying complete prior
answers. The encrypted store still retains the bounded source milestones, while
the model receives at most 7,000 characters containing the latest objective and
outcome, workflow, structured action states, receipt references, safe artifact
references, open loops, and any intelligence handoff. Older transitions enter
only while budget remains.

The manifest has typed slots for decisions, commitments, corrections, and open
loops. The first implementation populates workflow and action state
deterministically from local receipt events; richer semantic state can be added
without changing the transport contract. Field values remain untrusted
orientation, current authority must be fetched again, and the manifest never
grants replay permission.

Continuity is held separately from chat history and compiled into a standard
system/assistant/user message sequence at request time. The same contract is
used for hosted, OpenAI-compatible, Kimi, and local runtimes. A private
in-memory context receipt records provider, model, workflow, message and tool
counts, prompt characters, and continuity characters so prompt changes can be
measured without retaining prompt content.

Built-in workflow guidance is also compiled as a compact task contract. Desktop
shows the workflow to the user, so the model does not receive repeated skill
descriptions or narrate routine planning. This improves time-to-work and keeps
the interaction focused on results.

Canvas schemas are progressive as well. Ordinary chat omits them. An explicit
user request reveals presentation capability, while a dense captured AMOS
result can reveal only the smaller deterministic company-view tool. Canvas
updates become available once a view is active or the user asks to revise one.
This makes chat the default without preventing a requested or genuinely richer
visual experience.

Online company mode now adds a governed cross-client lane on AMOS Platform.
Desktop quietly checkpoints compact state at a completed task boundary and
hydrates the newest valid local or shared manifest on a fresh runtime. The
shared record is pinned to authenticated user + tenant + context key, rejects
transcript-sized payloads, retains bounded history, and remains client-reported
orientation rather than company memory or proof.

`resume_company` includes that user's latest checkpoint automatically;
compatible clients can load the smaller `hydrate_context` verb and call
`capture_context` at a handoff boundary. This makes Desktop, Claude, Codex, and
future MCP clients interoperable through AMOS. It cannot extract a private
conversation from a client that never sends a checkpoint, and a client without
AMOS MCP still needs an explicit transfer path.

## Invariants

1. **Authority is never summarized away.** Identity, tenant, scope, active
   policy, approval state, and operating boundary are included verbatim from
   current trusted sources.
2. **Facts retain provenance.** Every selected fact or summary carries a source
   reference, observation time, and visibility class.
3. **Private and company context stay distinct.** Local task material is not
   promoted into shared company memory merely because a model used it.
4. **Compression cannot manufacture certainty.** Conflicts, missing evidence,
   stale observations, and inference labels survive compilation.
5. **Tool schemas are progressive.** The bootstrap and engine index remain
   small; full schemas enter the window only when the task needs that engine.
6. **The model does not choose its own authority.** Retrieval may improve
   relevance but cannot add scopes, approvals, or execution rights.

## Compiled working set

Each turn receives an ordered package:

1. **Operating envelope**
   - system instructions;
   - identity, tenant, role, and current boundary;
   - active policy and approval constraints.
2. **Task contract**
   - the user's current objective;
   - selected workflow and verification criteria;
   - user steering received during the task.
3. **Live working state**
   - active goal, pending decisions, latest tool results, and unresolved errors;
   - a bounded recent conversation tail.
4. **Relevant organizational evidence**
   - query-aware excerpts from `resume_company`, company memory, receipts, and
     connected sources;
   - contradictory or higher-authority evidence placed adjacent.
5. **Local/private evidence**
   - only files, attachments, private memory, and cached context explicitly
     available to this task.
6. **Capability surface**
   - bootstrap tools plus schemas for already selected engines and local skills.

## Selection and compression

Candidates are ranked deterministically before model synthesis:

```text
utility =
  task relevance
  × source authority
  × freshness
  × evidence confidence
  × diversity bonus
  ÷ token cost
```

Hard-required operating and policy material is allocated first. Remaining
tokens are divided among current task state, evidence, tool schemas, and a
response reserve. No single document or chat branch may consume the entire
evidence budget.

Compression is hierarchical:

- keep exact identifiers, numbers, dates, decisions, and policy language;
- extract evidence spans before summarizing documents;
- merge repeated facts while preserving all source references;
- represent long histories as state transitions and open questions;
- retain a short recent-turn tail rather than replaying the complete chat;
- retrieve the original source again when the user asks for detail.

## Context receipt

Every compiled turn should produce a private diagnostic receipt containing:

- compiler version and token budget;
- included source references and observation times;
- excluded candidates and the reason for exclusion;
- summaries used and their source fingerprints;
- loaded engines, tools, skills, and workflow;
- stale, conflicting, or missing evidence warnings.

This is not a company action receipt. It lets AMOS debug grounding failures,
reproduce a model turn, and compare context strategies without exposing private
prompt material to other tenants or users.

## Adaptive windows

AMOS selects a safe ceiling from the model, quantization, available unified
memory, and operating mode. The compiler normally targets a smaller working set
than that ceiling:

- interactive questions favor a compact set and response speed;
- document synthesis and coding may request a larger evidence budget;
- long research or audit work may expand to the machine's qualified ceiling;
- an advanced setting may cap the window, but cannot weaken the invariants.

A larger ceiling therefore provides burst capacity while the compiler keeps the
routine prompt dense.

## Evaluation

Context changes must be measured on AMOS tasks, not only retrieval benchmarks:

- exact fact and citation recall;
- contradictory-evidence handling;
- stale-state detection;
- tool selection and argument accuracy;
- policy and approval compliance;
- code and structured-output correctness;
- time to first token, total latency, peak memory, and tokens consumed;
- continuity after task steering, restart, and model change.

Qualification fixtures should include deliberate distractors and facts that
differ only by tenant, date, or approval state.

## Delivery sequence

1. Instrument current prompts and emit local context receipts.
2. Add deterministic token budgets and progressive transcript compaction.
3. Rank company, local, and receipt evidence with provenance-preserving
   selection.
4. Add hierarchical summaries with source fingerprints and invalidation.
5. Tune adaptive window profiles from the local-model qualification suite.
6. Allow tenant-reviewed context policies to narrow selection without changing
   authority.
