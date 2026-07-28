# Intelligence and infrastructure profiles

AMOS separates the intelligence from the company being operated. The same
company context, connected applications, policy, approvals, and receipts can be
used from different models and deployment boundaries.

Provider choice changes where inference happens. It does not change AMOS
identity or authority.

## Profile summary

| Profile | Inference location | Credential | Best fit |
| --- | --- | --- | --- |
| AMOS Intelligence | AMOS-managed infrastructure | AMOS-backed identity | Zero-config routed intelligence with included credits and metered overage |
| Amazon Bedrock | Customer or AMOS AWS | Bedrock credential adapter | AWS-standardized and sovereign deployments |
| Compatible endpoint | Customer-selected HTTPS service | Endpoint credential | Existing model gateways or private serving |
| Provider API | Provider cloud | Provider API key | Frontier capability without infrastructure |
| Ollama | User computer | Usually none | Supported local development/offline work |
| llama.cpp | User computer | Usually none | Direct GGUF/local serving |

## AMOS Intelligence

AMOS-managed intelligence is for customers who want a managed model
deployment without reconnecting company systems or operating serving
infrastructure. It is the default Desktop profile after AMOS sign-in.

```dotenv
AMOS_MODEL_PROVIDER=amos-hosted
AMOS_MCP_URL=https://app.amoslabs.com/mcp
AMOS_MODEL=auto
```

The profile obtains short-lived inference authorization from the connected AMOS
identity. Usage metering and tenant attribution stay attached to the AMOS
account instead of requiring a second long-lived desktop key. The platform
applies included managed-AI credits first and records additional usage as
billable overage under the tenant's existing billing relationship.

Desktop derives the compatible inference endpoint from the AMOS MCP origin
(`/mcp` becomes `/v1`) and sends only the stable `auto` model alias. The
platform—not the client—selects the actual provider and model. The exact model,
provider, and hardware profile may therefore evolve independently from AMOS
Desktop.

Desktop presents four capability profiles rather than provider model names:

- **Efficient** for fast, economical routine work;
- **Balanced** for everyday company operation;
- **Deep** for harder research, coding, and planning; and
- **Frontier** for the highest-capability route available to AMOS.

The profile is a routing and cost preference, not a promise that a particular
vendor model will remain underneath it. The business remains connected to AMOS
while the underlying intelligence changes.

An explicit BYOK, compatible-endpoint, customer-cloud, or local profile always
remains available. Connecting AMOS only migrates the legacy unconfigured Kimi
default; it does not overwrite a working user-selected intelligence profile.

## Amazon Bedrock

Bedrock supports customer-controlled or AMOS-controlled AWS inference through
its compatible endpoint. The current Desktop adapter exposes Bedrock's
Chat-Completions-compatible GPT OSS models as a verified dropdown. Anthropic
Messages and OpenAI Responses models require their corresponding protocol
adapters; AMOS should not imply that every Bedrock model shares one wire
protocol.

```dotenv
AMOS_MODEL_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=...
AMOS_MODEL=openai.gpt-oss-120b-1:0
```

The default compatible endpoint is:

```text
https://bedrock-mantle.${AWS_REGION}.api.aws/v1
```

Bearer authentication is supported now. AWS profile and SigV4 support belongs
in a dedicated credential adapter so the model-provider boundary stays
unchanged.

## Provider APIs

Moonshot/Kimi is the first named provider API profile:

```dotenv
AMOS_MODEL_PROVIDER=kimi
MOONSHOT_API_KEY=...
AMOS_MODEL=kimi-k3
```

Provider keys remain local and encrypted in Desktop. They are removed from
child-process environments and never become AMOS connector credentials.

Additional providers should use either a named adapter when behavior differs or
the compatible-endpoint profile when the standard boundary is sufficient.

## Compatible endpoint

Use any customer-controlled OpenAI-compatible endpoint:

