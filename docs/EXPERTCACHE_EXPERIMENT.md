# ExpertCache experiment

## Objective

Determine whether GPT-OSS 120B can deliver useful AMOS inference on a 64 GB
Apple Silicon machine by exploiting its sparse expert activation instead of
loading every expert into Metal or relying on uncontrolled macOS swap.

GPT-OSS 120B has 116.8B total parameters but activates about 5.13B per token.
Its official MXFP4 checkpoint is approximately 60.8 GiB and is intended to fit
an 80 GB accelerator. That is too close to the full memory of a 64 GB Mac once
KV cache, the shared path, runtime buffers, and the operating system are
included.

ExpertCache is successful only if it improves governed work per second and per
dollar. Merely producing a token from a nominally loaded 120B model is not a
product result.

The non-negotiable capability invariant is:

> Cache state may change latency and resource use. It must never change model
> numerics, selected experts, tool policy, or output.

A capability contract is valid only for the exact model digest, runtime
revision, quantization, cache policy, and slot layout that passed this
invariant.

## What upstream work changes

llama.cpp already exposes useful seams:

- `--cpu-moe` and `--n-cpu-moe` can keep expert tensors outside GPU memory;
- selected expert IDs are available in the scheduler before expert
  multiplication;
- model files are memory-mapped and can accept explicit readahead hints; and
- current experimental work is testing persistent expert-slot caches rather
  than copying selected rows into a full-size transient tensor every pass.

The most relevant upstream reports are:

