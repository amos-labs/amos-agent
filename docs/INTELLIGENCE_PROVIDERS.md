# Intelligence providers

AMOS Agent separates intelligence from the company being operated. The same
agent loop, AMOS tools, company context, policies, approvals, and receipts work
with every supported infrastructure profile.

## Profiles

### AMOS Intelligence

AMOS-hosted open-weight inference in AWS. This is the managed option for
customers that want open-weight intelligence without operating model
infrastructure. The initial target is Kimi K3 after its weights, license,
supported serving stack, and hardware profile are verified.

Required:

- `AMOS_MODEL_PROVIDER=amos-hosted`
- `AMOS_MODEL_BASE_URL`
- `AMOS_MODEL`

The provider reuses the AMOS OAuth or scoped agent identity. Customers do not
manage a second AMOS inference credential. This keeps inference authorization,
usage metering, and bill-back attached to the same tenant identity.

### Kimi API

Moonshot-hosted Kimi. This is the reference provider while AMOS-hosted K3
infrastructure is brought online.

Required:

- `AMOS_MODEL_PROVIDER=kimi`
- `MOONSHOT_API_KEY` or `AMOS_MODEL_API_KEY`

### Amazon Bedrock

Customer-controlled or AMOS-controlled AWS inference. AMOS uses Bedrock's
OpenAI-compatible endpoint and bearer API-key authentication in this slice.
The base URL defaults to:

```text
https://bedrock-mantle.${AWS_REGION}.api.aws/v1
```

Required:

- `AMOS_MODEL_PROVIDER=bedrock`
- `AWS_BEARER_TOKEN_BEDROCK` or `AMOS_MODEL_API_KEY`
- `AMOS_MODEL`

AWS profile and SigV4 authentication can be added as a separate credential
adapter without changing the model-provider interface.

### Ollama

A model running on the customer's computer. The default endpoint is
`http://127.0.0.1:11434/v1`. Hardware-aware onboarding warns users when managed
inference is better suited to their machine.

### llama.cpp

A GGUF model running through `llama-server`. The default endpoint is
`http://127.0.0.1:8080/v1`.

### Compatible endpoint

Any customer-controlled OpenAI-compatible endpoint. Non-local endpoints must
use HTTPS.

## Invariants

- Provider credentials never enter model-visible messages or child shell
  environments.
- Changing the model does not change AMOS tenant, role, scope, policy, or proof.
- Local model selection never weakens server-side AMOS authorization.
- A model without reliable tool use is observe/chat only until a compatible
  structured-output adapter is available.
- Frontier-sized open weights may be self-hosted in AWS or customer
  infrastructure without being suitable for a laptop.
