# AMOS Deterministic Metrics, Scorecard, and Initiative Engine

**Status:** Product and technical design  
**Initial design date:** August 9, 2026  
**First deployment:** Neighborly corporate and franchise network  
**Product principle:** Models interpret; approved deterministic recipes calculate.

## 1. Decision

AMOS will build a tenant-scoped calculation engine that lets authorized users
configure, test, approve, publish, and operate financial KPIs, operating
scorecards, and corporate initiatives across any hierarchy of companies,
brands, regions, franchises, locations, departments, or business units.

The engine will not send raw data lakes to an LLM for routine analysis. It will
calculate incrementally, persist reproducible results, rank material
exceptions, and provide the AI layer with compact evidence packets only when
interpretation or action design adds value.

Neighborly's seven initiatives are the first configuration pack, not seven
hard-coded product features. Their exact names and scoring rules remain open
inputs until Neighborly provides the authoritative definitions.

This engine is one package type on the broader
[AMOS Deterministic Operating Runtime](DETERMINISTIC_OPERATING_RUNTIME.md). It
must reuse the platform's existing declarative connector runtime, resumable
ingestion scheduler, automation enrollment/state-machine patterns, governed
Briefing definitions and schedules, policy/action gate, and proof receipts.
With all model routes disabled, scheduled ingestion, KPI calculation,
scorecards, exceptions, deterministic base reports, and already-authorized
automation steps must still complete.

## 2. Outcomes and non-goals

### Outcomes

- A corporate operator can configure a KPI or scorecard without a custom code
  release for every formula change.
- The same source snapshot and recipe version always produce the same result.
- Every displayed value can be traced to source evidence, mappings, formula,
  algorithm version, time window, cohort, and data-quality state.
- One approved corporate pack can run across thousands of locations and roll up
  through the organization hierarchy.
- The engine can backtest a draft version before it changes a live scorecard.
- Scheduled calculations and usable base reports complete when every LLM
  provider is unavailable.
- AI use is concentrated on mapping assistance, exception investigation,
  explanation, recommended interventions, and relevant learning.
- Tenant isolation, authorization, approval, and receipts match the rest of the
  AMOS governed operating layer.

### Non-goals for the first release

- A general-purpose arbitrary-code execution environment.
- Autonomous publication of AI-generated formulas.
- Unbounded ad hoc querying across raw customer data.
- Claims of causal impact without a valid experimental or quasi-experimental
  design.
- A new warehouse that requires every customer to abandon its existing data
  platform.
- Cross-customer benchmarking without explicit contractual, privacy, and
  aggregation authority.

## 3. Product model

The reusable object hierarchy is:

~~~text
Initiative Pack
  -> Initiative
     -> Objective
        -> Scorecard
           -> Scored Component
              -> Metric Recipe
                 -> Canonical Measures / Other Metrics
~~~

An **initiative pack** contains the corporate program for a defined effective
period. An initiative may contain one or more objectives. Each objective uses
a scorecard. Each scorecard references deterministic metric recipes and defines
how those values become a score, status, exception, and intervention trigger.

Each definition follows the same lifecycle:

~~~text
Draft -> Validated -> Backtested -> Approved -> Active -> Superseded/Retired
~~~

Only Active versions may produce official scorecards. Editing an active
definition creates a new draft; it never mutates historical results.

## 4. Existing foundation to extend

The managed platform already has a useful company-performance foundation:

- performance_import_batches for provenance-carrying, replay-safe imports;
- performance_operating_units for the company-to-location hierarchy;
- performance_metric_definitions for canonical metric identity and units;
- performance_observations for time-bounded measured values;
- performance_benchmarks for targets and comparable reference values; and
- governed record_performance_snapshot and get_performance_snapshot
  surfaces feeding the existing goal/performance loop.

The new engine should extend this contract. It should not create a parallel
Neighborly-only data model or relocate official calculations into Desktop.

## 5. Target architecture

~~~mermaid
flowchart LR
    A["Approved source systems"] --> B["Connectors and source snapshots"]
    B --> C["Canonical measures and data-quality checks"]
    C --> D["Recipe compiler and dependency DAG"]
    D --> E["Incremental deterministic workers"]
    E --> F["Materialized metric results"]
    F --> G["Scorecard and initiative rollups"]
    G --> H["Ranked exceptions and evidence packets"]
    H --> I["AI explanation and recommendation"]
    I --> J["Approval, action, or relevant learning"]
    J --> K["Outcome measurement"]
    K --> F
~~~

### 5.1 Definition registry

Stores immutable versions of:

- canonical measures and dimensions;
- metric recipes and their dependencies;
- cohort definitions;
- scoring functions and component weights;
- scorecards, objectives, initiatives, and packs;
- schedules and effective periods;
- data-quality and reconciliation rules;
- test fixtures and expected results; and
- owners, approvers, publication receipts, and change rationale.

