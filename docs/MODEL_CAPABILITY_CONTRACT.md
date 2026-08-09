# Model capability contracts

AMOS routes models from measured evidence, not model names, provider claims, or
self-reported confidence. The capability contract is the provider-neutral
boundary between qualification and runtime routing.

The first implementation lives in:

- `src/model/modelCapabilitySuite.js` — versioned scenarios and the behavior
  each scenario proves;
- `src/model/capabilityContract.js` — report compiler and fail-closed contract
  validator;
- `src/model/capabilityRouter.js` — deterministic eligibility and ranking;
- `scripts/compileModelCapabilities.js` — report-to-catalog CLI.

## What is qualified

Qualification applies to the entire inference configuration, not merely a
model family:

- provider, model, protocol, and deployment;
- runtime and runtime version;
- quantization;
- prompt version;
- tool-schema version;
- evaluation suite and evaluator version.

Changing one of those inputs requires new evidence for the affected behavior.
This prevents a newly quantized local model or a changed hosted prompt from
silently inheriting an older model's grants.

## Contract shape

`amos.model-capability-contract` version 1 contains:

- `identity` — the exact inference configuration;
- `evidence` — suite, source report digest, time, trust, completeness, and
  repetition count;
- `status` — `qualified`, `conditional`, `experimental`, or `unqualified`;
- `grants` — measured modalities, granular capabilities, workflows, and
  autonomy levels;
- `failures` — scenarios that failed and the capabilities they withhold;
- `limits` — measured context ceiling;
- `performance` — score, throughput, latency class, and cost class.

Autonomy grants are progressive: `observe`, `draft`, `propose`, then `execute`.
`execute` means a model may drive a governed tool loop. It never gives the
model authority to bypass AMOS policy, approval, tenant, budget, or receipt
enforcement.

Malformed contracts fail closed. A marketing-style object such as
`{"capabilities":["tools","reasoning"]}` cannot enter the candidate set because
it has no pinned identity or measured evidence.

## Suite version 1

The suite converts scenario outcomes into narrow grants:

| Scenario | Primary evidence produced |
|---|---|
| Structured output | Exact structured-data generation |
| Business diagnosis | Grounded funnel diagnosis |
| Governance honesty | Action integrity without a receipt |
| Native tool calling | Tool selection, arguments, and continuation |
| Executable coding | Basic code that passes deterministic tests |
| Document prompt injection | Untrusted-document instruction resistance |
| Contradictory evidence | Controlling-source reconciliation |
| Tenant-boundary trap | Tenant and tool-argument isolation |
| Dependent multi-tool sequence | Ordered tool use with derived arguments |
| Parked approval outcome | Correct pending-versus-executed narration |
| Distractor-heavy retrieval | Long-context evidence retrieval |
| Optimization coding | Code that passes optimum and tie-break tests |

The compiler recomputes scores from the individual scenario evidence and
rejects unknown scenarios, altered weights, duplicate scenarios, or mismatched
aggregate scores. A partial suite remains `experimental`. A complete suite may
become `conditional`; `qualified` requires a clean pass repeated at least three
times.

## Compiling reports

The current local runner already emits a compatible report:

```sh
npm run benchmark:local -- gpt-oss:20b --suite all --output /tmp/amos-qualification.json
npm run qualification:compile -- /tmp/amos-qualification.json \
  --runtime ollama \
  --runtime-version 0.32.5 \
  --quantization MXFP4 \
  --prompt-version desktop-v1 \
  --tool-schema-version amos-tools-v1 \
  --output /tmp/amos-capabilities.json
```

The compiler also accepts the generic `amos.model-qualification` version 1
report shape so hosted, customer-cloud, and local runners can produce the same
contract. Provider-specific clients remain outside the router.

## Routing behavior

For each task step, the caller declares measured requirements:

```js
const decision = routeModelStep({
  requirements: {
    modalities: ["text"],
    capabilities: ["dependent-tool-sequencing"],
    workflows: ["dependent-tool-analysis"],
    autonomy: "propose",
    minimumContextTokens: 32_000,
    maximumLatencyClass: "standard"
  },
  candidates,
  policy: {
    allowedDeployments: ["local", "managed"],
    allowedProviders: ["ollama", "openai", "anthropic"]
  }
});
```

The router applies deterministic floors first:

1. validate the contract and evidence trust;
2. enforce status, deployment, provider, and health policy;
3. require every modality, capability, workflow, and autonomy grant;
4. enforce context, evidence age, latency, and cost ceilings;
5. require `approval-state-integrity` for any `execute` route;
6. rank only eligible candidates by explicit preference, then cost, latency,
   and stable contract ID.

If no candidate survives, the result contains `no-qualified-model` plus
machine-readable rejection reasons. The caller can escalate with that evidence
instead of guessing a fallback.

## Current local contracts

Offline catalog version 4 embeds release-signed contracts for GPT-OSS 20B and
the two measured Qwen 3.6 27B quantizations. Their July 2026 evidence grants
observe, draft, and propose behavior. It withholds:

- `approval-state-integrity`, because pending approval was narrated as
  completed execution;
- `verified-code-optimization`, because hidden code tests failed;
- qualified `vision`, because the text-heavy screenshot extraction test
  failed.

The Qwen 4B and 8B catalog entries remain installable but have no capability
contract, so the router will not silently admit them to governed workflows.

## Next integration boundary

The next runner can execute the same scenario definitions through native
OpenAI Responses, Anthropic Messages, OpenAI-compatible, and Ollama adapters.
Runtime task orchestration then calls this router per step and records the
decision, rejection reasons, model identity, verification result, and outcome
in the task receipt.
