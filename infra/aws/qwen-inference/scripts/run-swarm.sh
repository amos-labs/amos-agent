#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$TF_DIR/../../.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
SECRET_ID="$(terraform -chdir="$TF_DIR" output -raw api_key_secret_id)"
REPORT_DIR="${1:-/tmp/amos-qwen-swarm-v0}"
REPETITIONS="${2:-3}"

if ! [[ "$REPETITIONS" =~ ^[1-9][0-9]*$ ]] || (( REPETITIONS > 20 )); then
  echo "Repetitions must be an integer between 1 and 20" >&2
  exit 2
fi

mkdir -p "$REPORT_DIR"
cd "$REPO_DIR"

export AMOS_LOCAL_BENCHMARK_API_KEY
AMOS_LOCAL_BENCHMARK_API_KEY="$(aws secretsmanager get-secret-value \
  --region "$REGION" \
  --secret-id "$SECRET_ID" \
  --query SecretString \
  --output text | python3 -c 'import json,sys; print(json.load(sys.stdin)["api_key"])')"

npm run research:swarm -- \
  --control qwen-direct \
  --repetitions "$REPETITIONS" \
  --output "$REPORT_DIR/qwen-direct.json"
npm run research:swarm -- \
  --control qwen-swarm \
  --repetitions "$REPETITIONS" \
  --output "$REPORT_DIR/qwen-swarm.json"

echo "Direct report: $REPORT_DIR/qwen-direct.json"
echo "Swarm report: $REPORT_DIR/qwen-swarm.json"
