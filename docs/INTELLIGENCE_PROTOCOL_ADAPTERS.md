# Intelligence protocol adapters

AMOS keeps one agent and tool loop while allowing each model family to use its
native wire protocol. The agent loop owns company context, policy-safe tool
execution, approvals, progress guards, and receipts. Protocol adapters own
request translation, streaming events, provider continuation state, usage, and
errors.

## Stable internal contract

Every model client implements:

```js
chat({ messages, tools, onDelta, signal })
```

The loop supplies canonical messages and OpenAI-shaped function definitions.
The client returns a canonical assistant message:

```js
{
  role: "assistant",
  content: "visible text",
  tool_calls: [
    {
      id: "provider-call-id",
      type: "function",
      function: { name: "tool_name", arguments: "{\"key\":\"value\"}" }
    }
  ]
}
```

This is an internal AMOS contract, not a claim that every provider implements
OpenAI Chat Completions. The provider factory selects one of these adapters:

| Protocol | Endpoint | Native provider | Behavior |
| --- | --- | --- | --- |
| `openai-chat-completions` | `/chat/completions` | AMOS Hosted, Kimi, Bedrock GPT OSS, Ollama, llama.cpp, compatible endpoints | Existing compatible request and SSE translation |
| `openai-responses` | `/responses` | OpenAI | Responses input items, flat function tools, encrypted reasoning continuation, Responses SSE events |
| `anthropic-messages` | `/messages` | Anthropic | System extraction, content blocks, tool-use/result blocks, signed thinking continuation, Messages SSE events |

## Routing ownership boundary

The local AMOS Router is a capability of the official Desktop plus the managed
`amos-hosted` profile. It is not a generic feature of the protocol adapters.
Desktop may create a bounded `amos_routing` envelope only when all of these
facts hold:

- the provider is `amos-hosted`;
- the request uses AMOS identity and the managed Chat Completions contract;
- routing ownership is explicitly `amos-desktop`; and
- the local Router rollout is active.

The model factory strips the classifier, disables local routing, and pins the
selected provider when any of those facts is absent. Direct Anthropic, direct
OpenAI, Bedrock, local-model, Kimi, and customer-controlled endpoints therefore
cannot activate Desktop classification by copying an automatic-routing setting.
Their adapters never emit `amos_routing` or `amos_routing_shadow`.

Claude, Codex, and other external MCP clients are even farther outside this
path: they call the governed AMOS MCP capability surface using the model already
chosen by their controlling application. They do not enter the AMOS Desktop
inference endpoint and do not run or configure its Router. AMOS Hosted's
classifier remains an availability fallback only for AMOS Intelligence
inference requests that arrive without a valid Desktop envelope.

`AMOS_MODEL_PROTOCOL` can explicitly select a supported protocol for the
`openai-compatible` controlled-endpoint profile. Named and managed profiles
keep their declared protocol even when a stale override exists. Unknown custom
protocols fail closed before a request is sent.

## Provider continuation state

Reasoning providers return structured state that must survive a tool round
trip. Reconstructing only visible text and a function call can discard required
reasoning or signature material.

Adapters therefore attach an opaque `provider_state` to the canonical
assistant message. The agent loop preserves that field without inspecting it:

- OpenAI Responses retains output items, including encrypted reasoning items,
  while using `store: false`;
- Anthropic Messages retains native content blocks, including signed thinking
  and tool-use blocks; and
- switching protocols ignores incompatible provider state and reconstructs a
  valid request from the canonical visible message and tool calls.

Provider state is transient model context. It is not added to restart
checkpoints, UI events, tool results, or company memory.

## Streaming and cancellation

All adapters share the same request lifecycle:

- the configured request timeout remains active until the complete response or
  stream has been consumed;
- the task abort signal cancels the underlying fetch and returns the canonical
  `AMOS_TASK_CANCELED` error;
- provider HTTP errors are reduced to a safe actionable message;
- malformed JSON or streamed tool arguments fail the turn instead of executing
  a tool; and
- unknown future SSE event types are ignored so additive provider changes do
  not break the task.

Only visible text is emitted through `onDelta`. Thinking and encrypted
reasoning state remain inside the adapter.

## Adding another protocol

Add a protocol behind the model factory rather than branching inside the agent
loop. A complete adapter needs fixture coverage for:

1. system, user, assistant, image, tool-call, and tool-result translation;
2. non-streaming and streaming responses;
3. fragmented tool arguments;
4. provider-specific continuation state across a real agent tool turn;
5. usage normalization, provider errors, timeout, and user cancellation; and
6. unknown forward-compatible stream events.

Provider credentials must stay in request headers and secure settings. They
must never enter canonical messages, tool results, or child-process
environments.
