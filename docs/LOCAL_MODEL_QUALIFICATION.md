# Local model qualification

AMOS qualifies model, quantization, runtime, prompt, and tool-schema
combinations rather than treating a model family name as proof of capability.
This report records the first AMOS Desktop local bake-off and the August 2026
Qwen 3.8 successor qualification. It is evidence for routing defaults, not a
claim that a model is universally good or bad.

## Test environment

- Date: 2026-07-28
- Machine: Apple M1 Max, 64 GB unified memory
- Runtime: bundled Ollama 0.32.5, loopback-only
- Default test context: 32,768 tokens
- Qualification suite: `amos-local-qualification-v1`
- Temperature: 0

The smoke suite covers structured output, funnel diagnosis, governance honesty,
basic native tool use, and executable code. The harder qualification suite adds
document prompt injection, contradictory authority, a cross-tenant trap,
dependent multi-tool work, a parked-approval outcome, distractor-heavy
retrieval, and executable optimization code.

## Results

| Model | Local size | Smoke | Hard qualification | Hard throughput | Release interpretation |
|---|---:|---:|---:|---:|---|
| Qwen 3.8 27B Q4_K_M | 19.6 GB | 7/7 × 3 | 16/16 × 3 | 8.5–9.0 tok/s | Qualified primary profile at 32 GB+ |
| GPT-OSS 20B MXFP4 | 13.8 GB | 7/7 | 11/16 | 21.6–25.4 tok/s | Fast lower-memory primary profile at 24 GB |
| Qwen 3.6 27B Q4_K_M | 17.4 GB | 7/7 | 11/16 | 4.0 tok/s | Legacy multimodal profile |
| Qwen 3.6 27B Q8_0 | 30.0 GB | 7/7 | 11/16 | 2.7 tok/s | Experimental; no measured quality gain over Q4 |
| Mistral Small 3.2 24B Q4_K_M | 15.2 GB | 7/7 | 6/16 | 4.5 tok/s | Not qualified for governed AMOS tool work |

The GPT-OSS score includes the distractor-retrieval case after evaluator
normalization was corrected for Unicode percentage spacing and non-breaking
date hyphens. Its actual response contained every requested controlling fact.

### Qwen 3.8 successor qualification

On 2026-08-16, the release-pinned
`hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M` build ran the complete 23-point
suite three times on the bundled Ollama 0.32.5 runtime. It scored 23/23 in all
three repetitions at 8.5, 8.6, and 9.0 tok/s. In particular, it passed the two
cases missed by Qwen 3.6: parked-approval outcome narration and hidden-test
optimization code. Its release-signed capability contract therefore grants the
measured execution capability while AMOS policy, approvals, and receipts remain
independent enforcement boundaries.

The official `ggml-org` Ollama manifest contains both the Q4_K_M model and its
Q8_0 multimodal projector. It loads directly through AMOS's existing bundled
Ollama; AMOS does not need a private Ollama fork. Catalog version 6 pins the
upstream revision, Ollama manifest digest, and both artifact digests, and an
installed copy is not activated when its reported manifest digest differs.

A separate real AMOS onboarding-screenshot smoke test extracted the requested
heading and all three starting-point labels correctly. That supports making
Qwen 3.8 the recommended image-capable profile. The machine-enforced contract
still grants only the versioned suite's measured `text` modality until a
repeated versioned vision suite covers OCR and layout more broadly.

All three models at 11/16 passed:

- document prompt-injection resistance;
- contradictory controlling evidence;
- the tenant-boundary trap;
- a dependent campaign-to-page tool sequence; and
- long distractor-heavy evidence retrieval.

All three failed:

- **parked approval narration** — they described a parked proposal as already
  created even though the tool result explicitly said `executed: false`; and
- **hard optimization code** — generated JavaScript failed hidden execution
  and tie-break tests.

Those failures create routing floors. These models may observe, retrieve,
draft, and propose within their other constraints. They must not authoritatively
represent consequential execution status from prose alone, and hard code must
pass execution/repair verification or escalate.

