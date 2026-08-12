# Muse Glimmer 30B qualification plan

## Decision

Muse Glimmer 30B is a serious candidate for two AMOS lanes:

1. routine work currently routed to Haiku 4.5; and
2. non-deep balanced work currently routed to Sonnet 5.

This is a qualification hypothesis, not a routing change. Muse should enter the
product only workflow-by-workflow after the complete AMOS system reaches the
same verified outcome as the current control. Deep, frontier, high-impact, and
repeatedly failing work remains on the stronger route until separately proven.

## Initial measured signal — August 12, 2026

The first physical M1 Max 64 GB run is strong enough to continue, but not yet
strong enough to declare production Haiku or Sonnet parity. The official 16.8
GB K-Quant artifact ran fully local in a pinned `llama.cpp` build.

| Treatment | Score | Wall time | Generation | Interpretation |
| --- | ---: | ---: | ---: | --- |
| protocol smoke, low strength, official sampling | 7/7 | 142.8s | 8.5 tok/s | JSON, ATEM tools, continuation, diagnosis, governance, and executable code worked |
| hard qualification, low strength, official sampling | 16/16 | 348.7s | 8.7 tok/s | first stochastic capability signal |
| hard qualification, low strength, official sampling, clean AC restart | 16/16 | 377.5s | 8.6 tok/s | replicated all seven scenarios and the hidden coding checks |
| hard qualification, low strength, temperature zero, mixed battery/AC | 13/16 | 416.8s | 5.6 tok/s | all non-code scenarios passed; generated code failed the hidden harness |
| hard qualification, high strength, official sampling | 13/16 | 855.7s | 8.3 tok/s | coding consumed the completion budget in reasoning and returned no final answer |

### Frozen paired Sonnet diagnostic

A subsequently frozen 12-case, 32-point suite tested causal and temporal
transfer, Bayesian and Simpson reasoning, policy/receipt precedence, calibrated
abstention, dependent tool recovery, idempotent approval, and two executable
coding tasks. The suite SHA-256 was
`266cc0ee2d767d70c86ef0807f74484e256d7ea19befb0f97e11d38fc548d68c`.

| Treatment | Automated score | Adjudicated score | Request time | Output tokens | Local decode |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Sonnet 5, medium | 28/32 | 32/32 | 77.7s | 5,143 | hosted |
| Muse, low, plain decode | 20/32 | 32/32 | 593.0s | 3,873 | 7.19 tok/s |
| Muse, low, official DFlash | 24/32 | 32/32 | 713.2s | 4,134 | 6.31 tok/s |

Every automated deduction was an exact-substring false negative. All three
treatments selected every expected label, both Muse arms completed the two
dependent tool workflows and both executable coding checks, and the rationales
were semantically correct. The symmetric adjudication policy and report hashes
are frozen in `paired-adjudication-v1.json`; the raw reports remain unchanged.

This is a model-only parity signal on a small synthetic diagnostic, not a
production parity declaration. Its strongest consequence is that a targeted
AMOS adaptation program is justified. The latency result is equally clear:
plain local Muse took 7.63x the Sonnet request time, and DFlash regressed local
decode throughput by 12.2% while increasing request time by 20.3%.

The DFlash treatment used Meta's official 1.6 GB drafter with the target and
draft fully on Metal. It is rejected for the pinned M1 Max/runtime/workload
combination. Re-test only after a material runtime, hardware, or drafter change.

The initial default is therefore **low reasoning strength with Meta's published
sampling**, not temperature zero and not high strength. Higher reasoning must
be treated as a routed, budgeted treatment rather than an assumption that more
reasoning is always better. The clean AC run also shows that the current 8.6
tok/s throughput remains below the 15 tok/s AMOS Operator product gate, so
latency is an open product problem even on the 64 GB reference machine.

These are repeated runs of an AMOS diagnostic suite, not paired production
comparisons against Haiku 4.5 or Sonnet 5. They establish viability and expose
configuration sensitivity. A routing claim still requires frozen paired cases,
representative shadow traffic, confidence intervals, and zero regression on
the critical safety contracts.

The first integration ablation was intentionally narrow. Both authority and
receipt counterfactuals already passed in the base, elicited, and structured
workspace arms, so integration produced zero quality lift. For two cases, base
answers used 37.1 seconds; elicitation plus atomics used 141.1 seconds; and the
structured-workspace path used 506.7 seconds. This supports selective
integration triggered by measured failure families, not an always-on reasoning
workspace.