- [two-tier expert cache proposal and Apple notes](https://github.com/ggml-org/llama.cpp/issues/20757);
- [current MoE cache RFC and benchmark discussion](https://github.com/ggml-org/llama.cpp/discussions/24528);
- [mmap and selected-expert prefetch experiments](https://github.com/ggml-org/llama.cpp/discussions/18758); and
- [official GPT-OSS 120B model card](https://huggingface.co/openai/gpt-oss-120b).

These reports also show the trap: a compact Metal cache added beside still-live
original expert tensors increases memory. The Apple path must prevent cold
experts from being loaded into Metal in the first place and load selected
expert bytes into a bounded slot pool.

## Architecture under test

```text
resident shared path
  embeddings + attention + routers + norms + output
                |
                v
        top-4 expert IDs / layer
                |
        +-------+--------+
        | persistent hit |
        | in Metal slots |
        +-------+--------+
                |
          miss / admission
                |
        mmap expert store on SSD
        + bounded RAM staging
        + async prefetch
```

The cache is per layer. A global expert ID is remapped to a compact resident
slot. The kernel consumes slot IDs, not offsets into a full 128-expert Metal
tensor.

## Phase 0 — trace before runtime work

Run the reference 120B checkpoint on an 80 GB accelerator and record, for every
token and layer:

- selected top-4 expert IDs;
- prefill versus decode phase;
- workflow, skill, tool surface, and context-compiler fingerprint;
- prompt and generation token counts;
- accepted speculative-draft spans, when present; and
- qualification result.

Use synthetic and company-safe AMOS tasks only. No tenant payload enters the
trace corpus without an explicit training/benchmark data contract.

Replay those traces through an offline simulator with:

- LRU, LFU, segmented LRU, and TinyLFU admission;
- 4, 8, 16, 32, 64, and 96 slots per layer;
- layer-ordered prefill streaming that never contaminates the decode cache;
- sorted adjacent range reads versus bounded overread;
- next-token, next-layer, and workflow-conditioned prefetch; and
- 32 GiB, 40 GiB, and 46 GiB resident budgets.

The simulator reports hit rate, cold bytes per accepted token, range count per
token, reuse distance, worst-case miss bursts, and p50/p95/p99 cache-induced
stall decomposed into range latency, SSD transfer, Metal upload, and slot
remapping. Policy ranking uses p95 stall, not hit rate alone. This is the
cheapest point at which to kill a weak hypothesis.

Do not infer a product result from one aggregate number. Reports are stratified
by workflow and decode position. The full run includes:

- one greedy reproducibility trace and a separately labelled sampled arm;
- single-stream and two-stream replay;
- verification batches of 1, 2, 4, and 8 tokens at measured acceptance rates;
- a GPT-OSS 20B control for every workflow; and
- train/evaluation splits for any workflow-conditioned prewarm profile.

Profiles must be learned only from the training split. A profile built from the
same trace it is evaluated on is data leakage, not evidence of locality.

Phase 0 now includes the privacy-safe
[routing trace contract](EXPERTCACHE_TRACE_FORMAT.md) and an executable policy
sweep:

```bash
npm run experiment:expert-cache -- \
  --trace test/fixtures/expert-cache-trace.jsonl \
  --policies lru,lfu,slru,tinylfu \
  --slots 4,8,16,32,64,96 \
  --budgets-gib 32,40,46 \
  --verify-batches 1,2,4,8 \
  --acceptance-rates 0.5,0.75,1 \
  --concurrency 1,2 \
  --profile-trace PATH_TO_SEPARATE_TRAINING_TRACE \
  --read-gib-s MEASURED_SSD_GIB_PER_SECOND \
  --range-latency-ms MEASURED_RANGE_LATENCY_MS \
  --upload-gib-s MEASURED_METAL_UPLOAD_GIB_PER_SECOND \
  --slot-remap-ms MEASURED_SLOT_REMAP_MS
```

The checked-in fixture proves parsing and cache accounting. It is not evidence
about GPT-OSS expert locality; that requires reference-model traces.

The latency inputs are mandatory for a stall-ranked go/no report and must be
measured on the target Mac. The simulator uses a deliberately conservative
additive model:

```text
stall = ranges × seek
      + cold bytes ÷ SSD bandwidth
      + cold bytes ÷ Metal upload bandwidth
      + misses × slot-remap cost
```

The prototype must then validate the modeled p95 against wall-clock telemetry.

The reference capture harness is checked in at
[`experiments/expert_cache`](../experiments/expert_cache/README.md). It pins the
official GPT-OSS checkpoint revision and Transformers implementation, rejects
extra input fields, requires an explicit safe-data acknowledgement, records no
prompt or generated text, and fails the run if its bounded writer drops any
routing record.

## Phase 0 reference result — 2026-07-28

The first complete reference run passes the routing-locality gate and supports
proceeding to a selective-loader prototype. It does **not** yet pass the product
gate.

The run used:

- model revision `b5c939de8f754692c1647ca79fbf85e8c1e70f8a`;
- Transformers revision `ff24c90cdda4b620327e8b4168692729289ce477`;
- native `Mxfp4GptOssExperts` execution and the
  `mxfp4_mlp_router_logits` capture seam;
- 36 layers, 128 experts per layer, and top-4 routing;
- 13,236,480 bytes per layer expert, 4,255,115,904 shared resident
  bytes, and 65,248,815,744 total stored tensor bytes; and
- experiment commit `dae390e3f193faa6e5754d89d75cc2bab8673ea1`.

The privacy-safe traces completed with zero dropped records:

| Split | Mode | Cases | Routed tokens |
|---|---|---:|---:|
| Training | greedy | 14 | 3,382 |
| Evaluation | greedy | 14 | 3,427 |
| Evaluation | sampled, temperature 0.7 / top-p 0.95 | 28 | 6,854 |

The simulator evaluated 720 valid configurations per evaluation arm. Latency
used measurements from the target 64 GB M1 Max:

- 11.58 GiB/s uncached sequential SSD reads;
- 0.0015 ms p95 random-range latency;
- 46.41 GiB/s conservative p05 Metal upload bandwidth; and
- 0.00384 ms per-slot remap proxy.

The table below reports conservative LRU replay with one-token verification,
100% acceptance, and one stream. This avoids using idealized speculative
batching to justify the result.

| Resident budget | Slots/layer | Greedy hit | Greedy p95 cold / stall | Sampled hit | Sampled p95 cold / stall | Result |
|---:|---:|---:|---:|---:|---:|---|
| 32 GiB | 63 | 94.23% | 265.09 MiB / 28.05 ms | 94.19% | 277.71 MiB / 29.38 ms | Fail cold-read gate |
| 40 GiB | 81 | 97.52% | 126.23 MiB / 13.36 ms | 97.57% | 126.23 MiB / 13.36 ms | Pass |
| 46 GiB | 94 | 98.69% | 88.36 MiB / 9.35 ms | 98.82% | 75.74 MiB / 8.01 ms | Pass |

At 46 GiB, every workflow stayed above 98.1% greedy hit rate and 98.2%
sampled hit rate. Early decode also remained above 98.4% greedy and 98.6%
sampled. The largest single-token modeled stalls were 33.39 ms greedy and
48.09 ms sampled. Workflow prewarm was bounded but material: up to 3.69 seconds
at a cold trace start. Product UX must expose this startup state rather than
presenting it as token latency.

Decision: **go to Phase 1** with 40 GiB as the safer initial 64 GB profile and
46 GiB as the performance profile. Do not ship 32 GiB for GPT-OSS 120B.

The remaining evidence is intentionally separate:

- the Phase 0 trace records routing, not generated text, so it cannot claim a
  120B qualification improvement over the 11/16 GPT-OSS 20B control;
- the latency model must be validated against a real Metal selective loader;
- reference multi-GPU throughput is not evidence of Mac throughput; and
- bit equivalence, at least 6 generated tokens/second, first useful output,
  memory pressure, thermals, cancellation, and escalation reduction remain
  Phase 1/product gates.

## Phase 1 — selective loader

Fork a pinned llama.cpp revision and:

1. load shared tensors normally;
2. register cold `ffn_*_exps` tensors as file metadata without allocating their
   full Metal buffers;
3. allocate compact per-layer Metal slot pools;
4. `pread` or mmap-prefetch selected expert ranges into double-buffered staging;
5. remap selected expert IDs to resident slots;
6. preserve a hard flag that restores stock behavior; and
7. emit cache diagnostics without logging prompt content.

First prove bit-equivalent output with a cache large enough to contain every
expert. Then reduce the cache. Quality comparisons before that equivalence
check are not meaningful.

Compare selected top-4 sets from the pinned Transformers reference and the
pinned llama.cpp/Metal runtime on the same greedy corpus. Near-tie differences
must be investigated before locality results are trusted.

```bash
npm run experiment:expert-compare -- \
  --reference path/to/transformers.trace.jsonl \
  --candidate path/to/llama-cpp.trace.jsonl
```

Phase 1 is implemented against a pinned llama.cpp revision because the loader
and scheduler seams are required. The product integration target is the same
patch carried in AMOS's bundled Ollama runtime, preserving one runtime
lifecycle, updater, and trust chain. A second sidecar is an experiment harness,
not the shipping architecture.

## Phase 2 — AMOS integration

Expose ExpertCache as an experimental background profile:

- never the first-run default;
- no silent system swap as an operating mode;
- cancellation and memory-pressure handling;
- explicit startup/prewarm status;
- signed model and runtime digests;
- local-only telemetry by default; and
- a capability contract tied to the exact runtime revision and cache policy.

GPT-OSS 20B can draft tool plans or response blocks. The 120B model verifies
batches only if measured speculative acceptance reduces total wall time.
`verify-batch K` replays the union of the next K tokens' expert sets and
amortizes misses over accepted tokens; the idealized 100% acceptance arm is
never presented as a production result.

Local concurrent jobs are serialized by default. Two-stream operation is
enabled only after the two-stream replay and prototype remain inside the same
stall, memory, and thermal gates.

## Go/no-go gates

Proceed from trace simulation to a Metal prototype only if at least one bounded
policy achieves:

- an aspirational 90% decode expert hit rate, with misses and stalls reported
  separately for every workflow and decode-position bucket;
- modeled p95 cache stall below 80 ms per accepted token on calibrated 64 GB
  Mac storage and upload measurements;
- cold reads below 250 MiB per generated token at p95;
- no unbounded miss burst caused by a workflow switch; and
- an estimated complete resident footprint at or below 46 GiB.

The hit-rate target is diagnostic rather than an independent pass: a lower hit
rate may proceed only if measured stall stays inside the hard bound. A high hit
rate with long miss stalls fails.

Proceed from prototype to product integration only if the 64 GB Mac achieves:

- at least 6 generated tokens/second for background work;
- first useful output within 20 seconds on a 4K compiled prompt;
- no swap growth, UI starvation, or memory-pressure termination;
- no thermal runaway or sustained battery drain that makes normal desktop work
  impractical;
- deterministic cancellation and restart;
- bit-equivalent output versus the stock runtime for the same quantized model;
- a statistically meaningful qualification gain over GPT-OSS 20B, including
  flipping the parked-approval narration and hard optimization-code floors;
- a measurable reduction in managed-frontier escalation rate; and
- a better quality-latency-cost point than managed 120B verification.

If the cache misses these gates, stop. Use a private two-node inference pool,
more aggressive qualified quantization, hosted 120B review, or the
AMOS-specialized student instead.

## Experimental matrix

| Variant | Shared path | Experts | Context | Purpose |
|---|---|---|---:|---|
| Reference | official precision | official MXFP4, resident on 80 GB GPU | 32K | Quality truth |
| Full Mac attempt | official | stock mmap/swap behavior | 8K | Establish failure mode only |
| Mixed-bit resident | protected shared tensors | calibrated 2–3 bit experts | 32K | Test complete residency |
| ExpertCache | protected shared tensors | MXFP4 cold store + Metal hot slots | 32K | Main hypothesis |
| Draft/verify | GPT-OSS 20B draft | ExpertCache 120B verify | 32K | Reduce verifier work |
| Two-node | shared path replicated | expert or layer partition | 32K | Private enterprise fallback |

Every row runs the same AMOS qualification and context suites.
