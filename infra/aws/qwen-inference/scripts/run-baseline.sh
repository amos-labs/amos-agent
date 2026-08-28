#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$TF_DIR/../../.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
SECRET_ID="$(terraform -chdir="$TF_DIR" output -raw api_key_secret_id)"
IMAGE_URI="$({
  terraform -chdir="$TF_DIR" console <<< 'var.vllm_image_uri'
} | grep -E '^".+@sha256:[a-f0-9]{64}"$' | tail -n 1 | tr -d '"')"
REPORT="${1:-/tmp/amos-qwen-aws-baseline.json}"

IMAGE_DIGEST="${IMAGE_URI##*@sha256:}"
MODEL_MANIFEST="$({
  terraform -chdir="$TF_DIR" console <<< 'var.model_manifest_sha256'
} | grep -E '^"[a-f0-9]{64}"$' | tail -n 1 | tr -d '"')"
export AMOS_LOCAL_BENCHMARK_API_KEY
AMOS_LOCAL_BENCHMARK_API_KEY="$(aws secretsmanager get-secret-value \
  --region "$REGION" \
  --secret-id "$SECRET_ID" \
  --query SecretString \
  --output text | python3 -c 'import json,sys; print(json.load(sys.stdin)["api_key"])')"

cd "$REPO_DIR"
npm run research:qwen-baseline -- \
  --runtime vllm \
  --runtime-binary-sha256 "$IMAGE_DIGEST" \
  --model-manifest-sha256 "$MODEL_MANIFEST" \
  --url http://127.0.0.1:18080 \
  --reasoning-effort low \
  --repetitions 3 \
  --suite all \
  --output "$REPORT"
