# ExpertCache reference trace capture

This directory turns ExpertCache Phase 0 into a reproducible experiment. The
capture process runs the pinned GPT-OSS 120B checkpoint on suitable reference
hardware and records only selected expert IDs. Prompts and generated text never
enter the trace.

## Reference environment

- one 80 GB accelerator capable of loading the official checkpoint;
- Python 3.11;
- a hardware-appropriate PyTorch build; and
- the pinned Transformers revision in `requirements-reference.txt`.

Create an isolated environment on the reference host:

```bash
python3 -m venv .venv-expert-cache
source .venv-expert-cache/bin/activate
# Install the correct PyTorch wheel for the host first.
pip install -r experiments/expert_cache/requirements-reference.txt
```

The pinned Transformers source exposes `GptOssTopKRouter` as an ordinary
PyTorch module. Capture disables Hub kernel replacement so router hooks cannot
be silently bypassed.

## Safe input

`reference-prompts.example.jsonl` is a small public/synthetic starter corpus.
Replace or expand it only with synthetic, public, or explicitly approved
benchmark cases. Each input record allows exactly:

```json
{"trace_id":"random-label","workflow":"coding","messages":[{"role":"user","content":"Synthetic benchmark prompt"}]}
```

The prompt corpus is read locally and is never copied into the output trace.
The required acknowledgement makes accidental use of tenant data harder:

```bash
python experiments/expert_cache/capture_gpt_oss_trace.py \
  --input experiments/expert_cache/reference-prompts.example.jsonl \
  --output experiments/expert_cache/output/gpt-oss-120b.trace.jsonl \
  --expert-bytes EXACT_BYTES_FOR_ONE_LAYER_EXPERT \
  --weight-store-bytes EXACT_CHECKPOINT_BYTES \
  --shared-resident-bytes MEASURED_NON_EXPERT_BASELINE_BYTES \
  --max-new-tokens 128 \
  --acknowledge-safe-input
```

Capture the reproducible greedy arm first. Then run a separately labelled
production-like sampled arm:

```bash
python experiments/expert_cache/capture_gpt_oss_trace.py \
  --input experiments/expert_cache/reference-prompts.example.jsonl \
  --output experiments/expert_cache/output/gpt-oss-120b.sampled.trace.jsonl \
  --expert-bytes EXACT_BYTES_FOR_ONE_LAYER_EXPERT \
  --weight-store-bytes EXACT_CHECKPOINT_BYTES \
  --shared-resident-bytes MEASURED_NON_EXPERT_BASELINE_BYTES \
  --max-new-tokens 128 \
  --capture-mode sampled \
  --temperature 0.7 \
  --top-p 0.95 \
  --seed 42 \
  --samples-per-case 3 \
  --acknowledge-safe-input
```

Keep greedy and sampled output files separate. The simulator stratifies
workflow and sequence position, while repeated sampled generations expose
routing variance that a greedy-only trace can hide.

Do not guess the three byte values for a go/no-go run. Derive the expert and
checkpoint sizes from the pinned stored tensors, and measure the non-expert
resident baseline on that run.

The capture writes:

- the routing trace at the requested path;
- a sibling `.summary.json` with captured and dropped record counts; and
- a `.partial` file instead of a final trace if execution fails.

Any dropped record makes the run fail. Increase `--queue-size` and rerun rather
than analyzing an incomplete trace.

## Simulate

```bash
npm run experiment:expert-cache -- \
  --trace experiments/expert_cache/output/gpt-oss-120b.trace.jsonl \
  --policies lru,lfu,slru,tinylfu \
  --slots 4,8,16,32,64,96 \
  --budgets-gib 32,40,46 \
  --verify-batches 1,2,4,8 \
  --acceptance-rates 0.5,0.75,1 \
  --concurrency 1,2 \
  --profile-trace experiments/expert_cache/output/gpt-oss-120b.training.trace.jsonl \
  --read-gib-s MEASURED_SSD_GIB_PER_SECOND \
  --range-latency-ms MEASURED_RANGE_LATENCY_MS \
  --upload-gib-s MEASURED_METAL_UPLOAD_GIB_PER_SECOND \
  --slot-remap-ms MEASURED_SLOT_REMAP_MS \
  --json
```

