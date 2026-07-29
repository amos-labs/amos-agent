# Local GPT-OSS 120B live baseline

This experiment runs the pinned, unmodified llama.cpp Metal runtime against the
official GPT-OSS 120B MXFP4 GGUF on a 64 GB Apple Silicon Mac. It is the control
for every later ExpertCache, mixed-precision, or distributed-inference change.

It does **not** claim that Phase 1 page-advice replay is already part of live
inference. The stock runtime uses its normal memory-mapped model path.
Its current automatic device-fit logic remains enabled; the harness does not
force an artificial all-GPU layout.

## Why run the uncomfortable control

The checkpoint is 63,387,346,208 bytes while the qualification machine has
64 GiB of unified memory. The runtime, operating system, KV cache, Metal
working buffers, and other applications need memory too. A successful model
load therefore does not prove usable inference; macOS may compress or swap
enough memory to make the machine or model unresponsive.

The control establishes:

- whether the model loads and exits predictably;
- readiness and first-token latency;
- qualification throughput and score;
- process RSS and system swap throughout the run;
- whether the user can keep using the Mac; and
- which resource limit fails first if it cannot complete.

## Reproduce

Prepare the pinned runtime:

```bash
npm run experiment:expert-runtime
```

Download the pinned model artifact described by
`experiments/expert_cache/runtime-manifest.json` and verify its exact size
before the cold run. Compute the full digest after the run: hashing 59 GiB
immediately before inference would warm the file cache and contaminate the
control.

```bash
npm run experiment:120b-baseline -- \
  --model ~/.cache/amos/expert-cache/models/gpt-oss-120b-MXFP4.gguf \
  --server ~/.cache/amos/expert-cache/llama.cpp/build-amos-metal/bin/llama-server \
  --context 8192 \
  --suite qualification \
  --output-dir experiments/expert_cache/output/live-baseline-8k
```

The first run uses an 8K context to isolate the model-weight problem from a
large KV-cache allocation. If it completes, repeat at 32K for direct parity
with the existing AMOS local-model qualification report.

The untouched control intentionally preserves llama.cpp's 2,048-token default
batch. If that transient compute allocation exceeds the Metal working-set
limit, isolate the burst from weight residency by repeating with:

```bash
npm run experiment:120b-baseline -- \
  --model ~/.cache/amos/expert-cache/models/gpt-oss-120b-MXFP4.gguf \
  --server ~/.cache/amos/expert-cache/llama.cpp/build-amos-metal/bin/llama-server \
  --context 8192 \
  --batch 128 \
  --ubatch 64 \
  --suite qualification \
  --output-dir experiments/expert_cache/output/live-baseline-8k-b128-u64
```

If the smaller batch still crosses the Metal gate, increase the stock
auto-fit's reserved working-set margin before implementing a new cache:

```bash
npm run experiment:120b-baseline -- \
  --model ~/.cache/amos/expert-cache/models/gpt-oss-120b-MXFP4.gguf \
  --server ~/.cache/amos/expert-cache/llama.cpp/build-amos-metal/bin/llama-server \
  --context 8192 \
  --batch 128 \
  --ubatch 64 \
  --fit-target-mib 8192 \
  --suite qualification \
  --output-dir experiments/expert_cache/output/live-baseline-8k-fit8g
```

## Comparison contract

Run the unchanged `amos-local-qualification-v1` scenarios and scoring. The
current resident controls are:

| Model | Hard qualification | Hard throughput |
|---|---:|---:|
| GPT-OSS 20B MXFP4 | 11/16 | 21.6–25.4 tok/s |
| Qwen 3.6 27B Q4_K_M | 11/16 | 4.0 tok/s |
| Qwen 3.6 27B Q8_0 | 11/16 | 2.7 tok/s |

All three controls failed parked-approval narration and optimization coding.
The 120B memory cost is not justified unless it produces a meaningful quality
gain or enables a stronger teacher/verifier role.

## 64 GB M1 Max result

