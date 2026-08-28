#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
INSTANCE_ID="$(terraform -chdir="$TF_DIR" output -raw instance_id)"
ASSOCIATION_ID="$(terraform -chdir="$TF_DIR" output -raw swarm_gateway_association_id)"
PORT="$(terraform -chdir="$TF_DIR" console <<< 'var.swarm_gateway_port' | tr -d '[:space:]')"

aws ssm wait association-executed \
  --region "$REGION" \
  --association-id "$ASSOCIATION_ID"

ASSOCIATION_STATUS="$(aws ssm describe-association \
  --region "$REGION" \
  --association-id "$ASSOCIATION_ID" \
  --query 'AssociationDescription.Overview.Status' \
  --output text)"
[[ "$ASSOCIATION_STATUS" == "Success" ]] || {
  echo "Swarm gateway association is not successful: $ASSOCIATION_STATUS" >&2
  exit 1
}

COMMAND_ID="$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "Verify AMOS Swarm Mission gateway without touching vLLM" \
  --parameters "commands=[\"systemctl is-active --quiet amos-qwen.service\",\"systemctl is-active --quiet amos-swarm-gateway.service\",\"curl --silent --fail http://127.0.0.1:$PORT/health\"]" \
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
  --query '{Status:Status,Health:StandardOutputContent,Error:StandardErrorContent}' \
  --output json