The reference run is intentionally not launched from a developer laptop. GPU
allocation and cost remain an explicit infrastructure decision.

Run the same workflow corpus against GPT-OSS 20B. The 120B path must beat that
control on the hard qualification floors and reduce managed-frontier
escalations; a larger model name or a higher easy-task score is not sufficient.

When the Phase 1 llama.cpp/Metal tracer is available, compare it with the
greedy Transformers trace before trusting cache-locality results:

```bash
npm run experiment:expert-compare -- \
  --reference experiments/expert_cache/output/gpt-oss-120b.trace.jsonl \
  --candidate experiments/expert_cache/output/gpt-oss-120b.llama-cpp.trace.jsonl
```

## Phase 1 mapped-page replay

The completed 64 GB M1 Max run produced a no-go for the mmap page-advice
architecture. Read
[`PHASE_ONE_RESULTS.md`](PHASE_ONE_RESULTS.md) before extending the runtime.
The harness remains here to make the result reproducible and to test materially
different memory-ownership designs.

Phase 1 starts with an Apple-silicon-specific test of the real GGUF page
working set. It intentionally does not force compact Metal slot remapping: an
upstream experiment found that the required per-layer synchronization could
erase the benefit even at very high logical hit rates.

The pinned runtime manifest is `runtime-manifest.json`. Prepare it with:

```bash
npm run experiment:expert-runtime
```

Generate a private, content-free byte layout from the target GGUF shard(s):

```bash
npm run experiment:expert-layout -- \
  --gguf /models/model-00001-of-00002.gguf \
  --gguf /models/model-00002-of-00002.gguf \
  --gguf-python ~/.cache/amos/expert-cache/llama.cpp/gguf-py \
  --source-revision 7e1e28cae36d41fe7bbe9dae7c9625de6565c063 \
  --output experiments/expert_cache/output/model.layout.json
```

Then run the reproducible four-arm experiment against the already privacy-safe
routing trace and those exact mmap ranges:

```bash
npm run experiment:expert-phase-one -- \
  --gguf /models/model.gguf \
  --trace experiments/expert_cache/output/gpt-oss-120b.trace.jsonl \
  --gguf-python ~/.cache/amos/expert-cache/llama.cpp/gguf-py \
  --phase decode \
  --cache-candidate slru:63:1 \
  --output-dir experiments/expert_cache/output/phase-one
```

The report includes logical reuse, `mincore`-observed physical page residency
before every access, real page-touch latency, major/minor page faults, cold
bytes per token, admissions, evictions, advice calls, and maximum RSS. Page
touching runs as a native NumPy strided access rather than a Python page loop.
`--mode natural` leaves mmap residency entirely to the stock OS/runtime;
`--mode disabled` releases every transient range and is the hard-off
microbenchmark control. Run cold-cache arms in separate processes with
`--cold-start` and record the host state.

Repeat `--trace-id` or `--workflow` to select a held-out slice. Every report
includes per-trace and per-workflow latency, logical misses, physical cold
bytes, and the first-token burst at each trace boundary. Repeat
`--cache-candidate POLICY:SLOTS:ADMIT_AFTER` to compare bounded policies.
Training-derived and online-prefill prewarm diagnostics are available through
`--profile-trace`, `--prewarm-experts-per-layer`,
`--prewarm-from-prefill`, and `--prewarm-admission`; the results document why
neither variant passed on the tested machine.

The runner produces one JSON report per arm plus a compact `summary.json` with
the exact model/runtime pins, host profile, and an explicit mapped-page gate.
That gate requires a bounded working-set arm to beat the hard-off control on
p95 page access and physical cold bytes, remain below 250 MiB of physical cold
reads at aggregate and per-workflow p95, bound each task transition to the same
250 MiB threshold, and keep its estimated expert-plus-shared footprint within
46 GiB. It is only a page-feasibility result: bit equivalence and live Metal
throughput, memory, thermal, and quality gates remain mandatory after a pass.
Pass `--max-tokens 128` for a short calibration run before committing to the
full corpus.
