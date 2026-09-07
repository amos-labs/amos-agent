# Desktop fixture execution interface

`src/evals/desktopFixtureRunner.js` exports `runDesktopFixture`. It runs the real hosted model client (including the exact-content SSE fix), `AgentLoop`, default `SYSTEM_PROMPT`, workflow/context compilation and tool-result wrappers. It is a research helper excluded from the packaged Desktop application. It does not discover credentials, instantiate production business tools, launch training, configure a model server, or perform a Mission admission decision.

The controller explicitly supplies a named synthetic fixture, trusted tool implementations, an independent verifier, a manual hosted model configuration, an authorized transport, an expected served-model alias and all four limits. Tool implementations and verifiers are trusted local code reviewed with the fixtures; do not load arbitrary executable code from model output or a fixture JSON file. The controller must reset fixture world state between arms/cases and own its aggregate request/token/cost/load budget.

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
- Provider response bytes as consumed by the client, their hash and explicit capture-completeness/truncation flags. Retention is capped at 4 MiB per response; the hash covers consumed bytes. A stream canceled early is not labeled complete.
- Per-model-turn response, raw metadata and normalized serving/token/timing evidence; a wrong served-model alias or a fallback aborts the arm.
- Loop events and transcript, including failed tool results and corrected attempts with their tool-call IDs. Events are marked with the current model turn; transcript call IDs bind actual results. The helper does not infer a successful action from final prose.
- Independent `verification` with `pass`, `fail` or `unknown`; `verifiedComplete` requires an answered execution plus verifier pass. A thrown or malformed verifier result is unknown. This is not a first-attempt/final-completion classifier: the outer protocol must distinguish required recovery from unexpected correction using the full trace.

Limits count **model calls**, not tasks. A six-call tool task is one task attempt. A transport retry hidden inside the hosted client ends the fixture as `transport_retry_disallowed`; it is not silently counted as another successful attempt. A controller may separately schedule an explicit recovery arm under the preregistered protocol. Server-side attempts still need to be examined in `usage.provider_calls`, and charged against the aggregate controller budget.

The wall bound covers asynchronous execution and verification. The abort signal reaches transport and tool context. Trusted handlers must honor it; synchronous infinite loops cannot be preempted inside this JavaScript process, so run untrusted generated code in the separate bounded grading sandbox. This helper does not supply such a sandbox. The returned evidence is cloned so late completion of a non-cooperative promise cannot mutate it.

The expected model alias is an execution check, not proof of exact weight bytes or resolved reasoning configuration. Before a paired run, the serving owner must bind model artifacts, engine/quantization, reasoning settings and routing to the actual arm. Public Frontier versus Deep alone is not an isolated weights comparison. Retain the observed outgoing request and upstream resolved settings; do not fabricate missing identity.

The helper's hashes are diagnostic references. Organism must use its existing canonical treatment/protocol helpers for Mission comparison records, and leave `missionComparisonEligible:false` for this synthetic research output. The initial compiled-input equality check belongs at the paired decision boundary; subsequent prompts can legitimately diverge after different model actions. Do not manufacture a full Mission measurement from a model alias or these records.

Run the network-free integration tests with `node --test test/desktopFixtureRunner.test.js`. They exercise tool success, failure then correction, unavailable names, exact request/response capture, identity mismatch, HTTP/model/wall limits, hidden retries and independent-verifier failure. No live inference is started by importing the module or running its tests.
