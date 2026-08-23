#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$TF_DIR/../../.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
SECRET_ID="$(terraform -chdir="$TF_DIR" output -raw api_key_secret_id)"

export AMOS_LOCAL_BENCHMARK_API_KEY
AMOS_LOCAL_BENCHMARK_API_KEY="$(python3 -c \
  'import boto3,json,sys; print(json.loads(boto3.client("secretsmanager", region_name=sys.argv[1]).get_secret_value(SecretId=sys.argv[2])["SecretString"])["api_key"])' \
  "$REGION" "$SECRET_ID")"

cd "$REPO_DIR"
exec npm run research:swarm:gateway -- \
  --backend-url http://127.0.0.1:18080 \
  "$@"
