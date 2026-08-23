#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$TF_DIR/../../.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
SECRET_ID="$(terraform -chdir="$TF_DIR" output -raw api_key_secret_id)"
REPORT_DIR="${1:-/tmp/amos-qwen-swarm-v0}"
REPETITIONS="${2:-3}"
MISSIONS_PATH="${3:-}"
CONFIG_PATH="${4:-}"
CONTROL="${5:-both}"
MISSION_ID="${6:-}"

if ! [[ "$REPETITIONS" =~ ^[1-9][0-9]*$ ]] || (( REPETITIONS > 20 )); then
  echo "Repetitions must be an integer between 1 and 20" >&2
  exit 2
fi
if [[ "$CONTROL" != "both" && "$CONTROL" != "qwen-direct" && "$CONTROL" != "qwen-swarm" ]]; then
  echo "Control must be both, qwen-direct, or qwen-swarm" >&2
  exit 2
fi

mkdir -p "$REPORT_DIR"
cd "$REPO_DIR"

EXTRA_ARGS=()
if [[ -n "$MISSIONS_PATH" ]]; then
  EXTRA_ARGS+=(--missions "$MISSIONS_PATH")
fi
if [[ -n "$CONFIG_PATH" ]]; then
  EXTRA_ARGS+=(--config "$CONFIG_PATH")
fi
if [[ -n "$MISSION_ID" ]]; then
  EXTRA_ARGS+=(--mission-id "$MISSION_ID")
fi

export AMOS_LOCAL_BENCHMARK_API_KEY
AMOS_LOCAL_BENCHMARK_API_KEY="$(python3 -c \
  'import boto3,json,sys; print(json.loads(boto3.client("secretsmanager", region_name=sys.argv[1]).get_secret_value(SecretId=sys.argv[2])["SecretString"])["api_key"])' \
  "$REGION" "$SECRET_ID")"

if [[ "$CONTROL" == "both" || "$CONTROL" == "qwen-direct" ]]; then
  npm run research:swarm -- \
    --control qwen-direct \
    --repetitions "$REPETITIONS" \
    --output "$REPORT_DIR/qwen-direct.json" \
    "${EXTRA_ARGS[@]}"
fi
if [[ "$CONTROL" == "both" || "$CONTROL" == "qwen-swarm" ]]; then
  npm run research:swarm -- \
    --control qwen-swarm \
    --repetitions "$REPETITIONS" \
    --output "$REPORT_DIR/qwen-swarm.json" \
    "${EXTRA_ARGS[@]}"
fi

echo "Direct report: $REPORT_DIR/qwen-direct.json"
echo "Swarm report: $REPORT_DIR/qwen-swarm.json"