A subsequent base-only discovery sweep covered all five development families,
their five counterfactual variants, and 30 repeated atomic probes. Muse passed
all 10 combined cases, but only 26/30 atomic attempts. Stale-writer fencing and
collider conditioning were unstable, leaving 6/10 cases eligible for the strict
"knows every part" integration analysis. There were no atomic-pass/combined-
fail observations. The current development set therefore identifies teaching
targets, but is too easy to measure integration-engine uplift for this model.

The next experiment has three separate inputs:

1. add verified teaching examples for fencing and collider conditioning, then
   re-run untouched counterfactuals to test concept stability; and
2. build a harder, sealed integration set with longer dependency chains,
   misleading but non-authoritative cues, transfer between surface forms, and
   enough cases to estimate recovery confidence intervals; and
3. build the first shortest-correct AMOS trajectory corpus, then separately
   measure prompt/integration changes, supervised adaptation, preference
   training, and post-quantization retention.

The second lane matters strategically. Replacing only routine calls could move
roughly 60% of the first measured call sample local. Absorbing a meaningful
fraction of balanced Sonnet work would push owned local intelligence beyond
that boundary before a separate Sonnet-class open model is required.

## Why this candidate is unusually aligned

Meta describes Muse Glimmer as a 29.8B-parameter, Apache-2.0 model distilled for
local autonomous agents. The released behavior targets tool use, multi-step
reasoning, failure recovery, multimodal input, and agent scaffolds rather than
chat alone. Those are much closer to the AMOS workload than a generic small
assistant.

The first pinned candidate is the official 16.8 GB text-only K-Quant GGUF. Meta
reports approximately 1% average degradation for that artifact relative to the
full model. The official dynamic K-Quant artifact is 19.7 GB and is a later
quality/footprint comparison. Vision and speculative-draft artifacts remain out
of the first run so each variable is measured independently.

Important boundaries:

- reasoning is always active and is controlled through the Muse chat template's
  `reasoning_strength`, not the ordinary OpenAI `reasoning_effort` field;
- tool calls use Meta's ATEM protocol and depend on the runtime translating it
  correctly into OpenAI-compatible `tool_calls`;
- the GGUF path requires a recent Muse-capable `llama.cpp` build and `--jinja`;
- context is divided across parallel server slots, so the first run uses one
  slot to preserve the full declared context;
- the architecture and runtime support are new enough that runtime defects must
  be separated from model-quality failures; and
- Apache 2.0 permits adaptation and commercial derivatives, while Meta's usage
  policy and AMOS's own safety/consent contracts still apply.

## What “non-deep Sonnet” means

The current platform maps both `balanced` and `deep` to Sonnet 5, so provider
model IDs cannot identify this boundary. The new typed routing telemetry must
first provide a representative balanced/deep split.

A balanced candidate is work that needs more composition than a routine answer
but still has bounded evidence, tools, and verification. Initial examples are:

- multi-source synthesis with explicit controlling evidence;
- dependent but bounded tool sequences;
- artifact drafting against a checkable schema;
- code generation with deterministic tests and bounded repair;
- workflow planning where AMOS can verify each transition; and
- knowledge-integration cases whose component facts are independently
  recoverable.

The lane excludes unresolved authority conflicts, irreversible high-impact
decisions, novel long-horizon research, unverified complex code, and tasks that
continue failing tools or validators. Those conditions trigger deep or frontier
escalation regardless of the desired local-call percentage.

## Experimental matrix

Muse is evaluated as both a model and a component of the AMOS integration
engine:

| Stage | Candidate treatment | Control | Purpose |
| --- | --- | --- | --- |
| P0 | 17 GB GGUF, low strength, protocol smoke | none | Verify template, ATEM tools, multi-turn results, and stop behavior |
| R1 | Base Muse, low strength, model-only | Haiku 4.5 | Establish routine base capability |
| R2 | Base Muse plus AMOS integration | Haiku 4.5 | Measure retrieval, workspace, tools, verification, and repair uplift |
| B1 | Base Muse, low and high strength, model-only | Sonnet 5 balanced | Establish the non-deep Sonnet gap without assuming high strength is superior |
| B2 | Base Muse plus AMOS integration and fallback | Sonnet 5 balanced | Test system-level parity and calibrated escalation |
| A1 | Adapted Muse, model-only and integrated | matching R/B control | Attribute gains from distillation or fine-tuning |
| S1 | Quantized adapted model in shadow traffic | live routed control | Measure real distribution, latency, abstention, and false success |

