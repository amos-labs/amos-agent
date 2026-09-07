# Desktop fixture execution interface

`src/evals/desktopFixtureRunner.js` exports `runDesktopFixture`. It runs the real hosted model client (including the exact-content SSE fix), `AgentLoop`, default `SYSTEM_PROMPT`, workflow/context compilation and tool-result wrappers. It is a research helper excluded from the packaged Desktop application. It does not discover credentials, instantiate production business tools, launch training, configure a model server, or perform a Mission admission decision.

The controller explicitly supplies a named synthetic fixture, trusted tool implementations, an independent verifier, a manual hosted model configuration, an authorized transport, an expected served-model alias and all four limits. `transportProfile` defaults to `hosted`; `direct-cortex` is an explicit research transport described below. Tool implementations and verifiers are trusted local code reviewed with the fixtures; do not load arbitrary executable code from model output or a fixture JSON file. The controller must reset fixture world state between arms/cases and own its aggregate request/token/cost/load budget. The supplied transport must send the captured body unchanged and must not hide retries, redirects or model routing.

```js
import { runDesktopFixture } from "../../src/evals/desktopFixtureRunner.js";
import { resolveModelConfig } from "../../src/model/providers.js";

const result = await runDesktopFixture({
  fixture: { id: "balance-001", synthetic: true, prompt: "Read the balance and report it." },
  modelConfig: {
    ...resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" }),
    apiKey: scopedKeyLoadedByController
  },
  fetchImpl: authorizedBudgetedFetch,
  expectedServedModel: "stage1-060408-r32-s5",
  limits: { maxModelTurns: 6, maxHttpCalls: 6, maxWallMs: 120000, maxCompletionTokens: 3072 },
  tools: [{
    name: "fixture_balance", description: "Read the synthetic account balance.", readOnly: true,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, { signal }) => ({ balance: 42 })
  }],
  verify: execution => ({ verdict: execution.answer === "42" ? "pass" : "fail" })
});
```

`tools` use the existing `ToolRegistry.register` shape (`name`, description, parameters, trusted handler and optional execution metadata). Use fresh closures/state for each call to the runner. The real loop also installs its in-memory conversation and scratchpad tools; their actual definitions appear in captured requests. This is not a replica of every connected user's full toolkit or controller-specific company context, and is not installed Electron UI acceptance. Supply the intended `systemPrompt` explicitly for compact-prompt secondary arms or a separately pinned controller-compiled prompt; otherwise the actual Desktop `SYSTEM_PROMPT` is used.

The result includes:

- `status`: `answered`, `error` or `aborted`; stop reason and partial evidence survive a budget stop.
- Every outgoing model request body, its byte hash, exact `compiledInput` messages/tools and a SHA-256 over Desktop's `canonicalJson` of that input. Headers, credentials and URL query parameters are not recorded.
- `modelIndependentBodySha256` binds the entire outgoing JSON body except `model`, including generation settings. Compare this at a shared decision boundary to detect differences beyond the declared model ID. It does not bind unseen server defaults.
- Provider response bytes as consumed by the client, their hash and explicit capture-completeness/truncation flags. Retention is capped at 4 MiB per response; the hash covers consumed bytes. A stream canceled early is not labeled complete.
- Per-model-turn response, raw metadata, `servingEvidence` and normalized token/timing evidence. In the default hosted profile, a wrong served-model alias or a reported fallback aborts the arm. Direct-cortex identity uses the provider's own response `model` instead.
- Loop events and transcript, including failed tool results and corrected attempts with their tool-call IDs. Events are marked with the current model turn; transcript call IDs bind actual results. The helper does not infer a successful action from final prose.
- Independent `verification` with `pass`, `fail` or `unknown`; `verifiedComplete` requires an answered execution plus verifier pass. A thrown or malformed verifier result is unknown. This is not a first-attempt/final-completion classifier: the outer protocol must distinguish required recovery from unexpected correction using the full trace.

Limits count **model calls**, not tasks. A six-call tool task is one task attempt. A transport retry hidden inside the hosted client ends the fixture as `transport_retry_disallowed`; it is not silently counted as another successful attempt. A controller may separately schedule an explicit recovery arm under the preregistered protocol. Server-side attempts still need to be examined in `usage.provider_calls`, and charged against the aggregate controller budget.

The wall bound covers asynchronous execution and verification. The abort signal reaches transport and tool context. Trusted handlers must honor it; synchronous infinite loops cannot be preempted inside this JavaScript process, so run untrusted generated code in the separate bounded grading sandbox. This helper does not supply such a sandbox. The returned evidence is cloned so late completion of a non-cooperative promise cannot mutate it.

