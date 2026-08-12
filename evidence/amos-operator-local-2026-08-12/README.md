# AMOS Operator Local base-model evidence

This directory records the first base-model race for the compact AMOS student.
It is development evidence, not a release qualification and not evidence that a
model has passed the physical 16 GB product gate.

## Ministral 3 8B identity

- hardware: physical Apple M1 Max, 64 GB unified memory, AC power;
- operating system: macOS 26.6 (`25G72`);
- model: official `Ministral-3-8B-Instruct-2512-Q4_K_M.gguf`;
- artifact size: 5,198,911,904 bytes;
- artifact SHA-256: `33e7a72cf5e6e2cfc2f2847075acc013d68bba023e35310cef86b5cf8fdca761`;
- model repository revision: `0102285ad796bd99af90f58de616092e5630e970`;
- runtime: `llama.cpp` commit `f8def7fe168bab245fbf15d3f18b26dbb1ef73c8`
  (`b10353`), Metal, mmap, one slot, 8,192-token context;
- suite sampling: temperature `0.2`, top-p `0.95`, top-k `40`;
- production guidance check: Mistral recommends temperature below `0.1`, so
  every genuine failure was repeated at temperature `0`.

The model artifact and runtime live in ExpertCache's ignored `.cache` tree and
are not committed here.

## Results

| Treatment | Result |
| --- | --- |
| matched native prompt, 512 tokens, 3 repetitions | 466.57 tok/s |
| matched native decode, 128 tokens, 3 repetitions | 28.22 tok/s |
| sustained native decode, 512 tokens, 3 repetitions | 28.29 tok/s |
| frozen 12-case AMOS suite | raw 14/32; adjudicated 20/32; 83.42s request time; 1,128 output tokens; 16.46 reported decode tok/s |
| four genuine failures repeated at temperature zero | all four reproduced |

For the same matched native benchmark, plain Muse Glimmer 30B measured 94.11
prompt tok/s and 7.60 decode tok/s. Ministral is 3.23 times smaller by model
data, 4.96 times faster on the matched prompt, and 3.71 times faster on the
matched short decode. On the frozen workflow suite, it used 29% as many output
tokens as plain Muse and completed 7.11 times faster, although it did not retain
Muse's adjudicated quality parity.

## Human adjudication

The automated scorer's exact-substring false negatives were handled under the
same policy already applied symmetrically to Sonnet and Muse. Three cases were
restored because the selected label and semantic rationale were correct:

- `collider-transfer`;
- `simpson-policy`;
- `causal-abstention`.

`fencing-transfer`, `authority-receipt-conflict`, and
  `temporal-evidence-chain` already passed automatically.

The adjudicated score is therefore 20/32, not parity. The remaining failures
are substantive:

- `correlated-bayes`: selected 89% instead of approximately 17%;
- `deadline-optimization`: ignored the final deadline violation and selected
  the infeasible 19-value schedule;
- `idempotent-approval`: executed the exact safe tool sequence but omitted the
  proposal receipt ID from the final report;
- `portfolio-code`: returned a placeholder rather than executable code.

The deterministic rerun at temperature zero reproduced all four failures.
These are the first verified teaching targets. The untouched frozen cases must
remain evaluation-only; training data may cover analogous skills but may not
copy their prompts, values, or answers.

## Decision

Ministral passes the initial size, runtime, structured-output, and tool-protocol
screens. It is the operational control and a viable training base, but it is
not selected as the final student foundation until the 9B capability challenger
is measured under the same suite and the training/export path passes a minimal
compatibility spike.

## Qwen 3.5 9B challenger

The community-converted Qwen 3.5 9B Q4_K_M artifact was 5,629,109,056 bytes
with SHA-256
`148ffb97ac1d4cbbaef95ff36dbc02948b9c25746d6df3bc86533b859060380a`.
It measured 24.74 tok/s on the matched 128-token native decode, so its hybrid
architecture clears the M1 Max speed screen.

The production-shaped non-thinking arm was not competitive. It scored raw
12/32 and adjudicated 18/32, failed both critical tool-flow cases, used 4,719
output tokens, and required 256.38 seconds. One correct code answer alone used
2,194 generated tokens and 133.7 seconds. A targeted thinking-mode treatment
fixed the Bayes and deadline problems, but required 185.4 and 156.5 seconds;
the authority/receipt case still failed after 58.8 seconds. The bounded thinking
treatment was stopped after those three cases and is not assigned an aggregate
score.

Qwen is therefore rejected as the v0 student base. It remains a secondary
capability/teacher experiment because it demonstrated stronger generic math and
code behavior, but its trajectory length, tail latency, critical protocol
failures, and current adapter/export risks are a poor match for the first local
product.

## QLoRA compatibility spike

The selected Ministral base completed a text-only QLoRA compatibility spike on
the same M1 Max using `mlx-vlm` 0.6.12 and MLX 0.32.0:

- checkpoint: `mlx-community/Ministral-3-8B-Instruct-2512-4bit`, revision
  `182f003f01daa75f9de0f2c4d379722fd0bc1c61`;
- data: three verified, synthetic, customer-data-free trajectories selected
  from dataset identity
  `25586b0c7f5a198defd9ce98174939cc76640ed6756cf6d77d4f96e1c451a55f`;
- treatment: completion-only QLoRA, rank 8, alpha 16, two iterations;
- trainable weights: 22,282,240 (0.25%); peak memory: 6.84 GB;
- loss observations: 5.2142 then 2.9208;
- adapter: 89,187,578 bytes, SHA-256
  `f14dcaf053702db9d5b07d761c6a75fd060a4f0783b138fc2627121694c222a8`;
- reload: passed, 6.08 GB peak memory, 29.34 generation tok/s, and the expected
  bounded answer on a synthetic receipt prompt.

This proves train/save/reload/infer compatibility only. Two steps over three
records make no quality claim. The next treatment requires at least 1,000
verified training trajectories and 200 family-isolated validation trajectories
before measuring adaptation lift.
