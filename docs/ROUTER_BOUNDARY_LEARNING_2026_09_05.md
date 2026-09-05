# Router boundary learning, September 5, 2026

This experiment tests whether targeted supervision improves the existing local
Qwen3.5 0.8B router after the context-retention fix. The production artifact,
prompt, four capability labels, 4,096-token context, 24-token JSON output and
disabled thinking remain the baseline. All training and review run offline.

## Evidence must identify the right learning target

The new `reviewRouterCorrection` function consumes an existing router observation
and a separate adjudication. It directs the diagnosis to the responsible system:

| Cause | Learning or repair target |
| --- | --- |
| Missing or stale company evidence | Platform context and memory |
| Wrong tool or incorrect execution/recovery | Mission agent, including Swarm |
| Provider failure or timeout | Runtime |
| Incorrect backend assignment to a capability label | Platform model mapping |
| Incorrect capability classification under the written policy | Local router |
| Unknown | Independent review |

A proposed router correction must reference the exact observed input, prompt,
artifact, served backend and Platform call. Its execution snapshot pins the tool and model
catalogs, memory snapshot, budget, execution policy and mission-runtime revision.
It also requires an independently checked task outcome, a reviewed policy label,
and explicit router-training rights. A successful terminal status, valid planner
JSON, matching shadow text, and citation IDs that merely resolve are insufficient.

This is a review gate, not an attestation service. Digests bind references but do
not authenticate the verifier, retrieve the original task, or grant data access.
Even a complete review yields `eligibleForPolicyDatasetReview`, never a training
record or an automatic promotion. The existing governed store and learning
schedule remain the place for admitted evidence; no second daemon is introduced.

Run a bounded batch of `{observation, adjudication}` entries with:

```sh
node scripts/reviewRouterCorrections.js input.json output.json
# Store the same immutable review in the existing Swarm store:
node scripts/reviewRouterCorrections.js input.json output.json \
  --store /path/to/existing-swarm-store --organism-root /path/to/amos-organism
```

The batch rejects conflicting adjudications and writes an immutable, metadata-only
output; identical retries are idempotent. The optional store path uses Swarm's
existing `putBlob` API and creates no episodes or training records.
Future production admission still needs evidence authentication and an
authorized replayable input; hashes alone cannot reconstruct a task.

Validation: 38 targeted router, correction-review and evaluator tests pass.
A fixture integration against the actual Swarm store API also confirms that
two reviews produce one policy-dataset review candidate, identical retries
deduplicate, changed reviews cannot overwrite the original, and stored bytes
round-trip unchanged. No episodes, training records or inference calls are
created. The fixture requires an observed served backend. Evidence is saved in
`output/router-boundary-20260905/review-validation-v2/validation.json`.

## Experiment design

The new tasks are AMOS-owned synthetic policy supervision, not verified customer
outcomes. They were authored against the unchanged router prompt, then classified
independently by the existing Bedrock Sonnet judge without showing expected labels.
Disagreements are excluded before router evaluation and each split is balanced
downward. The remaining tasks cover distinct training and evaluation domains.
The old replay corpus predates this split, so domain separation is asserted only
for the new corpus; exact task overlap with replay is rejected.

Each training task appears alone and after neutral assistant progress, rendered
by the actual production context compiler. These are two representations of one
task, not independent observations. No teacher, procedure lookup or additional
model call runs in the live router.

| Item | Frozen value |
| --- | --- |
| Original replay | 200 records, 50 per class |
| New training tasks | 76, 19 per class |
| New training representations | 152: standalone and continuation |
| Learning dataset | 352 records, 88 per class |
| Fresh evaluation | 72 tasks, 18 per class; standalone and continuation measured separately |
| Additional diagnostics | Previously observed 40-case regression and 56 remaining context cases after removing the overlapping regression IDs |
| Seeds | 20260905, 20260906, 20260907 |
| Arms | Original replay only; replay plus new supervision |
| Parent | Existing pilot003 adapter, checksum pinned |
| Optimizer budget | 20 steps per run, fresh optimizer, learning rate 0.00005 |
| Memory settings | Gradient checkpointing enabled in both arms |
| Verified-outcome oversampling | None |
| Local measurement | Q4_K_M on the existing Mac/Ollama runtime; paired order, one-pass accuracy screening, then three repetitions for passing candidates |

The 96-case context diagnostic includes some legacy regression cases. Suites and
context variants must not be summed as independent tasks. Repetitions measure
stability and latency, not additional accuracy evidence. These development sets
do not meet or replace the existing 600-case independent qualification floor.

The continuation comparison must beat the unchanged parent and its matched
replay-only control. Per-class accuracy, severe under-routing, invalid output,
latency, and local memory evidence matter alongside total accuracy. The current
router stays selected unless independent qualification supports replacement.

## Screening before training

The first, more explicit task batch was too easy: the baseline passed 79/80 new
training tasks. Its six-run job was stopped while downloading inputs, before
the training entrypoint ran. The terminal receipt records 41 billable seconds.
That recipe and its artifacts are preserved in
`output/router-boundary-20260905-easy-v1/`; they are not credited as trained models.

The revised batch uses less explicit task descriptions, multilingual examples,
and conversation context. The baseline passed 136/152 training representations.
Its 16 mistakes cover 14 distinct tasks: nine deep-to-balanced, two
balanced-to-routine, and five routine-to-balanced predictions. Twelve mistakes
occurred in continuation context. This is training-data screening, not held-out
improvement. The launcher now requires at least eight distinct tasks with observed
baseline mistakes before spending on a sweep.

