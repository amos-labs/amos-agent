#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KIND="${1:-}"
JOB_ID="${2:-}"
MISSION_ID="${3:-}"

case "$KIND" in
  terminal-bench-holographic-swarm|terminal-bench-holographic-training|amos-owned-organism-rollouts|organism-qwen-phase-probes|adapter-data-preflight|adapter-stage0-curriculum|organism-simulation|organism-recursive-cycle) ;;
  *) echo "Unsupported job kind: $KIND"; exit 1 ;;
esac
[[ "$JOB_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$ ]] || {
  echo "Unsupported job id: $JOB_ID"
  exit 1
}
if [[ -n "$MISSION_ID" ]]; then
  [[ "$KIND" == "amos-owned-organism-rollouts" ]] || {
    echo "Mission slices are supported only for amos-owned-organism-rollouts"
    exit 1
  }
  [[ "$MISSION_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$ ]] || {
    echo "Unsupported mission id: $MISSION_ID"
    exit 1
  }
fi

REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region 2>/dev/null || printf 'us-east-1')"
QUEUE_URL="$(terraform -chdir="$TF_DIR" output -raw job_queue_url)"
BODY="$(node --input-type=module - "$JOB_ID" "$KIND" "$MISSION_ID" <<'NODE'
const [id, kind, missionId] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  schema: "amos.cloud-research-job",
  version: 1,
  id,
  kind,
  ...(missionId ? { mission_id: missionId } : {})
}));
NODE
)"

aws sqs send-message \
  --region "$REGION" \
  --queue-url "$QUEUE_URL" \
  --message-body "$BODY" \
  --output json