Corporate definitions can be inherited by brands and locations. Tenant policy
must explicitly say which fields a child scope may override. The resolved
configuration and its complete inheritance chain are stored with every run.

### 5.2 Recipe compiler and validator

The studio produces a declarative recipe, not executable customer code. A
compiler validates it and builds a directed acyclic graph of dependencies.

The initial allowlist should include:

- arithmetic and comparisons;
- sum, count, count_distinct, min, max, average, and weighted average;
- safe_divide with explicit zero-denominator behavior;
- fiscal and calendar period bucketing;
- lag, change, growth rate, rolling windows, and year-over-year comparison;
- filters over approved dimensions;
- percentile and cohort rank over a declared comparable group;
- bounded winsorization or exclusion rules; and
- currency conversion using an approved, dated rate source.

Publication validation must reject:

- unknown fields, metrics, units, currencies, or dimensions;
- circular metric dependencies;
- incompatible units;
- missing data policies;
- non-deterministic functions;
- unbounded joins or cardinality explosions;
- invalid fiscal periods or effective dates;
- weights that do not satisfy the scorecard policy;
- a cohort that includes prohibited or incomparable units; and
- a recipe without passing fixtures and backtest evidence.

### 5.3 Execution engine

Start SQL-first. Compile recipes to bounded, parameterized SQL against canonical
tables or an approved customer-warehouse execution target, with Rust services
handling orchestration, validation, idempotency, policy, and receipts. Add a
columnar worker only for workloads that exceed the measured SQL operating
envelope; do not introduce a distributed processing stack preemptively.

Execution is incremental:

1. A source import or watermark identifies changed periods, units, and facts.
2. The dependency graph determines which metric results are invalidated.
3. Workers compute only the affected partitions.
4. Scorecards and rollups recompute only where component results changed.
5. Material changes create or update exceptions and evidence packets.
6. AI is invoked only by an approved workflow, user request, or exception rule.

Each run is idempotent on at least:

~~~text
tenant + definition_version + operating_unit + period + input_snapshot
~~~

Retries must return or replace the same logical result, never create competing
official values.

### 5.4 Materialized result store

Metric and score results should carry:

- tenant and operating-unit identity;
- period start/end and calculation timestamp;
- metric, scorecard, initiative, and algorithm version identifiers;
- numeric value, unit, normalized score, and status where applicable;
- input snapshot and watermark;
- source and evidence references;
- sample size and completeness;
- reconciliation state;
- missing-data and outlier decisions;
- cohort and benchmark version;
- calculation receipt; and
- supersession state.

The official read path returns materialized results. It does not recalculate a
portfolio during a chat request.

### 5.5 Evidence packet service

An evidence packet is the compact boundary between deterministic compute and
AI reasoning. A packet should contain only what the investigation needs:

- the observed value and score;
- target, threshold, benchmark, and comparable cohort;
- current trend and a bounded prior-period series;
- material component contributions;
- completeness, reconciliation, and confidence warnings;
- cited source and algorithm versions;
- related approved goals and prior interventions; and
- links to governed artifacts for deeper authorized inspection.

Raw transactions remain behind typed queries and access policy. They are not
silently copied into a prompt.

## 6. Declarative recipe contract

The stored representation may be JSON, but a readable YAML form makes review
and test fixtures easier. This example is illustrative, not a Neighborly rule:

~~~yaml
kind: metric_recipe
key: lead_conversion_rate
version: 3
scope: location
effective_from: 2026-10-01
inputs:
  - canonical.qualified_leads
  - canonical.booked_jobs
formula:
  function: safe_divide
  numerator: canonical.booked_jobs
  denominator: canonical.qualified_leads
window:
  grain: month
  rolling_periods: 3
dimensions: [brand, region, service_line]
unit: percent
minimum_sample_size: 30
missing_data: not_scored
zero_denominator: not_scored
late_data: provisional_until_period_close
outliers:
  policy: flag_only
reconciliation:
  required: true
  source: approved_crm_snapshot
tests:
  fixture_set: lead_conversion_v3
owner_role: corporate_performance_admin
approval_policy: finance_and_operations
~~~

Natural-language authoring can translate a request into this structure and
explain it. It cannot bypass compilation, fixtures, backtesting, approval, or
version publication.

## 7. Scoring model

Every scorecard component declares one scoring function. Supported initial
functions should include:

- **Higher is better:** interpolate between an explicit floor and target.
- **Lower is better:** reverse interpolation between target and ceiling.
- **Target band:** full score inside the band with declared decay outside it.
- **Threshold steps:** explicit point values for named ranges.
- **Boolean gate:** pass/fail, optionally overriding the aggregate status.
- **Cohort percentile:** score against a versioned comparable cohort.

For a basic linear component where higher is better:

