#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$TF_DIR/../../.." && pwd)"
REGION="${AMOS_AWS_REGION:-$(terraform -chdir="$TF_DIR" output -raw aws_region)}"
SECRET_ID="${AMOS_QWEN_SECRET_ID:-$(terraform -chdir="$TF_DIR" output -raw api_key_secret_id)}"
SERVED_MODEL="${AMOS_QWEN_SERVED_MODEL:-$(terraform -chdir="$TF_DIR" output -raw served_model_name)}"
API_BASE="${AMOS_QWEN_API_BASE:-http://127.0.0.1:18080/v1}"
OUTPUT_DIR="${1:-/tmp/amos-terminal-bench-qwen-holographic-swarm}"
JOB_NAME="${2:-production-planning-qwen-holographic-swarm}"
TASK_NAME="${AMOS_HARBOR_TASK_NAME:-terminal-bench/production-planning}"
RESEARCH_SEED="${AMOS_SWARM_RESEARCH_SEED:-}"
REPLAY_DIR="${AMOS_SWARM_REPLAY_DIR:-$REPO_DIR/.amos-agent/research/swarm-learning}"
ORGANISM_ROOT="${AMOS_ORGANISM_ROOT:-}"
ORGANISM_POLICY_PATH="${AMOS_ORGANISM_POLICY_PATH:-$REPO_DIR/benchmarks/swarm-organism-ap-stage1-policy-v1.json}"
ORGANISM_POLICY_DIGEST="${AMOS_ORGANISM_POLICY_DIGEST:-4c1421c83dfc2562334c4944278f30543f2b38cfc40f0dd1c82f5948c1f24131}"
HOLOGRAPHIC_WORLD_MODE="${AMOS_HOLOGRAPHIC_WORLD_MODE:-active}"
STRATEGY_GENE_TASK_NAME="${AMOS_STRATEGY_GENE_TASK_NAME:-}"
LEARNING_TASK_NAME="${STRATEGY_GENE_TASK_NAME:-${TASK_NAME##*/}}"
COLLECT_EPISODE="${AMOS_SWARM_COLLECT_EPISODE:-1}"
HARBOR_PREWARM_ATTEMPTS="${AMOS_HARBOR_PREWARM_ATTEMPTS:-3}"
MODEL_PROVENANCE_JSON="$(python3 -c \
  'import json,sys; print(json.dumps({"provider":"amos-private-vllm","model":sys.argv[1],"route":"direct-research","frontierEscalationAllowed":False},separators=(",",":")))' \
  "$SERVED_MODEL")"

export OPENAI_API_KEY
OPENAI_API_KEY="$(python3 -c \
  'import boto3,json,sys; print(json.loads(boto3.client("secretsmanager", region_name=sys.argv[1]).get_secret_value(SecretId=sys.argv[2])["SecretString"])["api_key"])' \
  "$REGION" "$SECRET_ID")"
export PYTHONPATH="$REPO_DIR${PYTHONPATH:+:$PYTHONPATH}"

