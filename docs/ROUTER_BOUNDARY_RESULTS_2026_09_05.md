# Router learning experiment results — September 5, 2026

Targeted supervision produced two stronger local 0.8B candidates. The third seed
lost some deep-task accuracy, so the recipe did not pass its required three-seed
consistency check. Keep the existing router selected; retain the two passing
candidates for further research and independent qualification.

This is evidence of headroom in the existing small model. It does not establish
that the autonomous production learning loop improves routing, or that this
training recipe is ready for automatic promotion. The added supervision consists
of independently policy-labelled synthetic tasks, not verified customer outcomes.

## Frozen development screen

The primary measure counts a fresh task as correct only when both its standalone
and continuation forms are correct. These are 72 underlying tasks, not 144
independent observations. The legacy and context diagnostics were already known.

| Model / seed | Joint fresh /72 | Standalone /72 | Continuation /72 | Legacy /40 | Other context /56 | Accuracy screen |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Unchanged baseline | 61 | 67 | 62 | 35 | 47 | Reference |
| Replay control 20260905 | 60 | 67 | 61 | 33 | 51 | Fail |
| Targeted learning 20260905 | 71 | 71 | 72 | 36 | 53 | Pass |
| Replay control 20260906 | 62 | 64 | 66 | 35 | 47 | Fail |
| Targeted learning 20260906 | 70 | 71 | 71 | 36 | 55 | Pass |
| Replay control 20260907* | 62 | 67 | 65 | 35 | 50 | Fail |
| Targeted learning 20260907 | 67 | 67 | 72 | 34 | 49 | Fail |

The first two learning candidates beat their matched controls by 11 and eight
joint-correct tasks. Both satisfy every pre-set accuracy check: fresh joint gain,
no per-class regression across all four suites, no additional severe under-route,
no legacy/context aggregate loss, and no failed attempts in either paired model.
Their baseline predictions match between the control and learning comparisons.

The third learning candidate got every fresh continuation correct, but standalone
deep accuracy fell from 14/18 to 13/18 and legacy deep accuracy fell from 7/10 to
6/10. Its failure is visible against its own clean paired baseline. The apparent
gain from 61 to 67 joint-correct tasks does not override those regressions.

*The third control also suffered confirmed macOS idle sleep. Two baseline calls
had elapsed times of approximately 987 and 563 seconds; one timed out. Its timing
is not a normal warm comparison and its baseline predictions do not fully match
the learning pair. The original reports are retained and the comparison is not
credited as clean replication. This does not explain away the separate third
learning candidate's deep-task regression. A second-seed residency preflight
failure happened before held-out inference and was resolved by unloading completed
experimental runners before each unchanged paired screen.

## Repeated local measurements

Both passing candidates retained every screen prediction across all three
repetitions. The same artifact digests, runtime identities, environment, cases,
and source snapshots were verified. Every repeated accuracy check passed; no
invalid output, timeout, or additional severe under-route occurred in these runs.

| Repeated warm measure | Learning 20260905 | Learning 20260906 |
| --- | ---: | ---: |
| Joint correct each repetition; baseline 61/72 | 71/72 | 70/72 |
| Standalone p95, baseline → candidate | 320.6 → 318.0 ms | 310.1 → 310.8 ms |
| Continuation p95, baseline → candidate | 368.6 → 369.7 ms | 370.1 → 369.2 ms |
| Largest p95 increase across four quality suites | 0.70% | 0.21% |
| Sampled peak runner RSS, baseline → candidate | 755.45 → 755.95 MiB | 755.48 → 755.75 MiB |
| Paired memory samples | 276 | 275 |
| Longest interval between memory samples | 2.102 s | 2.092 s |

These were warm measurements on the existing Apple M1 Max, 10-core, 64 GiB Mac
with Ollama 0.32.5. The repeated gains add no model calls, context tokens, or
artifact bytes. RSS includes each matched runner's process tree, excludes the
shared Ollama daemon, may count shared pages more than once, and is not complete
Metal/unified-memory accounting. The largest observed samples are not continuous
memory peaks. Repetitions assess stability and timing on the same tasks, not
independent generalization.

The separate training-fit diagnostic improved from 136/152 to 152/152 and 150/152.
It is excluded from the quality decision. A scoped macOS idle-sleep assertion was
used during repeated measurement and released when the process exited; future
local evaluations now use the same scoped guard automatically.

## Decision and next work

Preserve the current fast router and its four stable capability labels. The
Platform can map those labels to different backends, including an independently
qualified Swarm configuration, without another router architecture change.

The next training question is retaining standalone deep-task discrimination while
learning continuation corrections. Future experiments should predeclare that
focus, keep matched replay controls, and use fresh evaluation tasks. The two
stronger artifacts are research candidates, not evidence that selecting the best
seed satisfies the failed recipe-level gate. Release still requires the existing
independent 600-case minimum and cold, warm, contended, latency and memory checks.

For the learning pipeline, admit reviewed evidence to the right system: memory
failures to Platform memory, execution failures to the mission agent, and verified
capability-class errors to router dataset review. The new correction review gate
does not itself authenticate receipts, retrieve original inputs, or enable a
production training feed. Those integration steps remain necessary.

## Execution and evidence

Six continuations completed in one GPU job with 4,043 billable seconds. The CPU
export completed in 2,447.454 processing seconds. An earlier easy-data job was
stopped before training and recorded 41 billable seconds. Both final jobs are
terminal; no further cloud job was started. Every candidate has the same
529,296,768-byte Q4_K_M size as the original router.

The [experiment design](ROUTER_BOUNDARY_LEARNING_2026_09_05.md) describes the frozen
datasets, source hashes, prompt, artifact checks, and gates. Raw reports, training
and export receipts, model manifests, and memory samples remain under
`output/router-boundary-20260905/`. All generated reports are development evidence;
production selection and release eligibility remain unchanged.

The [compact machine-readable results](ROUTER_BOUNDARY_RESULTS_2026_09_05.json)
include artifact and report digests, every screen gate, repeated measurements, and
terminal job identifiers. The complete local evidence bundle has 112 members and
1,171,085 compressed bytes; it contains no model weights:

- File: `output/router-boundary-20260905/evaluation-evidence-cd34dc0ab9530fd5e27846b7c27e80562284700a642c862243ecb15e53590a63.tar.gz`
- SHA-256: `cd34dc0ab9530fd5e27846b7c27e80562284700a642c862243ecb15e53590a63`

Automatic approval review rejected the optional S3 backup because authorization
to upload the bundle's internal source and metadata was not established. The
bundle remains local; no remote backup is claimed.
