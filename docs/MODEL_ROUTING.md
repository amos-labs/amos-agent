# Evidence-driven model routing

AMOS should route each step to the least expensive intelligence profile that has
demonstrated it can perform that step within the required quality, latency,
privacy, and governance boundary.

Model choice never changes authority. Tenant isolation, scopes, policy,
approvals, budgets, and receipts remain AMOS responsibilities regardless of
where inference runs.

## Product surface

Most users should choose an operating profile rather than a vendor model:

- **Efficient** — prefer qualified local or economical managed intelligence;
- **Balanced** — route routine work efficiently and escalate difficult steps;
- **Deep** — favor maximum reasoning quality for complex work;
- **Sovereign** — remain inside tenant-approved local or private infrastructure.

Advanced users may pin an allowed model or provider. Administrators may narrow
providers, regions, data classes, workflows, spend, and escalation rules.

## Capability contracts

Every qualified model release carries a measured contract:

- supported modalities and context ceiling;
- structured output and native tool-call reliability;
- workflows and skills it passed;
- observe, draft, propose, or execute eligibility;
- adversarial governance and prompt-injection results;
- coding and verification results;
- latency class, throughput, memory, and cost;
- known failure modes and the evaluator version.

Marketing names and model self-reported confidence are not capability evidence.
A new model, quantization, runtime, prompt, or tool schema version invalidates
the affected measurements until it is requalified.

## Routing inputs

The router evaluates each step, not only the top-level task:

1. required modality and tool surface;
2. workflow complexity and novelty;
3. consequence and reversibility;
4. evidence conflict, staleness, and missing information;
5. privacy, sovereignty, and connectivity requirements;
6. interactive versus background latency budget;
7. context size and available machine resources;
8. tenant policy, intelligence credits, and spend ceiling;
9. measured model performance on comparable work.

Deterministic requirements filter the candidate set before any learned ranking.
For example, a text-only model is ineligible for an image step, and a model that
failed parked-approval qualification cannot represent consequential execution
outcomes without a qualified reviewer.

## Hybrid execution

One task may use several intelligence profiles:

- local retrieval, classification, drafting, and code transformations;
- a managed model for ambiguous planning or unfamiliar tool orchestration;
- a frontier reviewer for high-impact proposals or conflicting evidence;
- local formatting and presentation of the verified result.

Escalation should pass an information-dense evidence package from the
[context compiler](CONTEXT_COMPILER.md), not replay the full private transcript.
The handoff records sources, assumptions, unresolved questions, and the reason
for escalation.

## Escalation triggers

Initial triggers are deterministic:

- no qualified local model for the required workflow or modality;
- failed verification, invalid structured output, or repeated tool error;
- contradictory controlling evidence;
- consequential proposal from a model not qualified for that representation;
- context or memory pressure beyond the local profile;
- user request for deeper review;
- policy requirement for a specific provider, region, or reviewer.

AMOS may learn better routing predictions, but learned confidence cannot bypass
these floors or widen authority.

## Receipt feedback loop

Each routed step records:

- model, quantization, runtime, prompt, workflow, and evaluator versions;
- compiled context fingerprint and loaded capabilities;
- latency, tokens, infrastructure cost, and retries;
- tool calls, verification results, approvals, denials, and human edits;
- execution receipt and measured downstream outcome when available.

This evidence lets AMOS compare models by workflow and tenant. The system may
propose changes such as “use the local Professional profile for document
classification” or “require Deep review for campaign activation,” but policy
controls whether that routing change becomes active.

Human edits and business outcomes need careful interpretation. An approval is
not proof that an action was correct, and a metric change is not proof that one
model caused it. Routing experiments require bounded cohorts, comparable tasks,
and explicit outcome windows.

## Delivery sequence

1. Ship versioned smoke and adversarial qualification suites.
2. Store capability contracts with the signed local-model catalog.
3. Add deterministic profile routing and explicit escalation reasons.
4. Emit model-routing details in private task diagnostics and business-readable
   receipts where relevant.
5. Add hybrid local-first workflows with compact managed review.
6. Learn tenant-specific recommendations from verified receipts and outcomes.

