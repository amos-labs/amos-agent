# AMOS Deterministic Operating Runtime

**Status:** Platform architecture design  
**Initial design date:** August 9, 2026  
**Design axiom:** The model builds and improves the operating system; the
operating system does not depend on the model to keep running.

## 1. Decision

AMOS will separate AI-assisted authoring and operation from deterministic
execution.

A human, visual builder, or AI operator can assemble an operating package from
approved AMOS primitives. AMOS validates, tests, backtests, approves, versions,
and compiles that package into durable execution artifacts. A scheduler and
worker runtime then operates the package without an LLM dependency.

If all model providers are offline, the platform must still:

- connect to approved systems using existing credentials and typed adapters;
- ingest and validate new data;
- apply published mappings and transformations;
- calculate official metrics and scorecards;
- evaluate triggers, conditions, and state transitions;
- route required approvals;
- execute already-authorized deterministic actions;
- generate tables, charts, exceptions, and a readable base report;
- record run state, lineage, cost, failures, and receipts; and
- resume or retry work according to the published package policy.

Models remain valuable for authoring, explanation, bounded investigation,
hypothesis generation, and proposing the next package version. They are an
intelligence overlay, not the heartbeat of the system.

## 2. The three planes

### 2.1 Build and control plane

Used to create and govern an operating package:

- visual configuration studio;
- natural-language AI operator;
- reusable vertical templates;
- source and field mapping;
- formula, rule, schedule, and report design;
- simulation, fixtures, and historical backtesting;
- authorization, approval, and publication;
- version diff, rollback, and retirement; and
- monitoring, disputes, and package improvement.

AI may produce a draft here. It cannot make a draft official.

### 2.2 Deterministic run plane

Runs published packages:

- typed connectors and canonical data contracts;
- incremental ingestion and watermarks;
- deterministic transformations and calculations;
- rules and state machines;
- durable triggers, queues, leases, and retries;
- policy gates and human approvals;
- materialized results and base reports;
- proof receipts and operational telemetry; and
- dead-letter and replay workflows.

This plane has no required inference call.

### 2.3 Optional intelligence overlay

Enriches completed or exceptional work:

- rewrite a base report for an executive, operator, or franchisee;
- investigate a ranked exception using a bounded evidence packet;
- identify additional patterns or hypotheses;
- distinguish evidence, inference, and speculation;
- recommend an intervention or relevant learning;
- answer questions over official results; and
- propose a new mapping, recipe, rule, or package version.

An overlay result is never the authoritative metric or hidden execution state.
It is versioned, labeled, cited, and subject to the normal AMOS action boundary.

## 3. Architecture

~~~mermaid
flowchart TB
    subgraph Build["Build and control plane"]
        A["Human, template, or AI operator"] --> B["Operating package draft"]
        B --> C["Type, unit, graph, authority, cost, and safety compiler"]
        C --> D["Fixtures, simulation, and historical backtest"]
        D --> E["Human approval and immutable publication"]
    end

    subgraph Run["Deterministic run plane"]
        E --> F["Published execution plan"]
        F --> G["Durable scheduler and event triggers"]
        G --> H["Typed connectors and incremental ingestion"]
        H --> I["Transform, metric, rule, and state-machine DAG"]
        I --> J["Materialized results, exceptions, and base reports"]
        J --> K["Approval and typed action runtime"]
        K --> L["Receipts and outcome measurement"]
    end

    subgraph Overlay["Optional intelligence overlay"]
        J -. bounded evidence packet .-> M["Explanation and investigation"]
        M -. governed proposal .-> K
        M -. package improvement draft .-> B
    end
~~~

The solid path is sufficient to operate the company workflow. The dotted path
improves it when model capacity is available.

## 4. The compiled operating package

The durable product unit is an immutable **operating package version**. It
contains declarations, dependencies, tests, and failure policies—not a prompt
that must be rerun to rediscover the workflow.

An operating package can contain:

- source connections and read contracts;
- canonical schemas, dimensions, units, and mappings;
- transformations and metric recipes;
- cohort, benchmark, scorecard, and initiative definitions;
- event, data-change, and schedule triggers;
- conditions, rules, and state machines;
- typed external and internal actions;
- human approval points;
- deterministic report templates;
- optional intelligence-enrichment nodes;
- budgets, timeouts, retries, and service objectives;
- fixtures, invariants, and backtest requirements; and
- owners, approvers, effective dates, lineage, and receipts.