prewarm_harbor_task_images() {
  local task_slug="${TASK_NAME##*/}"
  local task_cache_root="${AMOS_HARBOR_TASK_CACHE_ROOT:-${HOME}/.cache/harbor/tasks/packages/terminal-bench/$task_slug}"
  local context
  local attempt
  local status
  local tag_suffix
  local -a build_contexts=()

  [[ "$HARBOR_PREWARM_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || {
    echo "AMOS_HARBOR_PREWARM_ATTEMPTS must be a positive integer" >&2
    return 2
  }
  [[ -d "$task_cache_root" ]] || return 0

  while IFS= read -r context; do
    build_contexts+=("$context")
  done < <(find "$task_cache_root" -mindepth 2 -maxdepth 2 -type d \
    \( -name environment -o -name tests \) -print | sort)

  for context in "${build_contexts[@]}"; do
    [[ -f "$context/Dockerfile" ]] || continue
    tag_suffix="$(printf '%s' "$context" | sha256sum | cut -c1-16)"
    status=1
    for ((attempt = 1; attempt <= HARBOR_PREWARM_ATTEMPTS; attempt += 1)); do
      if docker build \
        --tag "amos-harbor-prewarm:${task_slug}-${tag_suffix}" \
        "$context"; then
        status=0
        break
      fi
      echo "Harbor image prewarm failed for $context (attempt $attempt/$HARBOR_PREWARM_ATTEMPTS)" >&2
    done
    if [[ "$status" -ne 0 ]]; then
      echo "Harbor image prewarm exhausted retries for $context" >&2
      return "$status"
    fi
  done
}

python3 -c '
import json
import os
import sys
import urllib.request

api_key = os.environ["OPENAI_API_KEY"]
api_base = sys.argv[2].rstrip("/")
request = urllib.request.Request(
    f"{api_base}/models",
    headers={"Authorization": f"Bearer {api_key}"},
)
with urllib.request.urlopen(request, timeout=10) as response:
    payload = json.load(response)
if sys.argv[1] not in {item.get("id") for item in payload.get("data", [])}:
    raise SystemExit(f"Private inference endpoint did not advertise {sys.argv[1]}")
' "$SERVED_MODEL" "$API_BASE"

cd "$REPO_DIR"
[[ -f "$ORGANISM_POLICY_PATH" ]] || {
  echo "Organism policy does not exist: $ORGANISM_POLICY_PATH" >&2
  exit 1
}
# Harbor builds task and verifier images at different phases. Prewarming both
# cached contexts moves transient registry/package-mirror failures ahead of the
# expensive model run and gives them bounded infrastructure-only retries. The
# official verifier and its score remain untouched.
prewarm_harbor_task_images
set +e
OPTIONAL_AGENT_ARGS=()
if [[ -n "$RESEARCH_SEED" ]]; then
  OPTIONAL_AGENT_ARGS+=(--agent-kwarg "research_seed=$RESEARCH_SEED")
fi
harbor run \
  --dataset terminal-bench/terminal-bench@3.0.0 \
  --include-task-name "$TASK_NAME" \
  --n-tasks 1 \
  --agent benchmarks.harbor_agents.amos_holographic_swarm:AmosHolographicSwarm \
  --model "openai/$SERVED_MODEL" \
  --agent-kwarg "api_base=$API_BASE" \
  --agent-kwarg parser_name=json \
  --agent-kwarg reasoning_effort=medium \
  --agent-kwarg temperature=0.2 \
  --agent-kwarg "organism_policy_path=$ORGANISM_POLICY_PATH" \
  --agent-kwarg "organism_policy_digest=$ORGANISM_POLICY_DIGEST" \
  --agent-kwarg "holographic_world_mode=$HOLOGRAPHIC_WORLD_MODE" \
  --agent-kwarg "model_provenance_json=$MODEL_PROVENANCE_JSON" \
  --agent-kwarg "strategy_gene_store_path=$REPLAY_DIR" \
  --agent-kwarg "strategy_gene_task_name=$LEARNING_TASK_NAME" \
  --agent-kwarg strategy_gene_limit=64 \
  --agent-kwarg "failure_capsule_store_path=$REPLAY_DIR" \
  --agent-kwarg "failure_capsule_task_name=$LEARNING_TASK_NAME" \
  "${OPTIONAL_AGENT_ARGS[@]}" \
  --agent-kwarg interface_scanner_turns=6 \
  --agent-kwarg data_scanner_turns=8 \
  --agent-kwarg state_compiler_turns=8 \
  --agent-kwarg builder_turns=16 \
  --agent-kwarg verifier_turns=12 \
  --agent-kwarg repairer_turns=8 \
  --agent-kwarg executor_turns=8 \
  --agent-kwarg integrator_turns=4 \
  --agent-kwarg max_data_scanner_cycles=1 \
  --agent-kwarg max_state_compiler_cycles=2 \
  --agent-kwarg max_builder_cycles=3 \
  --agent-kwarg adaptive_repair_turns=12 \
  --agent-kwarg malformed_response_retry_reserve=4 \
  --agent-kwarg max_repair_cycles=2 \
  --agent-kwarg 'model_info={"max_input_tokens":32768,"max_output_tokens":4096,"input_cost_per_token":0,"output_cost_per_token":0}' \
  --n-concurrent 1 \
  --max-retries 1 \
  --retry-include RuntimeError \
  --jobs-dir "$OUTPUT_DIR" \
  --job-name "$JOB_NAME" \
  --agent-timeout-multiplier 2 \
  --yes
HARBOR_STATUS=$?
set -e

RESULT_PATH="$OUTPUT_DIR/$JOB_NAME/result.json"
RESULT_STATUS=0
python3 - "$RESULT_PATH" <<'PY' || RESULT_STATUS=$?
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit("Harbor did not write a job result")
result = json.loads(path.read_text())
stats = result.get("stats") or {}
evaluations = (stats.get("evals") or {}).values()
verified_trials = sum(int(item.get("n_trials") or 0) for item in evaluations)
errors = int(stats.get("n_errored_trials") or 0)
if int(result.get("n_total_trials") or 0) < 1:
    raise SystemExit("Harbor scheduled zero trials")
if errors != 0:
    raise SystemExit(f"Harbor reported {errors} errored trial(s)")
if verified_trials < 1:
    raise SystemExit("Harbor produced zero verifier-scored trials")
print(f"Harbor result integrity passed: {verified_trials} verifier-scored trial(s)")
PY
if [[ "$HARBOR_STATUS" -eq 0 && "$RESULT_STATUS" -ne 0 ]]; then
  HARBOR_STATUS="$RESULT_STATUS"
fi

COLLECTOR_STATUS=0
COLLECTION_PATH="$OUTPUT_DIR/$JOB_NAME/organism-collection.json"
if [[ "$COLLECT_EPISODE" == "1" ]]; then
  node scripts/collectHarborSwarmEpisodes.js \
    "$OUTPUT_DIR/$JOB_NAME" \
    --store "$REPLAY_DIR" \
    --run-id "$JOB_NAME" \
    --output "$COLLECTION_PATH" || COLLECTOR_STATUS=$?
fi

ORGANISM_STATUS=0
if [[ "$COLLECT_EPISODE" == "1" && "$COLLECTOR_STATUS" -eq 0 && -n "$ORGANISM_ROOT" ]]; then
  TRACE_BUNDLE_PATH="$OUTPUT_DIR/$JOB_NAME/organism-trace-bundle.json"
  ORGANISM_EVENT_PATH="$REPLAY_DIR/organism/events.jsonl"
  node scripts/exportOrganismTraceBundle.js \
    --collection "$COLLECTION_PATH" \
    --store "$REPLAY_DIR" \
    --run-id "$JOB_NAME" \
    --auto-approve-verified-genes \
    --output "$TRACE_BUNDLE_PATH" || ORGANISM_STATUS=$?
  if [[ "$ORGANISM_STATUS" -eq 0 ]]; then
    node "$ORGANISM_ROOT/scripts/importTraceBundle.ts" \
      "$TRACE_BUNDLE_PATH" "$ORGANISM_EVENT_PATH" || ORGANISM_STATUS=$?
  fi
fi

if [[ "$HARBOR_STATUS" -ne 0 ]]; then
  exit "$HARBOR_STATUS"
fi
if [[ "$COLLECTOR_STATUS" -ne 0 ]]; then
  exit "$COLLECTOR_STATUS"
fi
exit "$ORGANISM_STATUS"
