#!/usr/bin/env bash
set -euo pipefail

JOB_ROOT="${1:?job root is required}"
JOB_ID="${2:?job id is required}"
AP_CURRICULUM="${3:?AP curriculum path is required}"
ITERATIONS="${AMOS_RECURSIVE_ITERATIONS:-2}"
[[ "$ITERATIONS" =~ ^[1-4]$ ]] || { echo "AMOS_RECURSIVE_ITERATIONS must be from 1 to 4" >&2; exit 1; }

mkdir -p "$JOB_ROOT"
node scripts/benchmarkDualChannelHolographicWorld.js \
  --out "$JOB_ROOT/hrr-dual-channel.json" \
  > "$JOB_ROOT/hrr-dual-channel.stdout.json"

POLICY_PATH="${AMOS_ORGANISM_POLICY_PATH:-$PWD/benchmarks/swarm-organism-ap-stage1-policy-v1.json}"
POLICY_DIGEST="${AMOS_ORGANISM_POLICY_DIGEST:-4c1421c83dfc2562334c4944278f30543f2b38cfc40f0dd1c82f5948c1f24131}"

for iteration in $(seq 1 "$ITERATIONS"); do
  ITERATION_ROOT="$JOB_ROOT/iteration-$iteration"
  mkdir -p "$ITERATION_ROOT"
  export AMOS_ORGANISM_POLICY_PATH="$POLICY_PATH"
  export AMOS_ORGANISM_POLICY_DIGEST="$POLICY_DIGEST"

  set +e
  ./infra/aws/qwen-inference/scripts/run-terminal-bench-holographic-swarm.sh \
    "$ITERATION_ROOT/harbor" "$JOB_ID-iteration-$iteration"
  HARBOR_STATUS=$?
  set -e
  printf '%s\n' "$HARBOR_STATUS" > "$ITERATION_ROOT/harbor-exit-status.txt"

  # A failed real mission is valuable negative experience. Collection happens
  # inside the Harbor wrapper, so policy search continues if the immutable
  # learning store contains enough rights-cleared records.
  node scripts/simulateSwarmOrganismTraining.js \
    --store "$AMOS_SWARM_REPLAY_DIR" \
    --output "$ITERATION_ROOT/organism-simulation.json" \
    --scenarios "$AP_CURRICULUM" \
    --scenario-partition training \
    --scenario-limit 24 \
    --rollouts 25000 \
    --candidates 96 \
    --elites 12 \
    --generations 5 \
    > "$ITERATION_ROOT/organism-simulation.stdout.json"
  node scripts/createSwarmOrganismPromotionQueue.js \
    --simulation "$ITERATION_ROOT/organism-simulation.json" \
    --output "$ITERATION_ROOT/organism-promotion-queue.json"
  node scripts/replaySwarmOrganismArtifacts.js \
    --queue "$ITERATION_ROOT/organism-promotion-queue.json" \
    --store "$AMOS_SWARM_REPLAY_DIR" \
    --limit 16 \
    --output "$ITERATION_ROOT/organism-artifact-replay-queue.json" \
    > "$ITERATION_ROOT/organism-artifact-replay.stdout.json"
  node scripts/selectRecursiveOrganismPolicy.js \
    --queue "$ITERATION_ROOT/organism-artifact-replay-queue.json" \
    --cycle-id "$JOB_ID-iteration-$iteration" \
    --output "$ITERATION_ROOT/research-policy.json" \
    > "$ITERATION_ROOT/research-policy.stdout.json"

  POLICY_PATH="$ITERATION_ROOT/research-policy.json"
  POLICY_DIGEST="$(node --input-type=module - "$POLICY_PATH" <<'NODE'
import { readFile } from "node:fs/promises";
const policy = JSON.parse(await readFile(process.argv[2], "utf8"));
process.stdout.write(policy.policyDigest);
NODE
)"
done

node scripts/summarizeRecursiveOrganismCycle.js \
  --root "$JOB_ROOT" \
  --store "$AMOS_SWARM_REPLAY_DIR" \
  --output "$JOB_ROOT/recursive-cycle-report.json" \
  > "$JOB_ROOT/recursive-cycle-report.stdout.json"