~~~text
component_score = clamp(100 * (value - floor) / (target - floor), 0, 100)
~~~

For a basic lower-is-better component:

~~~text
component_score = clamp(100 * (ceiling - value) / (ceiling - target), 0, 100)
~~~

The default aggregate is:

~~~text
scorecard_score = sum(component_score * published_weight)
~~~

Weights must satisfy the published policy, normally summing to 1.0. The engine
must never silently normalize malformed weights. Missing components follow an
explicit policy:

- not_scored: no official aggregate is produced;
- fail_closed: the component receives its declared failure score;
- renormalize: remaining weights are rescaled, only when explicitly allowed;
- carry_forward: use the last reconciled value within a bounded age; or
- provisional: produce a clearly labeled non-final score.

Initiatives can also contain hard gates. A critical compliance or data-quality
gate may force an initiative to red even when the weighted score is high. The
UI must show the weighted result and the gate separately.

## 8. Financial-analysis controls

Financial scorecards require stricter semantics than general operating metrics:

- represent money in source minor units or exact decimal types, never binary
  floating point for official accounting values;
- preserve source currency and store the conversion-rate source and date;
- support tenant fiscal calendars, 4-4-5 calendars, and restated periods;
- distinguish open, provisional, closed, and restated accounting periods;
- reconcile reported totals to an approved ledger, ERP, or signed snapshot;
- separate bookings, billings, recognized revenue, cash, and ARR;
- require explicit treatment for refunds, credits, taxes, intercompany items,
  acquisitions, and discontinued units;
- enforce minimum denominators for ratios and rates;
- flag cohort-composition changes that can create misleading aggregate trends;
  and
- retain the immutable inputs and calculation version used for every official
  result.

The UI must not present an unreconciled or provisional figure as final. The
result state is part of the value:

~~~text
not_scored | provisional | reconciled | restated | superseded
~~~

## 9. Metric and Initiative Studio

The user experience should have six work areas:

1. **Sources and mappings:** canonical fields, units, dimensions, freshness,
   completeness, and lineage.
2. **Metric builder:** template selection, visual formula graph, windows,
   filters, cohorts, and data-quality rules.
3. **Scorecard builder:** scoring curves, weights, gates, statuses, rollup, and
   child-scope override policy.
4. **Initiative builder:** objectives, component scorecards, accountable owners,
   evidence requirements, and intervention playbooks.
5. **Test and backtest:** fixtures, historical replay, version comparison,
   changed rankings, unexpected nulls, and estimated compute cost.
6. **Publish and monitor:** approval, effective date, schedule, run health,
   disputes, drift, cost, and rollback/supersession.

AI assistance belongs beside the builder as a copilot:

- “Draft this metric from our policy document.”
- “Explain why this formula fails validation.”
- “Show which locations change status under version 4.”
- “Summarize the evidence for these 20 exceptions.”

AI-generated content is visually marked as a draft and retains its prompt,
source references, model route, and review outcome in the receipt trail.

## 10. Governance, tenancy, and security

- All definitions, inputs, results, jobs, and evidence are tenant-scoped and
  use the platform's existing row-level-security transaction pattern.
- Corporate, brand, region, and franchise roles receive separate read, draft,
  approve, publish, and override permissions.
- Formula publication is a governed company-state mutation with an approval and
  proof receipt.
- A user cannot publish a recipe that references a source, dimension, cohort,
  or unit outside their authority.
- Credentials and raw secret material are rejected from definitions and
  evidence packets.
- Definition versions and official results are append-only; corrections create
  superseding records.
- Cross-tenant benchmarks require explicit opt-in, minimum cohort sizes,
  aggregation/privacy controls, and contractual authority.
- Consequential interventions remain behind the existing AMOS policy and
  approval boundary.

## 11. Proposed service boundaries and data additions

Extend the existing performance contract with tenant-scoped resources similar
to:

- performance_measure_definitions
- performance_metric_recipe_versions
- performance_cohort_versions
- performance_scorecard_versions
- performance_scorecard_components
- performance_initiative_pack_versions
- performance_initiatives
- performance_definition_approvals
- performance_compute_runs
- performance_metric_results
- performance_score_results
- performance_exceptions
- performance_evidence_packets

Exact table boundaries should be finalized during implementation, but the
following separations are mandatory:

- stable identity versus immutable version;
- draft configuration versus active configuration;
- source observation versus derived result;
- official score versus AI narrative;
- calculation receipt versus intervention receipt; and
- corporate base pack versus resolved child-scope override.

Initial typed product/API operations should cover:

- list and inspect definitions;
- draft from a template or natural-language proposal;
- validate and estimate a recipe;
- run fixtures and historical backtests;
- compare two versions;
- request and record approval;
- publish or supersede a version;
- run or schedule affected computations;
- read scorecards, initiatives, evidence, and exceptions; and
- acknowledge, dispute, assign, or resolve an exception.

