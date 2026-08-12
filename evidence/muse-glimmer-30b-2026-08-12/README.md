# Muse Glimmer 30B physical-host evidence

This directory contains the first AMOS qualification evidence for Muse Glimmer
30B on August 12, 2026. It is development evidence, not a release qualification
or a declaration of parity with a managed model.

## Reproducibility identity

- hardware: physical Apple M1 Max, 64 GB unified memory;
- model: official `muse-glimmer-30B-kquant-17gb.gguf`, 16,756,681,056 bytes;
- model SHA-256: `7e9b74b7c8875e9e265695df9613bf6290f2392e479ce740495a129019c488d8`;
- model repository revision: `a0532f7263ee67f1e0a5f5c5fdcd50dd62fc9aa4`;
- runtime: `llama.cpp` commit `f8def7fe168bab245fbf15d3f18b26dbb1ef73c8` (`b10353`);
- server: loopback-only, one slot, Metal, Jinja chat template; the original
  qualification used a 32,768-token context and the paired suite used 131,072;
- DFlash artifact: official `dflash-kquant.gguf`, 1,631,205,312 bytes, SHA-256
  `27d9a805fa29b943cfb6ad4843367cd4eaaaf06bd452d8cc3e00a2cd18a677bc`;
- primary sampling: reasoning strength `low`, temperature `1`, top-p `0.95`, top-k `64`.

The model artifact and runtime build live in ExpertCache's ignored `.cache`
tree and are not committed here.

## Results

| File | Treatment | Result |
| --- | --- | --- |
| `protocol-smoke-low.json` | low-strength protocol smoke | 7/7, 142.8s, 8.5 tok/s |
| `qualification-low.json` | low-strength official sampling | 16/16, 348.7s, 8.7 tok/s |
| `qualification-low-ac-clean-1.json` | low-strength official sampling, clean AC restart | 16/16, 377.5s, 8.6 tok/s |
| `qualification-low-temperature-zero.json` | low strength, temperature zero, battery-to-AC mixed state | 13/16, 416.8s, 5.6 tok/s; coding failed |
| `qualification-high.json` | high strength, official sampling | 13/16, 855.7s, 8.3 tok/s; coding exhausted the completion budget before a final answer |
| `integration-authority-low.json` | two authority/receipt counterfactuals, all ablation arms | all arms 2/2; no integration lift |
| `integration-development-baseline-low-ac.json` | five families plus five variants, base-only failure discovery | 10/10 combined cases; 26/30 atomic attempts; zero observed integration failures |
| `paired-sonnet-control-v1.json` | frozen hard suite, Sonnet 5 medium control | raw 28/32; adjudicated 32/32; 77.7s request time |
| `paired-muse-plain-v1.json` | identical frozen hard suite, plain Muse | raw 20/32; adjudicated 32/32; 593.0s; 7.19 tok/s |
| `paired-muse-dflash-v1.json` | identical suite, Meta DFlash drafter | raw 24/32; adjudicated 32/32; 713.2s; 6.31 tok/s |
| `paired-adjudication-v1.json` | symmetric review of exact-substring false negatives | all treatments 32/32; raw evidence and hashes preserved |

The first three pre-clean-restart runs were executed while the machine was on
battery. The temperature-zero run crossed from battery to AC. Their capability
outcomes remain useful, but their wall-time figures are not controlled AC speed
measurements. `qualification-low-ac-clean-1.json` records the first controlled
AC speed treatment explicitly.

## Current inference

Low reasoning strength with the published sampling settings is the only
configuration supported as the initial candidate default. The suite is small
and stochastic, so two 16/16 passes are a viability signal rather than a
confidence bound. High strength and deterministic sampling both regressed on
the hidden coding scenario.

The initial structured-workspace ablation was much more expensive and added no
quality on cases the base model already solved. The following experiment
therefore ran base-only failure discovery across all development families and
reserved elicitation or a workspace for observed failures.

That discovery sweep found no such failures: every combined base case passed.
Atomic knowledge was unstable in stale-writer fencing and collider conditioning,
so those are teaching/distillation targets rather than integration-engine
targets. The development set must become harder before another broad workspace
ablation would be informative.

The frozen paired diagnostic then showed model-only outcome parity with the
Sonnet control on all 12 cases after adjudication. The automated scorer was too
brittle to treat numeric and semantically equivalent rationale forms as equal;
its raw scores are retained as evidence of that evaluator defect rather than
rewritten.

Speed is now the primary observed gap. Plain Muse took 593.0 seconds across 18
calls and 3,873 output tokens. DFlash took 713.2 seconds across the same cases,
generated 4,134 output tokens, and reduced measured decode throughput by 12.2%.
The 20.3% wall-time regression rejects DFlash for this pinned M1 Max treatment.
The next speed work prioritizes shorter verified trajectories, avoided calls,
and deterministic integration shortcuts before another speculative arm.
