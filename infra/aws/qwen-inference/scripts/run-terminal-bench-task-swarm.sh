#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$TF_DIR/../../.." && pwd)"
REGION="${AMOS_AWS_REGION:-$(terraform -chdir="$TF_DIR" output -raw aws_region)}"
SECRET_ID="${AMOS_QWEN_SECRET_ID:-$(terraform -chdir="$TF_DIR" output -raw api_key_secret_id)}"
SERVED_MODEL="${AMOS_QWEN_SERVED_MODEL:-$(terraform -chdir="$TF_DIR" output -raw served_model_name)}"
API_BASE="${AMOS_QWEN_API_BASE:-http://127.0.0.1:18080/v1}"
OUTPUT_DIR="${1:-/tmp/amos-terminal-bench-qwen-task-swarm}"
JOB_NAME="${2:-production-planning-qwen-task-swarm}"

export OPENAI_API_KEY
OPENAI_API_KEY="$(python3 -c \
  'import boto3,json,sys; print(json.loads(boto3.client("secretsmanager", region_name=sys.argv[1]).get_secret_value(SecretId=sys.argv[2])["SecretString"])["api_key"])' \
  "$REGION" "$SECRET_ID")"
export PYTHONPATH="$REPO_DIR${PYTHONPATH:+:$PYTHONPATH}"

python3 -c '
import json
import os
import sys
import urllib.request

api_key = os.environ["OPENAI_API_KEY"]
request = urllib.request.Request(
    f"{sys.argv[2].rstrip('/')}/models",
    headers={"Authorization": f"Bearer {api_key}"},
)
with urllib.request.urlopen(request, timeout=10) as response:
    payload = json.load(response)
model_ids = {item.get("id") for item in payload.get("data", [])}
if sys.argv[1] not in model_ids:
    raise SystemExit(f"Private inference endpoint did not advertise {sys.argv[1]}")
' "$SERVED_MODEL" "$API_BASE"

cd "$REPO_DIR"
exec harbor run \
  --dataset terminal-bench/terminal-bench@3.0.0 \
  --include-task-name terminal-bench/production-planning \
  --n-tasks 1 \
  --agent benchmarks.harbor_agents.amos_task_swarm:AmosTaskSwarm \
  --model "openai/$SERVED_MODEL" \
  --agent-kwarg "api_base=$API_BASE" \
  --agent-kwarg parser_name=json \
  --agent-kwarg reasoning_effort=medium \
  --agent-kwarg temperature=0.2 \
  --agent-kwarg 'model_info={"max_input_tokens":32768,"max_output_tokens":4096,"input_cost_per_token":0,"output_cost_per_token":0}' \
  --n-concurrent 1 \
  --jobs-dir "$OUTPUT_DIR" \
  --job-name "$JOB_NAME" \
  --agent-timeout-multiplier 2 \
  --yes