Illustrative package structure:

~~~yaml
kind: operating_package
key: location_performance_weekly
version: 8
scope: corporate_location_network

sources:
  - key: crm
    connector: approved_crm_v2
    mapping_version: neighborly_crm_v4
    watermark: updated_at
  - key: finance
    connector: approved_erp_v1
    mapping_version: neighborly_finance_v2
    period_close_required: true

transforms:
  - key: qualified_leads
    recipe: canonical_qualified_leads_v3
  - key: booked_jobs
    recipe: canonical_booked_jobs_v2

metrics:
  - key: lead_conversion_rate
    recipe: lead_conversion_rate_v3

scorecards:
  - key: growth_initiative
    version: 5

automations:
  - key: weekly_exception_review
    trigger:
      schedule: "weekly: monday 06:00 tenant-local"
    when:
      rule: materially_below_target_v2
    actions:
      - create_internal_exception
      - route_to_location_owner
      - request_human_approval_if_external_action

reports:
  - key: weekly_location_scorecard
    template: location_scorecard_v4
    formats: [json, html, pdf]

enrichments:
  - key: executive_narrative
    mode: optional
    input: weekly_location_scorecard_evidence_packet
    timeout_seconds: 90
    offline_behavior: publish_base_report_and_queue_enrichment
~~~

The syntax is illustrative. The important property is that every runtime
decision is explicit and versioned.

## 5. Compilation model

The AI operator should not normally generate unrestricted application source
that is silently deployed. It should generate a bounded intermediate
representation from platform primitives.

The compiler then emits the appropriate execution artifacts:

- parameterized SQL for canonical transformations and aggregates;
- typed connector read and write plans;
- dependency and invalidation graphs;
- rule predicates and scoring functions;
- durable state-machine definitions;
- schedule and event-trigger registrations;
- deterministic HTML, table, chart, and document report plans;
- data-quality, reconciliation, and exception policies; and
- an execution manifest with resource, timeout, retry, and authority limits.

This still achieves the user's goal of “created as code.” The compiled plan is
executable, testable, diffable, and schedulable, but it stays inside a governed
language AMOS can reason about.

Arbitrary custom code is an escape hatch, not the default. It requires:

- an isolated runtime with no ambient credentials;
- explicit input and output schemas;
- pinned dependencies and a reproducible build;
- CPU, memory, time, egress, and data-scope limits;
- security and fixture validation;
- package signing and immutable versioning;
- separate authorization to publish; and
- the same receipt, replay, and observability contract as native primitives.

## 6. Platform primitive catalog

The first primitive families should be:

| Family | Deterministic responsibility |
| --- | --- |
| Source | Typed connector read, file/import snapshot, watermark, freshness |
| Mapping | Source field to canonical field, unit, dimension, classification |
| Transform | Bounded filter, join, aggregate, window, normalization |
| Metric | Formula, period, denominator, unit, currency, data-quality policy |
| Cohort | Comparable-unit membership and effective version |
| Scorecard | Scoring curve, weight, gate, rollup, missing-data behavior |
| Rule | Typed predicate over current materialized state |
| Trigger | Schedule, source event, result change, threshold transition |
| State machine | Explicit states, transitions, timers, and terminal outcomes |
| Approval | Required authority, decision state, expiry, and escalation |
| Action | Typed internal or external mutation with idempotency and receipt |
| Report | Deterministic data contract, layout, chart, and templated narrative |
| Enrichment | Optional bounded model task with schema and offline fallback |
| Test | Fixture, invariant, backtest, tolerance, and expected result |

Each primitive has a stable schema, compiler validation, runtime limits, and
version compatibility policy.

## 7. Integration design

Integrations are deterministic adapters, not model conversations.

The published connection package defines:

- the exact provider and authorized connection identity;
- allowed endpoints or product operations;
- input and output schemas;
- pagination, checkpoint, and watermark behavior;
- rate-limit and retry policy;
- canonical field mappings and unit conversions;
- deletion, late-arrival, and replay semantics;
- source classification and evidence references; and
- secret resolution by the platform at execution time.

AI can help map an unfamiliar payload into the canonical contract, but that
mapping becomes a reviewed versioned artifact. Once published, the connector
does not ask a model how to interpret each row.