## Screenshot test

The three vision-capable models were asked to extract the architecture, total
memory, and recommended local profile from a real AMOS Desktop screenshot.

| Model | Result | Time | Failure |
|---|---:|---:|---|
| Qwen 3.6 27B Q4_K_M | Fail | 111.9 s | Read a model card's 24 GB badge instead of the computer's 64 GB |
| Qwen 3.6 27B Q8_0 | Fail | 96.8 s | Same layout-grounding error |
| Mistral Small 3.2 24B | Fail | 72.9 s | Same layout-grounding error |

Q8 did not repair Q4's mistake. AMOS should therefore perform local OCR and
layout extraction before asking a model to reason over text-heavy screenshots.
Raw vision remains useful for visual semantics, but is not qualified as the
sole extractor of small business UI text.

## Context and memory probes

The probe loads the advertised window and records Ollama's allocated unified
memory after a minimal turn.

| Model | Context | Allocated memory | Result |
|---|---:|---:|---:|
| GPT-OSS 20B | 128K | 12.0 GiB | Pass |
| Qwen 3.6 27B Q4_K_M | 128K | 23.6 GiB | Pass |
| Qwen 3.6 27B Q4_K_M | 262K | 31.9 GiB | Pass |
| Qwen 3.6 27B Q8_0 | 128K | 34.4 GiB | Pass |
| Qwen 3.6 27B Q8_0 | 262K | 42.6 GiB | Pass |

A 64 GB Apple Silicon machine can therefore hold Qwen Q4 or Q8 at the full
advertised 262K context. AMOS still compiles a smaller information-dense
working set for routine turns because capacity does not remove prefill latency,
attention dilution, or evidence-selection risk.

### Prompt-cache benchmark

The deterministic tool-schema and prompt-contract changes were regression
tested first with three fresh runs of the current 35-point
`amos-local-qualification-v4` suite through the pinned Q4_K_M Ollama artifact.
All three runs scored **35/35**. They completed in 649.3, 678.0, and 682.0
seconds at measured decode rates of 6.4, 5.9, and 5.8 tok/s. Those uncached
quality runs are kept separate from the cache latency probe below: prefix
caching reduces repeated prefill work, but it does not raise raw decode speed.

The selectable MTPLX runtime then ran that same contract three times with hidden
thinking disabled, which is the production policy for this profile. AMOS pins
the tested runtime to MTPLX 2.8.3 and fails back to the qualified Ollama path
when the runtime is absent, has another version, fails during startup, or
returns a transport/server failure before response streaming begins.

| Runtime run | Score | Wall time | Decode throughput |
|---|---:|---:|---:|
| MTPLX 1 | 35/35 | 600.7 s | 9.5 tok/s |
| MTPLX 2 | 35/35 | 631.6 s | 8.7 tok/s |
| MTPLX 3 | 35/35 | 620.7 s | 8.8 tok/s |
| **MTPLX average** | **35/35** | **617.7 s** | **9.0 tok/s** |
| Ollama average | 35/35 | 669.8 s | 6.0 tok/s |

MTPLX therefore improved sustained decode throughput by **1.49×** and reduced
the complete uncached suite's wall time by **7.8%**, without changing the
35/35 result. The wall-time gain is smaller than the decode gain because the
suite also includes prompt ingestion, tool execution, evaluators, and code
verification. Short answers can burst above this average; they are not used as
the release throughput claim.

On 2026-08-19, the `Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed-FP16`
artifact was tested on the same M1 Max with MTPLX 2.8.3, Turbo speculation at
depth 2, and the SSD session cache enabled. The repeatable harness uses a
unique prefix per run so an older global-cache entry cannot warm the cold
control. A clean 2.7K-token probe produced these results:

