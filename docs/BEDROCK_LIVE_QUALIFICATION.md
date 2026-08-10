# Bedrock Mantle live qualification

## Result

AMOS Desktop's model-qualified Bedrock implementation was exercised against a
real `us-east-1` account on August 10, 2026 using the standard AWS credential
chain and SigV4 service `bedrock-mantle`. No Bedrock API key was created or
copied into AMOS, and no account or project retention setting was changed.

| Model | Protocol | Live result |
| --- | --- | --- |
| GPT-5.6 Luna | OpenAI Responses | Pass: text, usage, and two-turn client tool execution |
| GPT-5.6 Terra | OpenAI Responses | Pass: text, usage, and two-turn client tool execution |
| GPT-5.6 Sol | OpenAI Responses | Pass: text, usage, and two-turn client tool execution |
| GPT OSS 20B | OpenAI Responses | Pass: text, usage, and two-turn client tool execution |
| GPT OSS 120B | OpenAI Responses | Pass: text, usage, and two-turn client tool execution |
| Claude Sonnet 5 | Anthropic Messages | Pass: text, usage, and two-turn client tool execution |
| Claude Opus 5 | Anthropic Messages | Pass: text, usage, and two-turn client tool execution |
| Claude Fable 5 | Anthropic Messages | Policy-blocked: requires `provider_data_share` under the tested account |

GPT-5.6 Sol's first plain-text probe exceeded a deliberately short 90-second
qualification window while its tool round trip passed. The isolated retry
passed both scenarios within the normal 180-second production window. This was
classified as transient service latency, not a protocol failure.

Representative end-to-end scenarios also passed:

- native Anthropic SSE streaming with visible deltas and normalized usage;
- live Claude vision using a bounded local PNG;
- cancellation propagated through a live Responses request as the canonical
  `AMOS_TASK_CANCELED` error;
- a SigV4-signed invalid request returned a structured provider error; and
- no credential value appeared in request bodies or qualification output.

## Data-retention boundary

The tested account's effective retention mode was `default`. GPT-5.6, GPT OSS,
Claude Sonnet 5, and Claude Opus 5 reported that mode as allowed. Claude Fable 5
reported itself unavailable and allows only `provider_data_share` for this
account. AWS documents that this mode can share prompts and completions with
the model provider and retain them for up to 30 days.

AMOS does not enable that setting. Fable remains descriptor-qualified because
the protocol and endpoint are valid for customers whose AWS policy permits it,
but Desktop marks the data-sharing prerequisite before use. Account or project
retention changes require an independent customer privacy decision.

## Repeatable command

```bash
npm run qualification:bedrock -- --region us-east-1
```

Use `--models` with a comma-separated catalog subset for a smaller run and
`--require-all` when policy-blocked or failed entries should produce a non-zero
exit. The harness resolves credentials through the AWS SDK default chain,
discovers live per-model availability, never prints credentials, and returns a
versioned machine-readable report.
