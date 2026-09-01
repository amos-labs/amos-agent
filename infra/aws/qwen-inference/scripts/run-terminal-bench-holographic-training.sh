#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
EXPERIMENT_VERSION="${AMOS_SWARM_EXPERIMENT_VERSION:-v12}"
OUTPUT_ROOT="${1:-/tmp/amos-terminal-bench-holographic-$EXPERIMENT_VERSION}"
RUN_PREFIX="${2:-holographic-$EXPERIMENT_VERSION}"
TRAINING_TASK="${AMOS_HARBOR_TRAINING_TASK:-terminal-bench/production-planning}"
TRAINING_SEEDS="${AMOS_SWARM_TRAINING_SEEDS:-101 202 303}"
HELD_OUT_TASKS="${AMOS_HARBOR_HELD_OUT_TASKS:-}"
QUALITY_BASELINE_PASSED_TESTS="${AMOS_HARBOR_QUALITY_BASELINE_PASSED_TESTS:-11}"
MINIMUM_SUBSTANTIVE_MUTATIONS="${AMOS_SWARM_MINIMUM_SUBSTANTIVE_MUTATIONS:-1}"

[[ "$QUALITY_BASELINE_PASSED_TESTS" =~ ^[0-9]+$ ]] || {
  echo "AMOS_HARBOR_QUALITY_BASELINE_PASSED_TESTS must be a non-negative integer" >&2
  exit 2
}
[[ "$MINIMUM_SUBSTANTIVE_MUTATIONS" =~ ^[0-9]+$ ]] || {
  echo "AMOS_SWARM_MINIMUM_SUBSTANTIVE_MUTATIONS must be a non-negative integer" >&2
  exit 2
}

mkdir -p "$OUTPUT_ROOT"
: > "$OUTPUT_ROOT/run-status.tsv"
RUN_FAILURES=0
TRAINING_EVOLUTIONS=()
TRAINING_TRIAL_RESULTS=()
for seed in $TRAINING_SEEDS; do
  RUN_ID="$RUN_PREFIX-training-$seed"
  if AMOS_HARBOR_TASK_NAME="$TRAINING_TASK" \
    AMOS_SWARM_RESEARCH_SEED="$seed" \
    AMOS_SWARM_COLLECT_EPISODE=1 \
      "$SCRIPT_DIR/run-terminal-bench-holographic-swarm.sh" \
        "$OUTPUT_ROOT/training-$seed" "$RUN_ID"; then
    RUN_STATUS=0
  else
    RUN_STATUS=$?
    RUN_FAILURES=$((RUN_FAILURES + 1))
  fi
  EVOLUTION="$(find "$OUTPUT_ROOT/training-$seed/$RUN_ID" -path '*/artifacts/swarm/candidate-evolution.json' -print -quit)"
  if [[ -n "$EVOLUTION" ]]; then
    TRAINING_EVOLUTIONS+=(--evolution "$EVOLUTION")
    EVOLUTION_STATUS=present
  else
    echo "Training seed $seed omitted candidate evolution" >&2
    RUN_FAILURES=$((RUN_FAILURES + 1))
    EVOLUTION_STATUS=missing
  fi
  TRIAL_RESULT="$(find "$OUTPUT_ROOT/training-$seed/$RUN_ID" \
    -mindepth 2 -maxdepth 2 -name result.json -print -quit)"
  if [[ -n "$TRIAL_RESULT" ]]; then
    TRAINING_TRIAL_RESULTS+=(--trial-result "$TRIAL_RESULT")
    read -r OFFICIAL_REWARD OFFICIAL_PASSED OFFICIAL_TOTAL < <(
      python3 - "$TRIAL_RESULT" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
result = json.loads(path.read_text())
reward = ((result.get("verifier_result") or {}).get("rewards") or {}).get("reward")
ctrf = json.loads((path.parent / "verifier" / "ctrf.json").read_text())
summary = (ctrf.get("results") or {}).get("summary") or {}
print(reward, summary.get("passed"), summary.get("tests"))
PY
    )
  else
    echo "Training seed $seed omitted the official trial result" >&2
    RUN_FAILURES=$((RUN_FAILURES + 1))
    OFFICIAL_REWARD=missing
    OFFICIAL_PASSED=missing
    OFFICIAL_TOTAL=missing
  fi
  printf 'training\t%s\t%s\t%s\t%s\t%s\t%s/%s\n' \
    "$seed" "$RUN_ID" "$RUN_STATUS" "$EVOLUTION_STATUS" \
    "$OFFICIAL_REWARD" "$OFFICIAL_PASSED" "$OFFICIAL_TOTAL" \
    >> "$OUTPUT_ROOT/run-status.tsv"
done