The live stock control did not produce a first token. All runs used the pinned
63,387,346,208-byte checkpoint at 8K context.

| Placement | Batch / micro-batch | Ready | First token | Peak RSS | Result |
|---|---:|---:|---:|---:|---|
| automatic fit | 2,048 / 512 | 99.3 s | none | 26.5 GiB | Metal command-buffer OOM |
| automatic fit | 128 / 64 | 94.2 s | none | 44.3 GiB | Metal command-buffer OOM |
| auto fit, 8 GiB target margin | 128 / 64 | 94.2 s | none | 42.6 GiB | Metal command-buffer OOM |
| all MoE weights on CPU | 128 / 64 | 130.4 s | none | 47.2 GiB | Metal command-buffer OOM |

The first run grew system swap from 9.6 GiB to 42.1 GiB and peaked at
45.4 GiB used during loading. The later runs were intentionally sequential,
so their absolute swap totals are contaminated by the first run and are not
valid comparative measurements. The CPU-MoE control reached 65.7 GiB peak
swap used before failing.

This is an execution failure, not a 0/16 quality score. The 120B checkpoint
remains unscored because the Metal backend enters an unrecoverable
`kIOGPUCommandBufferCallbackErrorOutOfMemory` state during warmup and every
request returns `Compute error` before sampling a token. Smaller batches and
stock placement controls do not solve the gate; further flag tuning is out of
scope.

The useful conclusion is architectural: successful `mmap` and a server
"model loaded" message do not mean the model fits. Whole-checkpoint Metal
residency plus transient compute buffers exceeds the device working-set limit.
The next implementation must bound Metal-resident routed-expert bytes and
reuse fixed device slots during live inference.

## Product gates

The Phase 1 250 MiB physical-cold-byte gate remains a diagnostic signal. It is
not a product requirement. The live gates are:

1. output and tool calls remain correct and deterministic enough to pass the
   same AMOS suite;
2. startup, cancellation, and shutdown are repeatable;
3. swap growth is bounded and does not leave the Mac unusable;
4. first useful output is tolerable for the intended interactive or background
   class;
5. steady-state throughput improves useful work rather than merely loading the
   checkpoint; and
6. every later optimization beats this control on a declared metric without
   silently weakening quality.

## ExpertCache live result

The first bounded-residency runtime crossed the execution gate. Instead of
binding the complete routed-expert checkpoint to Metal, it:

- keeps the GGUF checkpoint memory mapped;
- prevents complete MoE tensors from becoming Metal-resident;
- copies only the selected experts into four fixed shared Metal slots; and
- reuses bounded device allocations across all 36 layers.

On the same 64 GB M1 Max, the complete GPT-OSS 120B MXFP4 checkpoint now
generates tokens without a Metal out-of-memory failure. A 160-record
distractor-retrieval scenario completed correctly with a 4,058-token prompt.
That run exposed the next gate:

| Phase | Time | Throughput |
|---|---:|---:|
| prompt evaluation | 23.38 min | 2.89 tok/s |
| generation | 5.31 min | 1.00 tok/s |
| total | 28.69 min | — |

This is no longer a model-fit problem. It is an expert-staging and memory
traffic problem.

## Hosted-versus-local 120B control

The Bedrock on-demand model `openai.gpt-oss-120b-1:0` provides a control for
the local runtime. Both paths use the same optimization-coding prompt, a
1,536-token completion budget, deterministic sampling, and the same hidden
tests.

| Runtime | Result | Wall time | Reported generation rate |
|---|---:|---:|---:|
| Bedrock GPT-OSS 120B | 3/3 | 11.9 s | 119.0 tok/s |
| local ExpertCache GPT-OSS 120B MXFP4 | 3/3 | 1,048.0 s | 0.9 tok/s |
| local ExpertCache, layer-grouped projections | 3/3 | 714.9 s | 1.6 tok/s |

Both passed the hidden optimum, deterministic tie-break, and input
immutability tests. At the original 768-token budget, both outputs were
truncated and failed. Raising only the completion budget made both pass.