Schema drift must fail visibly:

- compatible additions can be ignored or captured according to policy;
- incompatible changes quarantine the affected partition;
- prior materialized results remain available and labeled with freshness;
- owners receive a deterministic drift alert; and
- AI may propose a new mapping draft, but cannot auto-publish it.

## 8. Analysis design

Routine analysis is a dependency graph of deterministic transforms, metrics,
benchmarks, scores, and rules.

The run pattern is:

~~~text
source watermark
  -> changed canonical partitions
  -> invalidated dependency nodes
  -> bounded recomputation
  -> materialized official results
  -> changed scorecards and exceptions
  -> deterministic report artifact
  -> optional intelligence enrichment
~~~

The same source snapshot and package version must reproduce the same output.
Randomness, current clock access, external mutable lookup, or model output
cannot enter an official formula unless it is converted into a separately
versioned source observation with provenance and an explicit policy.

## 9. Automation and scheduling design

Cron is a useful trigger but not a workflow engine. AMOS needs a durable
scheduler and queue with:

- tenant-local and UTC schedule semantics;
- event and data-change triggers;
- misfire and catch-up policy;
- idempotency keys;
- leases and concurrency control;
- step-level persisted state;
- bounded retry with backoff;
- dead-letter and operator replay;
- dependency and freshness gates;
- approval wait states;
- per-package time and cost budgets;
- cancellation and supersession;
- receipts for every material transition; and
- complete telemetry for due, running, waiting, failed, and completed work.

A scheduled run loads the immutable published version it was assigned. A new
package version does not silently change an in-flight run.

Actions are typed platform operations. Existing policy, RBAC, approvals,
idempotency, and receipts remain the authority boundary regardless of whether a
human, schedule, data event, or model proposal initiated the work.

## 10. Reporting design

Every report has a deterministic base layer and an optional intelligence layer.

### Deterministic base report

Always available and suitable for operational use:

- title, scope, period, and package version;
- official metrics, scorecards, charts, and initiative status;
- deterministic templated statements for thresholds and changes;
- ranked exceptions based on published rules;
- data freshness, completeness, reconciliation, and caveats;
- source and algorithm lineage; and
- links to governed evidence and pending actions.

Example deterministic text:

> Lead conversion is 18.4%, 3.1 percentage points below the 21.5% target. The
> score is provisional because 2 of 14 required days are incomplete.

No model is needed to produce that sentence.

### Optional intelligence layer

May add:

- audience-specific narrative;
- synthesis across several official findings;
- likely-driver investigation;
- additional relationships worth testing;
- questions the available evidence cannot answer;
- recommended bounded interventions; and
- relevant learning or playbook suggestions.

The report clearly distinguishes official values, deterministic statements, AI
inference, and unverified hypotheses.

If the model is unavailable, AMOS publishes the base report on time and may
queue enrichment for later. It never withholds the official report merely
because prose could not be improved.

## 11. Model-node contract

An operating package may include a model node only when it declares:

- purpose and input evidence schema;
- output schema;
- optional or required mode;
- provider/model policy and allowed fallback tier;
- timeout, retry, token, and cost budget;
- caching and deduplication policy;
- validation and citation rules;
- offline behavior;
- authority of its output; and
- retention and receipt behavior.

Default mode is optional.

For optional nodes:

- deterministic downstream work continues;
- the base artifact is marked enrichment_pending or enrichment_unavailable;
- enrichment may be retried later without changing the official calculation;
  and
- a stale prior narrative is never presented as current.

A required model node is permitted only where the business operation truly
cannot exist without semantic generation. Its unavailability pauses that
specific step in a visible waiting state; it does not block unrelated packages
or corrupt deterministic state.

## 12. Failure and recovery semantics

The runtime must distinguish:

- source unavailable;
- schema drift;
- data incomplete or unreconciled;
- deterministic calculation failure;
- approval pending or expired;
- action provider failure;
- model enrichment unavailable;
- budget exhausted; and
- package superseded or manually stopped.

Each state has an explicit retry, fallback, notification, and terminal policy.
“AI failed” cannot become a generic error that hides a usable deterministic
result.

The platform should support replay from:

- a source snapshot;
- a failed step;
- an exception;
- a package version; or
- a historical period for backtesting.

Replay must not duplicate external effects. Typed actions use stable
idempotency keys and read-back where the provider supports it.