The expected model alias is an execution check, not proof of exact weight bytes or resolved reasoning configuration. Before a paired run, the serving owner must bind model artifacts, engine/quantization, reasoning settings and routing to the actual arm. Public Frontier versus Deep alone is not an isolated weights comparison. Retain the observed outgoing request and upstream resolved settings; do not fabricate missing identity.

## Direct-cortex research transport

Public Hosted does not expose base-at-Frontier or a per-request S5 canary bypass. A controlled weights comparison can instead point the same Desktop client and agent loop directly at an owner-approved cortex endpoint:

```js
const result = await runDesktopFixture({
  ...freshFixtureFactory(),
  transportProfile: "direct-cortex",
  modelConfig: {
    ...resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" }),
    baseUrl: approvedCortexBaseUrl, // Includes /v1; explicitly supplied by the controller.
    apiKey: scopedCortexKeyLoadedByController
  },
  expectedServedModel: pinnedArmModelId,
  fetchImpl: authorizedBudgetedFetch,
  limits: { maxModelTurns: 8, maxHttpCalls: 8, maxWallMs: 120000, maxCompletionTokens: 3072 }
});
```

The client remains configured as manual hosted so the corrected content parser, tool schemas and Desktop orchestration are identical across arms and local routing is bypassed. At the instrumented transport boundary, the runner sets the actual upstream `model` to `expectedServedModel`, removes AMOS routing envelopes and legacy `reasoning_effort`, and sets both `enable_thinking:false` and `chat_template_kwargs.enable_thinking:false`. Streaming requests ask for `stream_options.include_usage:true`. Redirects are refused. This first profile supports thinking-off comparisons only; a reasoning-enabled contrast needs its own reviewed profile.

`requests[].body` and `bodyBytesSha256` describe the actual transformed upstream request. `clientBody` and `clientBodyBytesSha256` separately retain what the unchanged Desktop client produced. Messages and tools are preserved. The result records the profile and endpoint origin without credentials or query parameters. The explicit transport must not modify the body again; otherwise this would cease to be evidence of what was sent.

`turns[].servingEvidence.source` is `provider-response-model`. A missing or different provider `model`, or an unexpected AMOS metadata block, aborts before any tools proposed in that answer execute. The raw provider response is retained without injecting AMOS receipts. In direct-profile `usage`, `served_model`, `frontier_route`, `provider_calls`, `correlation_id`, `fallback_used` and `fallback_reason` are **null**, because the public Platform did not attest them. Token counts and timing remain available; `runtime` is `direct-cortex`. One captured HTTP call does not prove one server-side attempt, exact weight bytes or server compliance with thinking-off settings. The serving owner must provide that preflight evidence independently.

These are direct-cortex research results, not public Hosted routing or installed Desktop UI acceptance. Keep public canary acceptance separate. Importing this module or selecting the profile neither reserves a serving window nor authorizes a cohort, training job or compute budget.

## Tool proposals and executed effects

Count model proposals using the un-compacted per-turn responses:

```js
const proposals = execution.turns.flatMap(turn => turn.message?.tool_calls || []);
const proposedSends = proposals.filter(call => call.function?.name === "send_invoice");
```

Each proposal has `id`, `function.name` and `function.arguments`. There is no top-level `toolCalls` array and no `tool_call` event. Loop events are `tool_start`, `tool_end` and `tool_error`, with `name` and `modelTurn`; they do not have call IDs. A start can lead to a registry/schema rejection, and a proposal can be rejected before dispatch. The retained transcript joins tool results to proposals with `tool_call_id`, but the real loop can compact older transcript blocks.

A fixture's private state must establish successful effects: validate the target ID, mutate only on accepted execution and let read tools reflect the new state. Neither a proposal count nor final prose proves the effect occurred. A no-resend verifier can reject any proposal for the already completed action, while completion still requires authoritative fixture state. Test wrong IDs, rejected actions and failed handlers as well as the successful path. These fixtures are synthetic; their private ledgers are not Platform operation receipts.

The helper's hashes are diagnostic references. Organism must use its existing canonical treatment/protocol helpers for Mission comparison records, and leave `missionComparisonEligible:false` for this synthetic research output. The initial compiled-input equality check belongs at the paired decision boundary; subsequent prompts can legitimately diverge after different model actions. Do not manufacture a full Mission measurement from a model alias or these records.

Run the network-free integration tests with `node --test test/desktopFixtureRunner.test.js`. They exercise tool success, failure then correction, unavailable names, exact request/response capture, identity mismatch, HTTP/model/wall limits, hidden retries and independent-verifier failure. Direct-profile tests verify paired request equality, thinking controls, provider identity before side effects, refusal of substituted Hosted evidence and exact repeated SSE content. No live inference is started by importing the module or running its tests.
