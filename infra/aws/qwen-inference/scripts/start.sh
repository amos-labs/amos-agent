#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
INSTANCE_ID="$(terraform -chdir="$TF_DIR" output -raw instance_id)"

test -n "$INSTANCE_ID"
aws ec2 start-instances --region "$REGION" --instance-ids "$INSTANCE_ID" >/dev/null
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
echo "$INSTANCE_ID is running. Allow model startup to complete before opening the tunnel."
