#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
SECRET_ID="$(terraform -chdir="$TF_DIR" output -raw api_key_secret_id)"

command -v openssl >/dev/null
API_KEY="$(openssl rand -hex 32)"
aws secretsmanager put-secret-value \
  --region "$REGION" \
  --secret-id "$SECRET_ID" \
  --secret-string "{\"api_key\":\"$API_KEY\"}" >/dev/null
unset API_KEY

echo "Initialized the private vLLM API key in Secrets Manager; no secret entered Terraform state."
