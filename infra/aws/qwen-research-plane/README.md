# AMOS Qwen cloud research plane

This module removes the laptop from the execution path. A no-ingress CPU runner
receives allowlisted jobs from SQS, calls the private Qwen endpoint inside the
VPC, runs Harbor through the Docker socket, records status in DynamoDB, and
persists jobs plus immutable learning episodes to encrypted, versioned S3.
Harbor's package metadata is persisted on the runner volume and task plus
verifier images are prewarmed with bounded retries before model work. This
keeps a transient public package-mirror failure from discarding an otherwise
completed reasoning run.

The inference cell and research plane have separate Terraform state. The
runner has outbound internet only so it can retrieve public benchmark task
images; it exposes no inbound ports and is managed through SSM. The Qwen API is
reachable only from the runner security group on port 8000 and still requires
the existing bearer secret.

## Safe rollout

1. Apply the foundation with `runner_enabled = false`.
2. Merge and tag the exact source revision.
3. Build and push the immutable runner image with
   `scripts/build-runner-image.sh`.
4. After the current laptop-run benchmark completes, change vLLM from loopback
   to private-VPC binding and apply the inference replacement.
5. Pin the printed runner image digest, set `runner_enabled = true`, plan, and
   apply.
6. Submit an `adapter-data-preflight`, `adapter-stage0-curriculum`,
   `amos-owned-organism-rollouts`, `organism-simulation`, or uniquely named
   `organism-qwen-phase-probes`, `terminal-bench-holographic-swarm`,
   `terminal-bench-holographic-training`, or `organism-recursive-cycle` job through
   `scripts/submit-job.sh`.

`terminal-bench-holographic-training` is the v11 organism-learning gate. It
runs three independent, seeded Qwen swarm attempts against the development
task, preserves every isolated candidate and incumbent transition, and then
qualifies the resulting evolution chains against the historical v8/v9
counterfactual. Optional held-out task IDs may be supplied through
`AMOS_HARBOR_HELD_OUT_TASKS`; held-out attempts never enter the learning replay
store. Independent official-checker failures and partial scores enter the
next exact-task run as typed, non-authoritative repair memory; they never grant
completion credit. Cross-run candidate selection prioritizes that external
quality evidence ahead of the organism's own self-checks. Structural evolution
and task quality are reported by separate gates:
`training-qualification.json` proves only that the organism emitted continuous,
monotonic candidate history, while `official-quality.json` reads the unchanged
Harbor verifier artifacts. The quality gate requires every seed to preserve the
configured official-test baseline and at least one seed to improve it; partial
CTRF progress never grants task completion. The job fails unless both gates
pass, the official verifier runs, and frontier escalation remains disabled.

`organism-recursive-cycle` is the bounded autonomous learning lane. One job
runs the frozen dual-channel HRR safety/utility experiment, executes a real
development Terminal-Bench mission, stores a sanitized failure capsule,
recalibrates and searches the organism policy, enforces immutable artifact
replay, and then uses the research-only candidate in a second real mission.
The final comparison and all live HRR telemetry are persisted to S3. Failed
missions remain useful negative experience, but neither the recursive job nor
the HRR semantic channel may promote a production policy, grant authority, or
change model weights.

`organism-qwen-phase-probes` is the first real-model promotion boundary after
artifact replay. It runs paired, matched-budget baseline and learned-policy
attempts over eight AMOS-owned recovery missions. Partial organism credit is
minted only from candidate-independent host-verifier receipts. Every fresh
logical specialist receives the same read-only holographic world projection
plus the exact mission evidence; this development-visible gate cannot promote
itself or substitute for the later full mission and frozen holdout gates.

`amos-owned-organism-rollouts` runs the pre-registered AMOS-owned development
curriculum against the private Qwen Swarm endpoint. Candidate-independent
concept verifiers create positive and negative ecology episodes for policy
learning. These easy development missions start the learning loop; they are
permanently excluded from evaluation and cannot support a frontier claim.
Pass a mission ID as the third argument to `scripts/submit-job.sh` to resume one
unfinished mission without replaying completed mission actions. AMOS-owned
rollouts use the quality-first budget profile in
`benchmarks/swarm-organism-owned-experiment-v1.json`; budget ceilings remain
recorded in every run receipt and are not evidence of correctness.

`organism-simulation` runs 100,000 seeded ecology rollouts and an eight-
generation, 256-candidate constrained cross-entropy search entirely on the CPU
runner. It reads immutable calibration episodes plus the private, variant-split
Accounts Payable curriculum from S3, performs paired training and disjoint-
validation comparisons, then replays host-owned recovery invariants against
immutable episodes. The first stage may optimize only the four credit-assignment
parameters named in the pinned training contract; the remaining policy stays
fixed. It makes no model calls and cannot promote a policy; the artifact-qualified
queue must still pass real-Qwen phase probes, frozen holdout, and canary
verification.

The trainer registry is provisioned now, but no paid training GPU is created.
An adapter job remains data-gated by the immutable dataset manifest and will be
added as a separate one-shot GPU lane; it will never train inside the live
inference instance.

`adapter-stage0-curriculum` creates 128 AMOS-owned, deterministically verified
contract examples across eight mission families. Its family-disjoint 64/16/48
train/validation/holdout split is qualified only for the QLoRA pipeline and
lineage proof. It is explicitly insufficient for quality training or production
promotion; the full adapter preflight remains gated at 200/50/50 examples.