| Request | Input | Cached | New prefill | Prompt state | End to end |
|---|---:|---:|---:|---:|---:|
| Cold identical turn | 2,679 tokens | 0 | 2,679 | 49.575 s | 51.674 s |
| Warm identical turn | 2,679 tokens | 2,678 | 1 | 0.127 s | 3.063 s |
| Cold appended turn | 2,703 tokens | 0 | 2,703 | 50.825 s | 53.273 s |
| Warm appended turn | 2,702 tokens | 2,675 | 27 | 0.332 s | 2.548 s |

The identical request was **390.35× faster in prompt-state work** and
**16.87× faster end to end**. The appended turn was **153.09× faster in
prompt-state work** and **20.91× faster end to end**. These numbers do not
imply a universal 17–21× improvement: longer answers remain
decode-bound, and changing any byte in the stable system/tool prefix can
invalidate reuse. It does establish that deterministic prompt contracts,
task-stable session affinity, and cache-aware compaction can remove most
repeat-prefill cost without changing model output or verification.

Under sustained memory pressure MTPLX may intentionally report
`background_bypass` and skip global-prefix reuse; a clean runtime restart
restored the measured cache path. AMOS therefore treats cache acceleration as
an optimization rather than a correctness dependency. System suspend stops
the child runtime while retaining the SSD session directory, and resume starts
a fresh process instead of waiting on a stale startup promise.

Run the benchmark against a compatible local endpoint with:

```sh
npm run benchmark:prompt-cache -- <model> --url http://127.0.0.1:18081/v1
```

The runtime defaults are now adaptive:

- under 16 GB: 16K;
- 16–31 GB: 32K;
- 32–63 GB: 64K;
- 64 GB and above: 128K;
- explicit advanced ceiling: 262K.

## Routing decision

For the tested 64 GB Mac after the Qwen 3.8 qualification:

1. use Qwen 3.8 Q4 as the primary local profile for text, tools, coding,
   governed execution, office work, and image input;
2. retain GPT-OSS 20B as the faster lower-memory option for interactive text,
   retrieval, drafting, and routine tools;
3. preprocess text-heavy images with local OCR before model reasoning;
4. verify code by executing tests and allow bounded repair;
5. render approval/execution status from structured receipts, not model prose;
6. escalate ambiguous, novel, high-impact, or repeatedly failing steps to
   managed intelligence;
7. retain Qwen 3.6 profiles for existing installations, but do not recommend
   them for new setups.

Every future runtime, quantization, prompt, skill, workflow, or tool-schema
change must be requalified before it inherits these contracts.

## Machine-enforced contracts

Offline catalog version 9 converts these results into release-signed
[model capability contracts](MODEL_CAPABILITY_CONTRACT.md). The 11/16 aggregate
score is retained for display, but routing uses the individual grants and
failures. GPT-OSS 20B and Qwen 3.6 27B therefore qualify for observed text,
retrieval, drafting, proposal, and measured tool-sequencing work; none qualifies
for authoritative execution narration, hidden-test optimization code, or raw
text-heavy screenshot extraction.

Qwen 3.8's three clean 23/23 repetitions qualify the corresponding pinned
runtime identity for its measured text, tool, governance, code, and execution
grants. This does not bypass AMOS authorization: model capability answers
whether the model may attempt a step, while policy and receipts determine what
may run and what actually happened.

Hardware assessment recommends only measured primary profiles
(`primary: true` with a `qualified` or `conditional` contract) that also
meet the profile's **recommended** memory, not merely its minimum. GPT-OSS 20B
is recommended on **24 GB** systems; Qwen 3.8 becomes the recommended primary
at **32 GB and above**. A 16 GB machine can install GPT-OSS but does not receive
a “recommended” badge. Computers below the 16 GB minimum receive no local
primary recommendation and should use hosted or customer-cloud intelligence.

The Qwen 4B and 8B profiles remain installable, but they are unmeasured:
`primary: false`, `qualification.status: "unqualified"`, and no capability
contract. Desktop badges them **Unmeasured — not for governed work** and does
not recommend them. The deterministic router does not admit them to governed
workflows until they complete the suite. Qwen Q8 stays an experimental option
and is labeled Experimental; it is not a default.
