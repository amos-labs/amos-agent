#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLAN_PATH="${1:-/tmp/amos-swarm-canary.tfplan}"
PLAN_JSON="$PLAN_PATH.json"
TFVARS_PATH="${AMOS_QWEN_TFVARS:-$TF_DIR/terraform.tfvars}"

terraform -chdir="$TF_DIR" fmt -check -recursive
terraform -chdir="$TF_DIR" validate
terraform -chdir="$TF_DIR" plan -var-file="$TFVARS_PATH" -out="$PLAN_PATH"
terraform -chdir="$TF_DIR" show -json "$PLAN_PATH" > "$PLAN_JSON"

if jq -e '
  [.resource_changes[]
   | select(.change.actions != ["no-op"])
   | select(.address | test("^(terraform_data\\.validated_inputs|aws_ecr_repository\\.swarm_gateway|aws_ecr_lifecycle_policy\\.swarm_gateway|aws_iam_role_policy\\.inference|aws_security_group_rule\\.platform_swarm_gateway|aws_ssm_document\\.swarm_gateway|aws_ssm_association\\.swarm_gateway)(\\[[0-9]+\\])?$") | not)]
  | length > 0
' "$PLAN_JSON" >/dev/null; then
  echo "Refusing a Swarm canary plan with changes outside the gateway allowlist" >&2
  jq -r '
    [.resource_changes[]
     | select(.change.actions != ["no-op"])
     | select(.address | test("^(terraform_data\\.validated_inputs|aws_ecr_repository\\.swarm_gateway|aws_ecr_lifecycle_policy\\.swarm_gateway|aws_iam_role_policy\\.inference|aws_security_group_rule\\.platform_swarm_gateway|aws_ssm_document\\.swarm_gateway|aws_ssm_association\\.swarm_gateway)(\\[[0-9]+\\])?$") | not)
     | {address, actions: .change.actions}]
  ' "$PLAN_JSON" >&2
  exit 1
fi

jq -r '
  [.resource_changes[]
   | select(.change.actions != ["no-op"])
   | {address, actions: .change.actions}]
' "$PLAN_JSON"
echo "$PLAN_PATH"
