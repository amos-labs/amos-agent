# Evidence-driven model routing

AMOS should route each step to the least expensive intelligence configuration that has
demonstrated it can perform that step within the required quality, latency,
privacy, and governance boundary.

The provider-neutral contract compiler and deterministic routing kernel are now
implemented. See [model capability contracts](MODEL_CAPABILITY_CONTRACT.md) for
the schema, qualification rules, command-line workflow, and runtime API.

Model choice never changes authority. Tenant isolation, scopes, policy,
approvals, budgets, and receipts remain AMOS responsibilities regardless of
where inference runs.

## Product surface

Most users see one choice: **AMOS Intelligence · Automatic**. They describe the
business outcome; AMOS chooses the qualified intelligence required for each
step. There is no routine provider, model, or reasoning-tier decision.

Advanced users may select BYOK, customer-cloud, private, or local
infrastructure. Administrators may narrow providers, regions, data classes,
workflows, spend, and escalation rules. These constraints change the eligible
candidate set without exposing model selection as ordinary business UX.

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

Context size is a capacity and economics constraint, not a proxy for reasoning
complexity. It can exclude a model whose context window is too small and change
estimated latency or cost, but it must never promote a task to Deep or Frontier.
A five-word question can require difficult synthesis; a 100-page formatting job
can be mechanically simple. Semantic difficulty comes from the Router's task
classification and later verification evidence.

Deterministic requirements filter the candidate set before any learned ranking.
For example, a text-only model is ineligible for an image step, and a model that
failed parked-approval qualification cannot represent consequential execution
outcomes without a qualified reviewer.

## AMOS Router: the classification mechanism

Natural-language task classification belongs in a tiny, independently
versioned AMOS Router—not in a growing collection of regular expressions. It
produces a structured task envelope; it does not select provider credentials,
grant authority, or execute work.

AMOS Router is the only component that assigns semantic difficulty or an
intelligence-class floor. Structural facts never attempt to infer difficulty;
they only exclude incompatible candidates and calculate resource cost.

The routing sequence is:

1. Compile exact runtime facts: modalities, attachment shape, context budget,
   available/active tools, phase, privacy boundary, and current authority.
2. Ask the tiny Router to add workflow, skill, capability, novelty,
   consequence, and verification requirements.
3. Merge those outputs into an open-ended envelope of namespaced tokens.
4. Filter signed model capability contracts and tenant policy deterministically.
5. Rank eligible candidates by measured successful-outcome cost, latency, and
   policy preference.
6. Follow a manifest-defined fallback edge when verification fails, the model
   is unhealthy, or no candidate satisfies the envelope.

The classifier is a prediction layer, not a safety boundary. Its output can
raise the capability floor but cannot expand tenant access, skip approval,
weaken privacy, or make an unqualified model eligible. If the Router is offline,
times out, returns an invalid envelope, or has low confidence, AMOS uses the
language-independent structural fallback and may escalate after verification.

The analogy to the small router in front of ExpertCache is intentional. Here
the routing domain is broader: workflow and skills first, then the qualified
intelligence configuration for each step. A small local Router should normally
handle this classification even when hosted models are unavailable; the larger
ExpertCache-backed model can remain a planner, teacher, or reviewer.

### Current local-primary rollout

The August 9, 2026 Desktop integration bundles
`amos-router:0.8b-pilot003-v2` as a release-pinned Q4_K_M artifact. The build
verifies the 529,296,768-byte GGUF and conservative prompt by SHA-256 before
packaging. On first AMOS Intelligence use, Desktop verifies the artifact again
and registers it with the bundled Ollama 0.32.5 runtime on AMOS's private
loopback endpoint.

This candidate scored 36/40 (90%) on the development fixture, with no invalid
outputs and 100% accuracy on the Routine and Balanced cases. Four systematic
Deep/Frontier under-routes remain and no sealed qualification partition has
been run, so the model program still records it as development-qualified rather
than a finished training artifact. The product rollout is nevertheless
local-primary: running a second classifier for every healthy local decision
would add avoidable latency and hosted inference cost.

In the default `active` mode:

1. Desktop classifies each hosted task step locally.
2. A valid local decision is sent under `amos_routing`.
3. AMOS Hosted validates the bounded envelope and routes the request without
   invoking its classifier.
4. A missing artifact, checksum mismatch, installation failure, timeout, or
   invalid local output causes Desktop to omit the envelope.
5. Only then does AMOS Hosted run its classifier as the availability fallback.

Clients without the managed local runtime also use the hosted classifier.
`AMOS_LOCAL_ROUTER_MODE=shadow` remains an explicit diagnostic setting for
short, deliberate comparison runs; it is not the normal request path. Shadow
mode records only fixed-cardinality agreement metrics without logging task
text, and Desktop keeps any task-level correlation inside its encrypted local
receipt.

### Expansion without application releases

The envelope, candidate catalog, and fallback graph are data:

- requirements are namespaced strings such as `modality:vision`,
  `workflow:franchise-scorecard`, `capability:dependent-tool-sequencing`, and
  `privacy:device-only`;
- workflow and skill manifests declare the requirements they add;
- signed model contracts declare the requirements they satisfy plus measured
  limits and performance;
- tenant policy manifests remove candidates or impose floors; and
- fallback manifests define ordered alternatives and terminal escalation.

The generic kernel performs set containment, numeric constraint checks,
policy filtering, and stable scoring. Adding a workflow, capability, model
release, tenant policy, cost update, or fallback edge therefore changes signed
data rather than router code. Only a genuinely new transport/protocol or
security primitive requires an adapter release.

## Hybrid execution

One task may use several intelligence configurations:

- local retrieval, classification, drafting, and code transformations;
- a managed model for ambiguous planning or unfamiliar tool orchestration;
- a stronger qualified reviewer for high-impact proposals or conflicting evidence;
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
propose changes such as “use the qualified local model for document
classification” or “require stronger review for campaign activation,” but policy
controls whether that routing change becomes active.

Human edits and business outcomes need careful interpretation. An approval is
not proof that an action was correct, and a metric change is not proof that one
model caused it. Routing experiments require bounded cohorts, comparable tasks,
and explicit outcome windows.

The current Router slice keeps task text and per-task comparison evidence in
the operating-system-encrypted local receipt. The platform receives only the
normal inference request, the bounded shadow class envelope, and aggregate
agreement dimensions. There is no automatic shared-training upload.

The next slice is a consent-aware correction/export path: let a user or reviewer
correct a disputed class, minimize and de-identify opted-in examples, attach the
artifact/prompt/contract versions, and write an auditable dataset ledger. The
next training run should target the observed disagreement families, then face a
new sealed qualification partition rather than reusing production prompts as
an unreviewed label source.

## Delivery sequence

1. **Implemented:** versioned smoke and adversarial qualification definitions.
2. **Implemented:** capability contracts in the signed local-model catalog.
3. **Implemented:** deterministic routing kernel with explicit escalation reasons.
4. **Implemented for development rollout:** bundle and shadow-evaluate the tiny
   local AMOS Router while AMOS Hosted remains the control.
5. Execute the same qualification suite through every hosted, private, and
   local protocol adapter.
6. **Implemented for Router shadow:** integrate step-level local classification
   and private encrypted comparison receipts.
7. Add user correction, consent-aware export, and a sealed qualification gate.
8. Add hybrid local-first workflows with compact managed review.
9. Learn tenant-specific recommendations from verified receipts and outcomes.