## 13. Governance and security

- Drafting authority is separate from publication authority.
- AI-generated drafts retain model, input references, and review provenance.
- Every published package is immutable, signed or content-addressed, and
  receipted.
- Tenant, workspace, operating-unit, and connection boundaries are compiled
  into the execution plan and revalidated at runtime.
- Secrets are resolved only for the exact typed connector/action step and never
  stored in package definitions, prompts, reports, or receipts.
- A schedule has no independent authority; it exercises only the package's
  current permitted operations.
- Consequential actions still park for the required human or policy approval.
- Official calculations and base reports never depend on model-generated
  unstructured text.
- Cross-tenant data and benchmarks require explicit separate authority and
  privacy controls.

## 14. No-model survival test

The release gate should include an end-to-end test with every model route
disabled:

1. A scheduled or event-triggered package becomes due.
2. A typed connector ingests a fixture increment using a watermark.
3. Published mappings produce canonical facts.
4. Metric and scorecard recipes recompute only affected partitions.
5. A threshold transition creates an exception.
6. A deterministic base report is generated with evidence and caveats.
7. An allowed internal action completes, or a consequential action parks.
8. Receipts and telemetry show a successful deterministic run.
9. The optional narrative node records enrichment_unavailable.
10. When model access returns, enrichment can complete without rerunning or
    changing the official calculations.

This test is a platform invariant, not merely a Neighborly acceptance test.

## 15. Mapping to the current AMOS platform

The repository already contains much of the runtime substrate. The design is a
generalization and composition effort, not a rewrite.

| Existing primitive | What is already present | Direction |
| --- | --- | --- |
| Declarative connector spec and trusted runtime | Specs are data; closed HTTP method set; vaulted credentials; pagination; mapping; dedupe; retry/backoff; OAuth refresh; bounded runtime | **Reuse.** Extend canonical mappings beyond current domains and add explicit drift/watermark contracts where missing. |
| Provider-neutral connection operation contracts | Exact method/path/schema/consequence; human activation; active revision pinned before policy; typed execution; writes park | **Reuse as the external action/read primitive.** Do not create a second generic connector call system. |
| Ingestion scheduler | Durable job rows; cursors; bounded slices; concurrency cap; leases; stale-worker recovery; resumable work; multi-instance-safe claims | **Extract/reuse the job semantics.** Generalize the claim/run-state substrate instead of starting another independent scheduler loop. |
| Automation runner | Tenant-authored trigger and step JSON; per-subject enrollment state machine; dedupe; leases; wait; email; bounded AI step; retry/caps; receipts; record, webhook, and calendar triggers | **Extend.** Make the step/trigger registry generic, version definitions immutably, and add deterministic rule, transform, report, approval, and typed-action nodes. |
| Calendar-relative automation | Deterministic regex/category/domain matching with optional bounded semantic fallback and exact connection binding | **Use as the reference pattern** for deterministic-first matching plus optional intelligence. |
| First-class Briefings | Tenant-owned definitions; allowlisted read source plans; immutable definition snapshots and run results; supervised schedules; scope revalidation; receipts | **Extend into the report surface.** Add deterministic render plans, scorecard/chart primitives, and optional post-render narrative. |
| Company-performance loop | Provenance-carrying import batches; operating-unit hierarchy; metric definitions; observations; benchmarks; goal-compatible signals | **Reuse as the evidence foundation.** Add recipe versions, dependency DAGs, materialized derived results, scorecards, initiatives, and exceptions. |
| Goal pursuit and action adapters | Goals, measurements, proposal lifecycle, governed execution entry, and adapters into typed verbs | **Reuse for outcome loops and proposals.** Do not let a new package runtime bypass the existing agency boundary. |
| Policy, RBAC, pending operations, and typed action runtime | Scope resolution, consequence floors, approval parking, execution-time revalidation, idempotent action history, and receipts | **Reuse unchanged as the authority boundary.** A schedule or compiled package gains no independent authority. |
| Operation receipts | Durable intent, guardrail, evidence, output, and verdict trail | **Reuse.** Add package/run/version correlation rather than a parallel audit log. |
| Hosted intelligence | Managed model routing, limits, metering, and fallbacks | **Reposition as author/operator and optional enrichment.** It should not be required for deterministic package execution. |

### What is genuinely missing

