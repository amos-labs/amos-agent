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

- selected top-4 expert IDs and router weights;
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
- admission that excludes one-off prefill experts;
- sorted adjacent range reads versus bounded overread;
- next-token, next-layer, and workflow-conditioned prefetch; and
- 32 GB, 40 GB, and 48 GB total cache budgets.

The simulator reports hit rate, cold bytes per token, range count per token,
reuse distance, and worst-case miss bursts. This is the cheapest point at which
to kill a weak hypothesis.

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

## Go/no-go gates

Proceed from trace simulation to a Metal prototype only if at least one bounded
policy achieves:

- at least 90% decode expert hits across the AMOS qualification corpus;
- cold reads below 250 MiB per generated token at p95;
- no unbounded miss burst caused by a workflow switch; and
- an estimated complete resident footprint below 50 GiB.

Proceed from prototype to product integration only if the 64 GB Mac achieves:

- at least 6 generated tokens/second for background work;
- first useful output within 20 seconds on a 4K compiled prompt;
- no swap growth, UI starvation, or memory-pressure termination;
- deterministic cancellation and restart;
- a statistically meaningful qualification gain over GPT-OSS 20B; and
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
