# Router context correction, September 5, 2026

The existing local 0.8B router now retains the latest user request when
classifying conversation history. On separately frozen, constructed continuation
cases, correct policy classifications improved from **4/24 to 20/24**, with no
previously correct cases lost. The historical set remained **35/40**. This code
change is independent of the other local research work. No deployment, training,
model replacement, or cloud inference occurred.

## Change and scope

The previous input builder spent its 4,000-character allowance on the newest
four user/assistant messages. One long assistant response or four assistant
updates could displace the user's request entirely. The router would then
classify progress notes without seeing the task.

The [input builder](../src/model/intelligenceRouter.js) now reserves the latest
nonempty text user message, includes at most three other messages, and limits
each assistant excerpt to 512 characters. It presents background first and the
latest user request last. It retains the 4,000-character content limit and
excludes system and tool content. Single user tasks produce identical bytes.
The system prompt, schema, temperature zero, disabled thinking, 4,096-token
context, and 24-token output limit are unchanged. There is one local inference
call, without retrieval or another model pass.

Desktop normally classifies the initial task and reuses its decision. This fix
addresses paths that classify conversation history. It changes neither when
Desktop reclassifies nor the platform's class-to-model mapping. Short follow-ups
and information beyond excerpt limits remain limitations to investigate.

## Final measurement

The final candidate was frozen before inference on 24 newly authored tasks:
4 routine, 8 balanced, 8 deep, and 4 frontier. Each has an isolated-task control
and a continuation variant with a long assistant response or five assistant
updates. Eight explicit task-change controls reuse selected tasks. The 40
historical regression cases previously informed model selection. These are
24 new underlying tasks, not 96 independent new tasks.

| Check | Previous input | Corrected input |
| --- | ---: | ---: |
| Fresh tasks in isolation | 19/24 | 19/24 |
| Fresh continuation variants | 4/24 | 20/24 |
| Explicit task-change controls | 8/8 | 8/8 |
| Historical regression | 35/40 | 35/40 |
| Continuation errors two or more classes below target | 12/24 | 0/24 |
| Continuation warm median latency | 394 ms | 348 ms |
| Continuation warm p95 latency | 548 ms | 385 ms |
| Historical warm median / p95 latency | 301 / 337 ms | 303 / 342 ms |

Continuation correctness changed from 4/4 to 4/4 routine, 0/8 to 8/8 balanced,
0/8 to 4/8 deep, and 0/4 to 4/4 frontier. Four deep cases still route to balanced:
identity transition, conflicting service metrics, seasonal financial planning,
and expansion strategy. No further adjustment used those failures.

All 768 scored calls returned valid first answers without errors, timeouts,
repairs, or fallbacks. Predictions were identical across four repetitions.
Every case ran baseline-first twice and candidate-first twice; case order also
reversed between passes. Repetitions assess stability and timing, not independent
accuracy coverage. Hardware was an Apple M1 Max with 64 GiB memory, Q4_K_M, and
Ollama 0.32.5. These are warm local diagnostics with shared prompt caching and
background activity, not cold-start, contention, memory, or production latency
qualification.

An earlier candidate reserved the request and bounded excerpts while keeping
chronological order. On a different 24-task set it improved continuation results
from 4/24 to 8/24. That motivated putting the request last. The final candidate
used 24 different tasks frozen before its predictions. Both experiments total
1,344 scored local calls. The earlier harness did not balance which arm ran
first, so its timing is not evidence for the final change. The final harness
fixes that issue; all 96 cases' call order was independently checked.

## Evidence and limits

The coding agent assigned labels from the written routing policy before
prediction. These are **synthetic policy labels, not independently verified
backend outcomes**. The variants deliberately exercise context loss, whose
production frequency is unknown. The 48 new task texts do not match tasks in
the prior 209-record training dataset. No reserved qualification cases were
used. This demonstrates a specific context-handling improvement, not a new
general production accuracy above the historical roughly 90% result.

The [published measurement summary](experiments/router-context-20260905-results.json)
contains per-suite results, paired case changes, acceptance checks, and the hash
of the raw report. Raw evidence remains in the originating workspace under
`output/router-context-20260905-request-last/`: `plan.json`, `cases.json`,
`report.json`, and `validation.json`. The earlier diagnostic remains under
`output/router-context-20260905/`. Those local artifacts are not part of this
commit; they contain the frozen inputs, source hashes, raw responses, and timing
samples.

The installed GGUF was hashed before each experiment and the runtime model
manifest checked before and after inference. The retained model is
`amos-router:0.8b-pilot003-v2`, GGUF SHA-256
`cbe690bd7550f8f8e6597681bde03d72ad783216c1446bef5386ee44a0da9305`.
The prompt and artifact manifest are unchanged. The implemented input builder
matches all 96 frozen candidate payloads byte for byte. The local
`validation.json` record pins the original working-tree implementation and checks.

**116 targeted tests passed in the original working tree**, covering routing,
feedback correlation, evaluation, providers, hybrid routing, and the agent loop.
New regression tests cover request displacement, excerpt limits, current-task
precedence, short follow-up context, non-text messages, and single-task framing.
The standalone publication branch was then based on `origin/main` at `08db9d0`:
**112 routing, provider, hybrid-routing, and agent-loop tests passed**, along
with `npm run check` and `git diff --check`. Its input builder also matched all
96 measured candidate payloads exactly. The model weights and prompt are unchanged.

No examples were admitted to training and no learning gain is claimed. The
separately developed feedback review path remains the route for finding real
failures; that work is outside this context-fix commit. Another outcome-based
update still needs independently verified comparisons under the intended
execution policy, including deep examples. Ordinary completion and these
authored labels do not supply that evidence.