This is the decisive architectural finding: the bounded-memory path preserves
the model's demonstrated coding capability. The current product blocker is
latency, not a loss of model quality caused by ExpertCache.

The first scheduling optimization preserved the same result while reducing
wall time by 31.8% and increasing reported generation throughput from
0.93 to 1.56 tok/s. It is still far from an interactive hosted-model
experience, but it proves that runtime improvements can move speed without
weakening the model.

The full 768-token qualification score remains 11/16 for strict comparison
with the resident controls. The 1,536-token coding run is a diagnostic, not a
retroactive change to that contract. Bedrock's tenant-boundary response was
also safe but missed the evaluator's narrow accepted wording; that evaluator
false negative should be fixed separately without changing the frozen score.

Use `--skip-probe` during targeted performance work to avoid paying for the
independent 32-token readiness generation before every scenario:

```bash
npm run experiment:120b-baseline -- \
  --model ~/.cache/amos/expert-cache/models/gpt-oss-120b-MXFP4.gguf \
  --server /path/to/patched/llama-server \
  --context 8192 \
  --batch 16 \
  --ubatch 4 \
  --gpu-layers all \
  --expert-cache-slots 4 \
  --expert-cache-cpu-fill \
  --no-warmup \
  --skip-probe \
  --only "optimization coding" \
  --max-tokens 1536 \
  --request-timeout-seconds 2700 \
  --output-dir experiments/expert_cache/output/speed-b16-u4
```

## First speed experiments

The first batching attempts exposed a second memory gate. They are retained as
negative controls rather than presented as improvements:

| Runtime | Prompt rate | Generation rate | Result |
|---|---:|---:|---|
| four slots, one-token staging | 0.95 tok/s | 0.93 tok/s | stable; coding 3/3 at 1,536 |
| 128 slots, 32-token block | 0.20 tok/s at token 32 | not reached | stopped; broad cold-expert staging regressed |
| 16 slots, four-token block | 0.64 tok/s at token 52 | not reached | entered a 15-minute page/swap stall and timed out |
| four slots, layer-grouped projections | 1.03 tok/s | 1.56 tok/s | stable; coding 3/3 at 1,536 in 714.9 s |

The broad-cache runs did not fail because 72–576 MiB of slot storage was
intrinsically too large. They failed because each block touched a much wider
random region of the 59 GiB checkpoint before macOS could reclaim the prior
file-backed pages. The apparent batching improvement therefore crossed the
physical-memory burst gate and collapsed into swap.

The layer-grouped path keeps the physical slot budget at four experts but
gives each projection in one transformer layer a separate bounded buffer.
Gate, up, and down projections are staged after one routing synchronization
and executed in one command-buffer span. On the identical hidden coding
diagnostic, the path reduced wall time from 1,048.0 to 714.9 seconds while
preserving the 3/3 result. Reported generation throughput increased by 67.4%
without broadening the cold checkpoint working set.

Absolute memory measurements after the negative controls are contaminated:
macOS retained a large swap allocation, and an unrelated virtualization
process was using roughly 21 GiB of resident memory and more than six CPU
cores. A clean-machine rerun is required before publishing product
throughput. The relative result is still useful because the grouped run
crossed the exact token range where the wider cache stalled.

## Next experiment: performance without quality drift

With execution, capability, and one quality-preserving speed improvement
captured:

1. repeat the layer-grouped path after a reboot or with the unrelated VM
   stopped to establish a
   clean latency and swap baseline;
2. instrument per-layer expert staging bytes, unique routes, copy time, and
   command-buffer wait time;
3. parallelize the three bounded projection copies without widening the
   per-projection expert set;
4. evaluate direct, cache-bypassing reads into explicitly owned slots so cold
   expert pages do not accumulate in the normal mmap page cache;
5. run the 1,536-token coding diagnostic after each material optimization; and
6. run the frozen full qualification suite only at milestone candidates.

Only after the local 120B path reaches a practical speed should the experiment
expand to other checkpoints that previously exceeded the 64 GB machine.