The complete product comparison is S1. Earlier rows explain where its
capability comes from. Do not collapse model-only and integrated scores into one
number.

## First executable run

Start on the physical 64 GB M1 Max. The 32 GB lane follows after correctness is
stable. A 16 GB Mac is an ExpertCache-style research lane: a nominal 16.8 GB
weight file leaves no practical headroom for the runtime, KV cache, and Desktop,
so it is not the first product target.

After obtaining the official artifact and a `llama.cpp` build at or newer than
the pinned minimum in
`benchmarks/model-candidates/muse-glimmer-30b.json`, start a loopback-only,
single-slot server:

```bash
llama-server \
  --model /path/to/muse-glimmer-30B-kquant-17gb.gguf \
  --alias muse-glimmer-30b \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 32768 \
  --parallel 1 \
  --jinja
```

Then run the existing hard operator suite using Muse's template parameter:

```bash
npm run benchmark:local -- muse-glimmer-30b \
  --protocol openai \
  --url http://127.0.0.1:8080 \
  --context 32768 \
  --reasoning-strength low \
  --temperature 1 \
  --top-p 0.95 \
  --top-k 64 \
  --suite all \
  --output muse-routine-base.json
```

Run the same artifact at high strength as the first balanced diagnostic:

```bash
npm run benchmark:local -- muse-glimmer-30b \
  --protocol openai \
  --url http://127.0.0.1:8080 \
  --context 32768 \
  --reasoning-strength high \
  --temperature 1 \
  --top-p 0.95 \
  --top-k 64 \
  --suite qualification \
  --output muse-balanced-base.json
```

Finally measure the integration engine rather than inferring its value:

```bash
npm run benchmark:integration -- muse-glimmer-30b \
  --protocol openai \
  --url http://127.0.0.1:8080 \
  --reasoning-strength low \
  --workspace-reasoning-strength high \
  --temperature 1 \
  --top-p 0.95 \
  --top-k 64 \
  --arm all \
  --output muse-integration-ablation.json
```

The benchmark clients now keep Muse reasoning inside
`chat_template_kwargs.reasoning_strength`. They deliberately do not send an
unsupported top-level `reasoning_effort` in that mode.

These commands use Meta's published sampling defaults. For comparison with the
historical temperature-zero AMOS runs, repeat the same frozen cases at
`--temperature 0` and retain both configurations as separate treatments. A
single stochastic pass is diagnostic; release qualification requires repeated
runs and confidence intervals.

## Adaptation and distillation sequence

Do not fine-tune first. Freeze base/model-only and base/integrated results so
the team can distinguish a model improvement from an integration improvement.
Then:

1. build gold AMOS traces for tool schemas, dependent actions, evidence
   authority, parked/executed state, verification, repair, and escalation;
2. use stronger-model traces only where training rights permit, and accept
   them only after deterministic or human verification;
3. train supervised behavior for stable tool and output contracts;
4. use rejection sampling or preference optimization for competing plans,
   evidence choices, repair paths, and concise verified answers;
5. distill abstention explicitly from cases where the stronger control changes
   the answer or a validator rejects the local result;
6. compare base versus adapted under identical quantization, runtime, prompt,
   and integration treatments; and
7. re-run the complete gate after adapter merge, export, and quantization.

Because Muse's architecture has just entered the common runtimes, adapter
training, merge, GGUF conversion, and runtime loading are a separate
compatibility spike. Full BF16 weights are available for research and
fine-tuning, but AMOS must not assume that every current PEFT or conversion path
already handles this architecture correctly.

The first-principles architecture, latency model, adaptation targets, and
immediate experimental sequence are developed in
`docs/MUSE_LOCAL_INTELLIGENCE_FIRST_PRINCIPLES.md`.

## Promotion gates

Promotion is per workflow and per hardware profile. At minimum:

- the candidate passes the pre-registered system-level parity margin against
  the matching Haiku or balanced Sonnet control;
- prompt injection, tenant boundary, authority, and false-execution failures
  are zero in the critical release set;
- ATEM tool calls survive dependent multi-turn workflows without protocol
  repair by hidden benchmark code;
- the integrated arm improves quality enough to justify its added inference
  and latency;
- quantized and adapted artifacts retain the evaluated capability contract;
- uncertainty and failures escalate before the model makes an authoritative
  claim; and
- shadow results contain consent-safe evaluation facts, not raw customer work
  by default.

No default route changes until those gates are measured.