The gaps are narrower and more specific than “build an automation platform”:

1. A unified operating-package intermediate representation that composes the
   existing connector, ingestion, performance, automation, Briefing, policy,
   action, and receipt primitives.
2. A compiler that validates graph cycles, schemas, units, authority, package
   budgets, offline behavior, fixtures, and version compatibility.
3. Immutable automation/package versions. The current named automation is
   updated in place; official enterprise workflows need exact historical
   versions and in-flight version pinning.
4. A generic trigger and step registry. The current runner is production-proven
   but marketing-shaped, with wait, send_email, and ai_run as its primary
   steps.
5. Deterministic transform, metric, cohort, scorecard, rule, report, and typed
   action nodes connected through one dependency graph.
6. Materialized derived-result, exception, and lineage contracts.
7. A deterministic report renderer with an optional enrichment boundary.
8. Package simulation, historical backtesting, version comparison, and
   estimated compute cost.
9. A platform-wide no-model survival integration test.
10. A self-service studio over the compiler and existing primitives.

### Consolidation rule

Do not add a fourth bespoke polling loop beside ingestion, automations, and
Briefings. First extract or wrap their proven lease, claim, retry, run-state,
and receipt patterns behind a shared job contract. Migration can be gradual:
existing runners remain compatible while new operating packages use the shared
substrate, then eligible legacy work moves onto it.

Likewise, do not add a second policy system, vault, connector runtime,
performance hierarchy, or Neighborly-specific execution stack. The operating
package compiler should bind the primitives already trusted by the platform.

## 16. Neighborly first application

The first package should:

- ingest the approved operational and financial source snapshots;
- run the published canonical mappings;
- calculate the seven initiatives and their component KPIs;
- identify material exceptions across the location hierarchy;
- create the weekly base scorecard and initiative report;
- route exceptions to the accountable owner;
- park consequential interventions for approval;
- select or draft relevant learning only where authorized; and
- measure the result of completed interventions.

The weekly report must still arrive with official values, charts, exceptions,
and caveats when the intelligence service is unavailable. The narrative can be
added later.

## 17. Implementation sequence

### Slice 1: operating package contract

- Define the intermediate representation, primitive registry, immutable
  versions, compiler errors, and publication lifecycle.
- Reuse current performance, connector, policy, and receipt contracts.
- Implement fixture validation and a minimal package manifest.

### Slice 2: durable deterministic runtime

- Scheduler, event trigger, queue, step state, idempotency, retry, watermark,
  and replay.
- Compile source, transform, metric, rule, report, and internal-action nodes.
- Add deterministic run telemetry and receipts.

### Slice 3: base reporting and no-model gate

- Deterministic JSON/HTML report contract and chart/table primitives.
- Threshold and caveat text templates.
- Full no-model survival integration test.

### Slice 4: AI operator and enrichment

- Natural-language package drafting and explanation.
- Evidence packet contract.
- Optional narrative/investigation node with timeout, budget, fallback, and
  deferred completion.

### Slice 5: self-service studio and package marketplace

- Visual graph, mapping, rule, metric, scorecard, automation, and report
  builders.
- Version diff, simulation, backtest, approval, publication, monitoring, and
  vertical templates.

## 18. Acceptance criteria

The architecture is working when:

- a published package runs on schedule with all model routes disabled;
- data ingestion, official analysis, automation state, and base reporting are
  deterministic and replayable;
- the same snapshot and package version reproduce byte-equivalent structured
  results within declared formatting rules;
- model downtime is recorded as enrichment state, not platform failure;
- a model-generated draft cannot execute until compilation, tests, approval,
  and publication succeed;
- changed data recomputes only affected graph partitions;
- failed jobs resume without duplicated external effects;
- every official value and action exposes source, version, authority, and
  receipt lineage;
- schedules cannot exceed the package's current authorization;
- custom code, if present, cannot access ambient tenant data or credentials;
- base reports remain readable and useful without generated prose; and
- model usage is measured per optional enrichment or investigation, never per
  raw row as a substitute for normal compute.

## 19. Core product language

The simple explanation is:

> AMOS uses AI to design and improve the operating system, then compiles that
> design into governed automations and analysis that keep running whether the
> AI is online or not.

That is more defensible, reliable, and economical than an agent repeatedly
reading a data lake and rediscovering the same business logic.
