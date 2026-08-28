#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
INSTANCE_ID="$(terraform -chdir="$TF_DIR" output -raw instance_id)"

COMMAND_ID="$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "Disable AMOS Swarm Mission canary without touching vLLM" \
  --parameters 'commands=["systemctl disable --now amos-swarm-gateway.service || true","docker rm -f amos-swarm-gateway 2>/dev/null || true","rm -f /etc/amos/swarm-gateway.env"]' \
  --query 'Command.CommandId' \
  --output text)"

aws ssm wait command-executed \
  --region "$REGION" \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID"
aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query '{Status:Status,StatusDetails:StatusDetails}' \
  --output json
