# Intelligence and infrastructure

AMOS separates the intelligence from the company being operated. The same
company context, connected applications, policy, approvals, and receipts can be
used from different models and deployment boundaries.

Provider choice changes where inference happens. It does not change AMOS
identity or authority.

## Infrastructure summary

| Profile | Inference location | Credential | Best fit |
| --- | --- | --- | --- |
| AMOS Intelligence | AMOS-managed infrastructure | AMOS-backed identity | Zero-config routed intelligence with included credits and metered overage |
| Amazon Bedrock | Customer or AMOS AWS | Bedrock credential adapter | AWS-standardized and sovereign deployments |
| Compatible endpoint | Customer-selected HTTPS service | Endpoint credential | Existing model gateways or private serving |
| OpenAI | OpenAI cloud | OpenAI API key | Native Responses streaming, tools, and stateless reasoning continuation |
| Anthropic | Anthropic cloud | Anthropic API key | Native Messages streaming, tools, and signed thinking continuation |
| Moonshot/Kimi | Moonshot cloud | Moonshot API key | Named OpenAI-compatible provider profile |
| Ollama | User computer | Usually none | Supported local development/offline work |
| llama.cpp | User computer | Usually none | Direct GGUF/local serving |

## AMOS Intelligence

AMOS-managed intelligence is the normal product experience. Customers ask AMOS
to perform work without selecting a provider, model, or reasoning tier. It is
the default after AMOS sign-in.

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

Desktop presents one **AMOS Intelligence · Automatic** route. It sends no
managed reasoning-tier hint. The platform evaluates each task step against its
modality, workflow, context, consequence, privacy, latency, cost, and measured
capability requirements. It selects the least expensive qualified route and
escalates only when a stronger model or reviewer is required.

The underlying provider and model remain available in private diagnostics and
receipts, but they are not routine product choices. The business remains
connected to AMOS while the underlying intelligence changes.

Explicit BYOK, compatible-endpoint, customer-cloud, and local infrastructure
remain available under Desktop's advanced intelligence disclosure. Connecting
AMOS only migrates the legacy unconfigured Kimi default; it does not overwrite
a working user-selected infrastructure configuration.

## Amazon Bedrock

Bedrock supports customer-controlled or AMOS-controlled AWS inference through
its Mantle endpoints. Desktop does not treat Bedrock as one wire protocol. A
release-signed model catalog binds each qualified model to its native protocol,
endpoint path, API-key header, capabilities, reasoning controls, and verified
regions:

- GPT-5.6 Sol, Terra, and Luna use OpenAI Responses at `/openai/v1`;
- GPT OSS uses OpenAI Responses at `/v1`; and
- Claude Fable, Sonnet, and Opus use Anthropic Messages at `/anthropic/v1`.

Selecting a model updates the endpoint path. The runtime repeats the check,
normalizes legacy GPT OSS IDs, and rejects unknown models, unqualified regions,
or non-Mantle credential origins before saving settings or sending a request.
Adding another qualified Bedrock route is therefore a catalog change rather
than a model-family branch in the agent loop.

```dotenv
AMOS_MODEL_PROVIDER=bedrock
AWS_REGION=us-west-2
AMOS_BEDROCK_AUTH_MODE=sigv4
AMOS_MODEL=openai.gpt-5.6-terra
```

The default compatible endpoint is:

```text
https://bedrock-mantle.${AWS_REGION}.api.aws/openai/v1
```

SigV4 is the recommended enterprise authentication mode. The Desktop main
process resolves the standard AWS credential chain (environment, SSO/profile,
web identity, shared configuration, or attached EC2/ECS role) and signs the
exact request with service name `bedrock-mantle`. AWS credentials never enter
the renderer, model context, settings file, child-process environment, or
request body. The signer rejects every non-canonical host and mismatched region
before resolving credentials.

