# ExpertCache routing trace format

ExpertCache Phase 0 records only sparse router selections and non-sensitive
experiment labels. It must not record prompts, messages, documents, tool
arguments, company facts, tenant IDs, user IDs, email addresses, or generated
text.

The file is UTF-8 JSON Lines. The first record is metadata:

```json
{"type":"metadata","schema":"amos.expert-routing-trace","version":1,"model":"openai/gpt-oss-120b","layers":36,"experts_per_layer":128,"active_experts":4,"expert_bytes":12600000,"weight_store_bytes":65283502899,"shared_resident_bytes":7800000000,"source_revision":"pinned-runtime-sha","created_at":"2026-07-28T00:00:00Z"}
```

Each remaining record represents one token:

```json
{"type":"token","trace_id":"random-run-id","token_index":0,"phase":"decode","workflow":"company-audit","experts":[[4,19,72,101],[7,18,55,89]]}
```

The abbreviated example has two layer arrays; GPT-OSS 120B records exactly 36.
Each layer contains four unique IDs from 0 through 127.

## Field rules

### Metadata

- `schema`: always `amos.expert-routing-trace`;
- `version`: currently `1`;
- `model`: exact model/checkpoint identifier;
- `layers`: router-bearing MoE layer count;
- `experts_per_layer`: total experts available in each layer;
- `active_experts`: experts selected per token and layer;
- `expert_bytes`: bytes required for one complete expert in one layer,
  calculated from the exact stored tensor representation;
- `weight_store_bytes`: optional complete checkpoint/store size;
- `shared_resident_bytes`: optional resident embeddings, attention, routers,
  norms, output, KV/runtime baseline, and other non-cached bytes;
- `source_revision`: pinned tracing runtime revision; and
- `created_at`: trace creation time.

### Token

- `trace_id`: random experiment-run identifier with no company or user meaning;
- `token_index`: index within the run;
- `phase`: `prefill` or `decode`;
- `workflow`: bounded AMOS workflow class, not free-form customer text; and
- `experts`: one selected-expert array per layer.

Unknown fields fail parsing. This is deliberate: it prevents a convenient
diagnostic record from gradually becoming an ungoverned prompt log.

## Capture seam

The pinned reference capture harness lives in
[`experiments/expert_cache`](../experiments/expert_cache/README.md). It hooks
`GptOssTopKRouter` after top-k selection and before expert multiplication:

1. copy the small selected-expert ID tensor to the trace collector;
2. append a token record to a local buffered writer;
3. never block model execution on trace persistence;
4. flush at a bounded interval and on normal shutdown;
5. drop records, rather than application work, under trace backpressure; and
6. record dropped counts in a separate experiment summary.

The tracer is disabled by default and must use an explicit local output path.
It never sends traces to AMOS automatically.

The harness disables Transformers Hub kernel replacement. Some optimized
GPT-OSS paths replace the MLP forward method and can bypass the router module
or omit router-logit output. Capture correctness matters more than peak
reference throughput.

## Simulator

```bash
npm run experiment:expert-cache -- \
  --trace path/to/trace.jsonl \
  --policies lru,lfu,slru,tinylfu \
  --slots 4,8,16,32,64,96 \
  --budgets-gib 32,40,48
```

Use `--json` for a machine-readable report. The simulator reports:

- overall, prefill, decode, and workflow hit rates;
- cold bytes and p50/p95/p99/max cold bytes per token;
- cache and estimated shared-plus-cache resident footprint;
- the per-layer slot count that fits each requested total memory budget; and
- every policy/slot combination in the requested sweep.

The offline simulator has no model or GPU dependency, so large trace sweeps can
run cheaply before a Metal implementation exists.