Generic SQL or arbitrary code execution should not be exposed as a tenant tool.

## 12. Neighborly first pack

The first production pack should include:

- the exact seven corporate initiatives supplied by Neighborly;
- the authoritative owner and business definition for each initiative;
- approximately 15-25 component KPIs chosen for data availability and ability
  to support an intervention;
- corporate, brand, region, franchise, and location rollups where authorized;
- current, prior-period, target, and comparable-cohort views;
- data-quality and reconciliation gates;
- historical backtesting before the first official publication;
- an explanation packet for every red or materially declining score;
- a governed intervention or relevant-learning playbook for each actionable
  exception category; and
- outcome measurement that separates association from demonstrated lift.

Before configuration begins, obtain from Neighborly:

1. The official seven initiative names and current scoring documentation.
2. Metric definitions, owners, sources, reporting cadence, and fiscal calendar.
3. Weighting, threshold, gate, exception, and missing-data policies.
4. Hierarchy, cohort, and brand-comparability rules.
5. At least 12 months of historical inputs and official score outputs for
   backtesting.
6. Known restatements, manual adjustments, and dispute workflows.
7. Authority for franchise-level visibility, benchmarks, and intervention.

Do not promise an exact score match until historical replay reconciles the AMOS
results with Neighborly's authoritative outputs and every accepted difference
is documented.

## 13. Delivery sequence

### Phase 0: contract and replay set — 1-2 weeks

- Confirm the seven initiatives and initial KPI inventory.
- Map existing performance tables and source contracts to the new versioned
  recipe model.
- Secure a de-identified or governed historical replay set.
- Define numerical tolerances and scorecard acceptance criteria.

### Phase 1: deterministic core — 3-4 weeks

- Definition registry, recipe schema, compiler, dependency graph, and fixtures.
- Incremental execution and idempotent materialized results.
- Lineage, completeness, reconciliation state, and receipts.
- Typed read path for metric and score results.

### Phase 2: Neighborly pack and backtest — 2-4 weeks

- Configure the seven initiatives and initial 15-25 KPIs.
- Reconcile historical results and document accepted variances.
- Add scorecard rollups, evidence drill-down, and ranked exceptions.
- Run production-shadow calculations before publishing official results.

### Phase 3: guarded self-service studio — 3-5 weeks

- Visual builders, templates, natural-language drafting, validation feedback,
  version diff, backtesting, approvals, and publication.
- Corporate inheritance and permitted child-scope overrides.
- Compute-cost estimate and run monitoring.

### Phase 4: intervention and learning loop — 2-4 weeks

- Evidence packet delivery to the AI layer.
- Exception triage, accountable owner, governed intervention, and receipts.
- Relevant-learning selection/generation with human approval.
- Post-intervention outcome measurement.

The phases can overlap after the contracts stabilize, but official scorecards
must not precede historical replay and reconciliation.

## 14. Acceptance criteria

The first release is ready when:

- the same snapshot and version reproduce identical results;
- fixture and property tests cover every supported formula/scoring function;
- all dependencies are cycle-checked and unit-checked before publication;
- a backtest reconciles the agreed Neighborly historical sample within declared
  tolerances;
- missing, late, unreconciled, and restated data produce the correct state;
- corporate and child-scope authorization and inheritance tests pass;
- a changed source partition recomputes only affected metrics and rollups;
- every value exposes its complete source and algorithm lineage;
- no production computation requires an LLM call;
- AI receives a bounded evidence packet rather than the raw data lake;
- publication and official runs produce verifiable receipts; and
- cost per scheduled refresh and time to configure a new scorecard are measured.

## 15. Operating metrics for the engine

- Percentage of official score values reproduced within tolerance.
- Data completeness and reconciliation rate by source and metric.
- Time from source change to refreshed scorecard.
- Percentage of runs that are incremental versus full replay.
- Deterministic compute cost per 1,000 units per refresh.
- Tokens and model cost per material exception, not per raw row.
- Time to configure, backtest, approve, and publish a new metric.
- Percentage of customer-specific work contributed back to reusable templates.
- Exception precision, acknowledgement, resolution, and measured intervention
  lift.
- Number and cause of score disputes or restatements.

## 16. Immediate decisions

1. Make this engine a P1 component of the distributed-organization core.
2. Assign one product owner and one senior data-platform/analytics engineering
   owner.
3. Treat the current performance-import model as the evidence foundation and
   design versioned recipes/results as an extension.
4. Obtain Neighborly's seven-initiative definitions and historical replay set
   before finalizing the schema.
5. Build the execution path SQL-first and measure when a columnar worker is
   justified.
6. Require fixtures, backtest, approval, and receipts before any formula can
   become official.
7. Let AI draft and explain, but never silently calculate or publish the
   authoritative score.