Bedrock API-key authentication remains available explicitly with
`AMOS_BEDROCK_AUTH_MODE=api-key`: Responses uses a bearer header and Messages
uses `x-api-key`. Existing stored keys migrate through `auto` mode; new Desktop
configuration defaults to SigV4. Keys remain encrypted locally and are accepted
only for canonical Bedrock Mantle origins.

The live qualification command is:

```bash
npm run qualification:bedrock -- --region us-east-1
```

It discovers account-specific availability and exercises text, normalized
usage, native two-turn tools, streaming, vision, cancellation, and structured
errors without printing credentials. Model availability can still depend on
AWS Marketplace setup and account/project retention policy. In particular,
Claude Fable 5 currently requires explicit `provider_data_share`; the catalog
and Desktop disclose that requirement and AMOS never changes retention policy.
See [Bedrock live qualification](BEDROCK_LIVE_QUALIFICATION.md).

## Native provider APIs

OpenAI uses its native Responses protocol:

```dotenv
AMOS_MODEL_PROVIDER=openai
OPENAI_API_KEY=...
AMOS_MODEL=gpt-5.6-terra
```

Anthropic uses its native Messages protocol:

```dotenv
AMOS_MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
AMOS_MODEL=claude-sonnet-5
```

Both profiles translate native streaming and tool calls into the same AMOS
agent contract. OpenAI's encrypted reasoning output items and Anthropic's
signed thinking blocks are preserved between tool turns while remaining hidden
from user-visible streaming.

Moonshot/Kimi remains a named compatible provider profile:

```dotenv
AMOS_MODEL_PROVIDER=kimi
MOONSHOT_API_KEY=...
AMOS_MODEL=kimi-k3
```

Provider keys remain local and encrypted in Desktop. They are removed from
child-process environments and never become AMOS connector credentials.

Additional providers should use either a named native adapter when behavior
differs or the compatible-endpoint profile when Chat Completions is sufficient.
See [Intelligence protocol adapters](INTELLIGENCE_PROTOCOL_ADAPTERS.md).

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

- `qwen3:4b` as an installable, unmeasured compact profile (not recommended);
- `qwen3:8b` as an installable, unmeasured balanced profile (not recommended);
- `gpt-oss:20b` as the measured primary interactive profile (recommended at 24 GB+, attemptable at the 16 GB minimum);
- `hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M` as the qualified, release-pinned image-capable profile (recommended at 32 GB+).

Qwen 3.8 replaces both former Qwen 3.6 profiles for new installations. Catalog
version 7 retains their signed identities only as retired migration entries:
they appear when already installed so the user can switch or remove them, but
AMOS blocks any new Qwen 3.6 download.

The Qwen 3.8 entry pins its Hugging Face revision, Ollama manifest digest,
model digest, and multimodal-projector digest. AMOS verifies the installed
manifest identity before activation and surfaces streamed download failures.
The official `ggml-org` artifact works with bundled Ollama 0.32.5, so no custom
Ollama build is shipped or maintained.

The recommendation leaves memory headroom for Desktop and normal applications;
it is not a claim that the local model matches managed frontier intelligence.
It also follows the measured
[local capability contract](LOCAL_MODEL_QUALIFICATION.md), so a 64 GB system
does not automatically prefer the largest model it can load.

AMOS selects 16K, 32K, 64K, or 128K default context from the machine's total
memory rather than blindly inheriting an upstream model's largest advertised
window. Set `AMOS_LOCAL_CONTEXT_LENGTH` to an explicit value from 4096 through
262144 when a controlled deployment needs more context and has measured the
model-specific memory cost.
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

AMOS should select models through measured
[capability contracts and evidence-driven routing](MODEL_ROUTING.md), including
quality, governance behavior, latency, privacy, and cost. Model choice never
changes the user's authority.

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
6. native wire protocol and request normalization;
7. response/tool-call normalization; and
8. tests proving credentials do not leak into prompts or child commands.

Avoid provider-specific behavior inside the core agent loop.