```dotenv
AMOS_MODEL_PROVIDER=openai-compatible
AMOS_MODEL_BASE_URL=https://models.example.com/v1
AMOS_MODEL=your-model
AMOS_MODEL_API_KEY=...
```

Non-local endpoints must use HTTPS. Capability declarations should accurately
identify tool use, vision, reasoning controls, and context limits.

## AMOS Local and Ollama

The command-line agent can still connect to a separately managed Ollama
instance at:

```text
http://127.0.0.1:11434/v1
```

```dotenv
AMOS_MODEL_PROVIDER=ollama
AMOS_MODEL=your-local-model
```

Signed AMOS Desktop releases package a pinned, checksum-verified Ollama runtime
as **AMOS Local**. Desktop launches and supervises that runtime on
`127.0.0.1:11435`, keeps Ollama cloud features disabled, and stores model
weights in the user's persistent application-data directory so an AMOS update
does not download them again. The user does not install, launch, update, or
configure a separate Ollama application.

The Intelligence screen recommends a model for the computer, downloads it
resumably, and lets the user activate it with an online AMOS company or in
explicit local-only mode. The catalog is embedded inside the signed
application bundle, displays a SHA-256 content identifier, and cannot be
extended by model output. The first profiles are:

- `qwen3:4b` for compact systems;
- `qwen3:8b` for a balanced local profile; and
- `gpt-oss:20b` for higher-memory systems.

The recommendation leaves memory headroom for Desktop and normal applications;
it is not a claim that the local model matches managed frontier intelligence.
Developers can set `AMOS_OLLAMA_BINARY` to test an explicit runtime binary;
production builds fail closed when their packaged runtime component is absent.

## llama.cpp

`llama-server` defaults to:

```text
http://127.0.0.1:8080/v1
```

```dotenv
AMOS_MODEL_PROVIDER=llama-cpp
AMOS_MODEL=your-local-model
```

Local HTTP is allowed only for loopback endpoints.

## Capability and hardware rules

- A laptop-sized model is not equivalent to a frontier or server-scale model.
- Tool-calling reliability matters more than benchmark rank for autonomous work.
- A text-only model must not receive pasted image bytes.
- A model without dependable structured tool use should remain
  observe-and-draft only.
- Hardware-aware onboarding should consider available RAM, architecture, model
  size, quantization, context window, and disk space.
- Model downloads should be checksum-verified, resumable, removable, and stored
  outside the application bundle.

## Security invariants

- Provider credentials never enter model-visible messages or tool results.
- Child shell commands receive a scrubbed environment.
- Changing models never changes tenant, role, scope, budgets, or policy.
- Local inference never weakens AMOS server-side authorization.
- Company application credentials remain in AMOS managed connectors.
- Offline work may draft company actions, but those actions must be
  reauthorized after reconnecting.

## Local-only operating mode

Local-only mode is a tool boundary, not merely a status label:

- the selected intelligence provider must be Ollama or llama.cpp;
- AMOS MCP tools are absent from the model's tool list;
- public web tools are absent from the model's tool list;
- company-memory promotion and company approval refresh are paused;
- local workspace, private-memory attachments, and typed local canvases remain
  available; and
- returning online does not replay or execute anything from the offline
  session.

AMOS Desktop 0.9 adds an explicit server-signed, encrypted, short-lived company
briefing with scope, expiry, provenance, and signing-key revalidation. Version
0.10 adds encrypted outcome drafts tied to that briefing. Returning online
compares their section fingerprints with a fresh read-only company briefing and
requires an explicit user-reviewed Operator prompt; it never replays a stored
tool invocation.

## Adding a provider

A provider adapter should define:

1. deployment boundary (`amos`, `customer-cloud`, `cloud`, or `local`);
2. base URL validation;
3. credential source and secure-storage behavior;
4. default model only when it is stable and honest;
5. text, vision, tool-use, and reasoning capabilities;
6. request normalization;
7. response/tool-call normalization; and
8. tests proving credentials do not leak into prompts or child commands.

Avoid provider-specific behavior inside the core agent loop.
