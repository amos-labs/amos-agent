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
  --output experiments/expert_cache/output/simulation.json \
  --json
```

The reference run is intentionally not launched from a developer laptop. GPU
allocation and cost remain an explicit infrastructure decision.

## Reproducible AWS reference runner

`run_reference_aws.sh` is the bounded worker used by the AMOS reference run. It:

- derives exact checkpoint and per-expert storage from the pinned safetensors;
- fails closed unless the fetched runner ref matches the expected Git commit;
- captures separate training-greedy, evaluation-greedy, and
  evaluation-sampled traces;
- uploads every completed stage and GPU telemetry to the configured private S3
  prefix;
- records its exact Git commit and Python dependency set; and
- shuts down the instance on success or failure.

The EC2 instance must additionally use instance-initiated shutdown behavior
`terminate`, and the outer user-data command must impose a wall-clock timeout.
The checked-in runner does not create infrastructure or choose a spending
limit.

On the target Mac, calibrate the latency model with:

```bash
npm run experiment:expert-calibrate-mac
```

The Metal slot-remap number is explicitly a small-table-copy proxy until the
Phase 1 runtime can emit real remap telemetry.

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
