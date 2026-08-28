#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
INSTANCE_ID="$(terraform -chdir="$TF_DIR" output -raw instance_id)"

test -n "$INSTANCE_ID"
exec aws ssm start-session \
  --region "$REGION" \
  --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters portNumber=8000,localPortNumber=18080