cd "$REPO_DIR"
if python3 scripts/qualifySwarmCandidateEvolution.py \
    --fixture benchmarks/swarm-candidate-counterfactual-v8-v9.json \
    "${TRAINING_EVOLUTIONS[@]}" \
    --partition training \
    --minimum-seeds 3 \
    --minimum-substantive-mutations "$MINIMUM_SUBSTANTIVE_MUTATIONS" \
    --output "$OUTPUT_ROOT/training-qualification.json" \
    > "$OUTPUT_ROOT/training-qualification.stdout.json"; then
  TRAINING_QUALIFICATION_STATUS=0
else
  TRAINING_QUALIFICATION_STATUS=$?
  RUN_FAILURES=$((RUN_FAILURES + 1))
fi
printf 'qualification\ttraining\ttraining-qualification\t%s\t%s\n' \
  "$TRAINING_QUALIFICATION_STATUS" "$(( ${#TRAINING_EVOLUTIONS[@]} / 2 ))" \
  >> "$OUTPUT_ROOT/run-status.tsv"

if python3 scripts/qualifyHarborOfficialQuality.py \
    "${TRAINING_TRIAL_RESULTS[@]}" \
    --baseline-passed-tests "$QUALITY_BASELINE_PASSED_TESTS" \
    --minimum-seeds 3 \
    --output "$OUTPUT_ROOT/official-quality.json" \
    > "$OUTPUT_ROOT/official-quality.stdout.json"; then
  OFFICIAL_QUALITY_STATUS=0
else
  OFFICIAL_QUALITY_STATUS=$?
  RUN_FAILURES=$((RUN_FAILURES + 1))
fi
printf 'quality\ttraining\tofficial-quality\t%s\tbaseline=%s\n' \
  "$OFFICIAL_QUALITY_STATUS" "$QUALITY_BASELINE_PASSED_TESTS" \
  >> "$OUTPUT_ROOT/run-status.tsv"

if [[ -n "$HELD_OUT_TASKS" ]]; then
  HELD_OUT_EVOLUTIONS=()
  index=0
  while IFS= read -r task; do
    task="${task#${task%%[![:space:]]*}}"
    task="${task%${task##*[![:space:]]}}"
    [[ -n "$task" ]] || continue
    index=$((index + 1))
    RUN_ID="$RUN_PREFIX-held-out-$index"
    if AMOS_HARBOR_TASK_NAME="$task" \
      AMOS_SWARM_RESEARCH_SEED="$((900 + index))" \
      AMOS_SWARM_COLLECT_EPISODE=0 \
        "$SCRIPT_DIR/run-terminal-bench-holographic-swarm.sh" \
          "$OUTPUT_ROOT/held-out-$index" "$RUN_ID"; then
      RUN_STATUS=0
    else
      RUN_STATUS=$?
      RUN_FAILURES=$((RUN_FAILURES + 1))
    fi
    EVOLUTION="$(find "$OUTPUT_ROOT/held-out-$index/$RUN_ID" -path '*/artifacts/swarm/candidate-evolution.json' -print -quit)"
    if [[ -n "$EVOLUTION" ]]; then
      HELD_OUT_EVOLUTIONS+=(--evolution "$EVOLUTION")
      EVOLUTION_STATUS=present
    else
      echo "Held-out task $task omitted candidate evolution" >&2
      RUN_FAILURES=$((RUN_FAILURES + 1))
      EVOLUTION_STATUS=missing
    fi
    printf 'held-out\t%s\t%s\t%s\t%s\n' \
      "$task" "$RUN_ID" "$RUN_STATUS" "$EVOLUTION_STATUS" \
      >> "$OUTPUT_ROOT/run-status.tsv"
  done < <(printf '%s' "$HELD_OUT_TASKS" | tr ',' '\n')
  if python3 scripts/qualifySwarmCandidateEvolution.py \
      "${HELD_OUT_EVOLUTIONS[@]}" \
      --partition held-out \
      --minimum-seeds "$index" \
      --minimum-substantive-mutations "$MINIMUM_SUBSTANTIVE_MUTATIONS" \
      --output "$OUTPUT_ROOT/held-out-qualification.json" \
      > "$OUTPUT_ROOT/held-out-qualification.stdout.json"; then
    HELD_OUT_QUALIFICATION_STATUS=0
  else
    HELD_OUT_QUALIFICATION_STATUS=$?
    RUN_FAILURES=$((RUN_FAILURES + 1))
  fi
  printf 'qualification\theld-out\theld-out-qualification\t%s\t%s\n' \
    "$HELD_OUT_QUALIFICATION_STATUS" "$(( ${#HELD_OUT_EVOLUTIONS[@]} / 2 ))" \
    >> "$OUTPUT_ROOT/run-status.tsv"
fi

if (( RUN_FAILURES > 0 )); then
  echo "Holographic training collected every requested run with $RUN_FAILURES failure(s)." >&2
  exit 1
fi