The GPU allocation runs six independent continuations sequentially under a
two-hour cap and a $6 compute planning ceiling. Conversion uses a separate bounded
CPU job. It reads cloud-trained artifacts and an existing cloud reference, then
publishes verified lossless patches for download. Local model weights are never
uploaded. Experimental model names cannot overwrite the selected production name.

Artifacts, source snapshots, case checksums, receipts, and results are under
`output/router-boundary-20260905/`. The scripts live in
`research/router-boundary-20260905/` and require explicit execution for paid work.

These are experiment-specific research scripts and use the existing Platform
training program and prior artifact directories. By default they locate the
`amos-agent` and `amos-managed-platform` checkouts under the common workspace,
including when this branch lives in `.worktrees`. Override locations with
`AMOS_WORKSPACE_ROOT`, `AMOS_PLATFORM_ROOT`, `AMOS_NODE_BINARY`,
`AMOS_OLLAMA_BINARY`, or `AMOS_ROUTER_CONTEXT_CASES` as needed. Local inference
is restricted to the existing `127.0.0.1:11435` endpoint.

`python3 research/router-boundary-20260905/finish.py` prints its actions without
executing them. `--execute` finishes the recorded job, submits the prepared CPU
export once, verifies each artifact, registers only experimental names and runs
the frozen paired screens. It does not start another training job or select a
production model. Partial prior screens require inspection rather than overwrite.

After all six screens finish, `python3
research/router-boundary-20260905/measure_runtime.py --execute` runs the frozen
three-repetition evaluator sequentially for each passing candidate. It samples
the actual Ollama runner process tree every two seconds, matching each runner to
the verified GGUF digest. These are sampled resident-memory observations, not
Node memory or artifact size. They exclude the shared Ollama daemon and do not
represent total Metal/unified-memory use. Repeated warm measurements still do not
replace independent cold, warm and contended qualification.
On macOS the orchestration uses `caffeinate` to prevent idle system sleep only
while local measurement runs; it releases the assertion afterward and changes no
persistent setting. It does not keep the Mac awake while waiting for cloud work.
The finisher unloads completed experimental runners before each pair so the
previous candidate cannot occupy the baseline's runtime slot. The baseline and
unrelated local models are never selected for this cleanup.
Run `node research/router-boundary-20260905/summarize_repeated.mjs` afterward to
validate repeated reports and their raw memory evidence and save the summary.

### Execution status

The six-run training job `amos-router-boundary-20260905-140240` completed
successfully with 4,043 billable seconds. CPU export job
`amos-router-boundary-export-20260905-151417` completed in 2,447.454 processing
seconds, within its 3,600-second cap. All six artifacts passed reconstruction and
registration checks and all six paired screens finished. Two learning candidates
passed the accuracy criteria; none of the replay-only controls passed. The third
learning seed regressed on deep classification and the legacy regression set, so
the recipe fails the required three-seed consistency check.

The third control was interrupted by confirmed macOS idle sleep and contains one
baseline timeout and two very large baseline elapsed times. Its timing is not
usable as a normal warm measurement, and its baseline predictions do not fully
match the corresponding learning pair. Original evidence is retained. The third
learning candidate also fails against its own clean paired baseline, independently
of that interruption. A separate second-seed preflight residency failure occurred
before held-out inference; completed experimental runners are now unloaded before
each pair and that unchanged evaluation resumed successfully.

Repeated warm measurements completed for both passing candidates. All repeated
accuracy checks passed, predictions were stable, p95 increases stayed below 0.71%
across the measured suites, and sampled peak runner RSS increased by less than
0.07%. The three-seed recipe gate still fails. See the
[complete results](ROUTER_BOUNDARY_RESULTS_2026_09_05.md). The selected router is
unchanged. The restart
checkpoint is `output/router-boundary-20260905/workflow-status.json`; both cloud
jobs are terminal and must not be relaunched.

## Swarm as the mission agent and frontier service

Mission execution and capability classification are separate decisions. Swarm
can supply mission-agent intelligence at several capability levels: planning,
delegation, memory use, and proposed tool, verification and recovery steps.
The existing `SWARM_PLATFORM_MISSIONS.md` boundary keeps actual execution,
authority and checker truth in the Platform; Swarm returns a canonical plan.
The Platform can map
`frontier` to a qualified Swarm configuration without changing the router's labels
or checkpoint. Using Swarm as a mission runtime does not itself establish that its
owned model has frontier-level reasoning.

Compare complete missions against the current alternative with the same company
evidence, tools, authority and bounded budget. Measure verified completion,
first-attempt success, recovery correctness, unauthorized/duplicate effects,
wall-clock time and total inference cost. Judge final evidence independently;
agreement between agents and valid planner output are not proof of success.

The current Swarm evidence demonstrates gains on synthetic AMOS conventions and
memory tasks. Broader frontier replacement requires hard mission evaluations,
sealed holdouts, and production shadow evidence. Keep fallback available through
the Platform while each Swarm configuration earns its assigned capability tier.

The saved first autonomous Swarm cycle was also audited from its existing S3
reports and store. All 189 verifier judgments replayed correctly, and all 59
expected training harvest episodes were present with valid digests and verifier
references: 50 first-answer examples and nine recovered-answer pairs. This was
one base-model cycle, with no candidate comparison or promotion. The old progress
counter reported three candidate advances for three completed standing orders;
the separate Swarm change corrects that count to zero without rewriting the
immutable records. See [Swarm learning evidence PR #12](https://github.com/amos-labs/amos-organism/pull/12).
