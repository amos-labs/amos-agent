#!/usr/bin/env bash
set -euo pipefail

required=(
  AMOS_AWS_REGION
  AMOS_QWEN_API_BASE
  AMOS_QWEN_SECRET_ID
  AMOS_QWEN_SERVED_MODEL
  AMOS_RESEARCH_ARTIFACT_BUCKET
  AMOS_RESEARCH_JOB_QUEUE_URL
  AMOS_RESEARCH_RUN_TABLE
  AMOS_SWARM_REPLAY_DIR
)
for name in "${required[@]}"; do
  test -n "${!name:-}" || { echo "Missing required environment variable: $name"; exit 1; }
done

# Harbor launches task and verifier containers through the host Docker daemon.
# Any bind-mounted job path therefore must have the same absolute name inside
# this runner container and on the host. Otherwise the verifier can write a
# reward successfully while Harbor looks for it in a different namespace.
AMOS_RESEARCH_WORK_ROOT="${AMOS_RESEARCH_WORK_ROOT:-/work}"
if [[ "$AMOS_RESEARCH_WORK_ROOT" != /* ]]; then
  echo "AMOS_RESEARCH_WORK_ROOT must be an absolute path"
  exit 1
fi
JOBS_ROOT="$AMOS_RESEARCH_WORK_ROOT/jobs"
MESSAGES_ROOT="$AMOS_RESEARCH_WORK_ROOT/messages"

write_status() {
  local run_id="$1"
  local kind="$2"
  local status="$3"
  local started_at="$4"
  local finished_at="$5"
  local item_path="$MESSAGES_ROOT/status.json"
  node --input-type=module - "$item_path" "$run_id" "$kind" "$status" "$started_at" "$finished_at" <<'NODE'
import { writeFile } from "node:fs/promises";
const [path, runId, kind, status, startedAt, finishedAt] = process.argv.slice(2);
const item = {
  run_id: { S: runId },
  kind: { S: kind },
  status: { S: status },
  started_at: { S: startedAt }
};
if (finishedAt) item.finished_at = { S: finishedAt };
await writeFile(path, `${JSON.stringify(item)}\n`, { mode: 0o600 });
NODE
  aws dynamodb put-item \
    --region "$AMOS_AWS_REGION" \
    --table-name "$AMOS_RESEARCH_RUN_TABLE" \
    --item "file://$item_path"
}

mkdir -p "$JOBS_ROOT" "$AMOS_SWARM_REPLAY_DIR" "$MESSAGES_ROOT"

while true; do
  MESSAGE_PATH="$MESSAGES_ROOT/received.json"
  aws sqs receive-message \
    --region "$AMOS_AWS_REGION" \
    --queue-url "$AMOS_RESEARCH_JOB_QUEUE_URL" \
    --max-number-of-messages 1 \
    --wait-time-seconds 20 \
    --visibility-timeout 43200 \
    --output json > "$MESSAGE_PATH"

  readarray -t fields < <(node --input-type=module - "$MESSAGE_PATH" <<'NODE'
import { readFile } from "node:fs/promises";
const source = await readFile(process.argv[2], "utf8");
if (!source.trim()) process.exit(0);
const envelope = JSON.parse(source);
const message = envelope.Messages?.[0];
if (!message) process.exit(0);
const job = JSON.parse(message.Body);
if (job.schema !== "amos.cloud-research-job" || job.version !== 1) {
  throw new Error("Unsupported cloud research job envelope");
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(job.id)) {
  throw new Error("Unsupported cloud research job id");
}
if (!["terminal-bench-holographic-swarm", "terminal-bench-holographic-training", "amos-owned-organism-rollouts", "organism-qwen-phase-probes", "adapter-data-preflight", "adapter-stage0-curriculum", "organism-simulation", "organism-recursive-cycle"].includes(job.kind)) {
  throw new Error("Unsupported cloud research job kind");
}
if (job.mission_id !== undefined) {
  if (job.kind !== "amos-owned-organism-rollouts") {
    throw new Error("Mission slices are supported only for AMOS-owned organism rollouts");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(job.mission_id)) {
    throw new Error("Unsupported cloud research mission id");
  }
}
console.log(message.ReceiptHandle);
console.log(job.id);
console.log(job.kind);
console.log(job.mission_id || "-");
NODE
  )
  if [[ "${#fields[@]}" -eq 0 ]]; then
    continue
  fi

  RECEIPT_HANDLE="${fields[0]}"
  JOB_ID="${fields[1]}"
  JOB_KIND="${fields[2]}"
  JOB_MISSION_ID="${fields[3]}"
  [[ "$JOB_MISSION_ID" == "-" ]] && JOB_MISSION_ID=""
  JOB_ROOT="$JOBS_ROOT/$JOB_ID"
  mkdir -p "$JOB_ROOT"

  EXISTING_STATUS_PATH="$MESSAGES_ROOT/existing-status.json"
  aws dynamodb get-item \
    --region "$AMOS_AWS_REGION" \
    --table-name "$AMOS_RESEARCH_RUN_TABLE" \
    --key "{\"run_id\":{\"S\":\"$JOB_ID\"}}" \
    --consistent-read \
    --output json > "$EXISTING_STATUS_PATH"
  EXISTING_STATUS="$(node --input-type=module - "$EXISTING_STATUS_PATH" <<'NODE'
import { readFile } from "node:fs/promises";
const source = await readFile(process.argv[2], "utf8");
if (!source.trim()) process.exit(0);
const result = JSON.parse(source);
process.stdout.write(result.Item?.status?.S || "");
NODE
)"
  if [[ "$EXISTING_STATUS" == "completed" || "$EXISTING_STATUS" == "failed" ]]; then
    echo "Cloud research job $JOB_ID already reached terminal status $EXISTING_STATUS; deleting duplicate delivery"
    aws sqs delete-message \
      --region "$AMOS_AWS_REGION" \
      --queue-url "$AMOS_RESEARCH_JOB_QUEUE_URL" \
      --receipt-handle "$RECEIPT_HANDLE"
    continue
  fi

  aws s3 sync \
    "s3://$AMOS_RESEARCH_ARTIFACT_BUCKET/replay/" \
    "$AMOS_SWARM_REPLAY_DIR/" \
    --region "$AMOS_AWS_REGION" \
    --only-show-errors || true

  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  write_status "$JOB_ID" "$JOB_KIND" running "$STARTED_AT" ""
  STATUS=0
  case "$JOB_KIND" in
    terminal-bench-holographic-swarm)
      ./infra/aws/qwen-inference/scripts/run-terminal-bench-holographic-swarm.sh \
        "$JOB_ROOT/harbor" "$JOB_ID" || STATUS=$?
      ;;
    terminal-bench-holographic-training)
      ./infra/aws/qwen-inference/scripts/run-terminal-bench-holographic-training.sh \
        "$JOB_ROOT/harbor-v11" "$JOB_ID" || STATUS=$?
      ;;
    amos-owned-organism-rollouts)
      export AMOS_LOCAL_BENCHMARK_API_KEY
      AMOS_LOCAL_BENCHMARK_API_KEY="$(python3 -c \
        'import boto3,json,sys; print(json.loads(boto3.client("secretsmanager", region_name=sys.argv[1]).get_secret_value(SecretId=sys.argv[2])["SecretString"])["api_key"])' \
        "$AMOS_AWS_REGION" "$AMOS_QWEN_SECRET_ID")"
      export AMOS_QWEN_RESEARCH_URL="${AMOS_QWEN_API_BASE%/v1}"
      EXPERIMENT_ARGS=(
        --config benchmarks/swarm-organism-owned-experiment-v1.json
        --missions benchmarks/swarm-organism-owned-missions-v1.json
        --control qwen-swarm
        --repetitions 1
        --allow-remote
        --output "$JOB_ROOT/amos-owned-organism-report.json"
      )
      if [[ -n "$JOB_MISSION_ID" ]]; then
        EXPERIMENT_ARGS+=(--mission-id "$JOB_MISSION_ID")
      fi
      node scripts/runSwarmExperiment.js "${EXPERIMENT_ARGS[@]}" || STATUS=$?
      COLLECTOR_STATUS=0
      if [[ -f "$JOB_ROOT/amos-owned-organism-report.json" ]]; then
        node scripts/collectAmosOwnedSwarmEpisodes.js \
          --report "$JOB_ROOT/amos-owned-organism-report.json" \
          --missions benchmarks/swarm-organism-owned-missions-v1.json \
          --verifiers benchmarks/swarm-organism-owned-verifiers-v1.json \
          --store "$AMOS_SWARM_REPLAY_DIR" \
          > "$JOB_ROOT/amos-owned-organism-collection.json" || COLLECTOR_STATUS=$?
      else
        COLLECTOR_STATUS=1
      fi
      if [[ "$STATUS" -eq 0 && "$COLLECTOR_STATUS" -ne 0 ]]; then
        STATUS="$COLLECTOR_STATUS"
      fi
      unset AMOS_LOCAL_BENCHMARK_API_KEY
      ;;
    organism-qwen-phase-probes)
      export AMOS_LOCAL_BENCHMARK_API_KEY
      AMOS_LOCAL_BENCHMARK_API_KEY="$(python3 -c \
        'import boto3,json,sys; print(json.loads(boto3.client("secretsmanager", region_name=sys.argv[1]).get_secret_value(SecretId=sys.argv[2])["SecretString"])["api_key"])' \
        "$AMOS_AWS_REGION" "$AMOS_QWEN_SECRET_ID")"
      export AMOS_QWEN_RESEARCH_URL="${AMOS_QWEN_API_BASE%/v1}"
      node scripts/runSwarmOrganismQwenPhaseProbes.js \
        --missions benchmarks/swarm-organism-owned-missions-v1.json \
        --verifiers benchmarks/swarm-organism-owned-verifiers-v1.json \
        --policy benchmarks/swarm-organism-ap-stage1-policy-v1.json \
        --output "$JOB_ROOT/organism-qwen-phase-probes.json" \
        > "$JOB_ROOT/organism-qwen-phase-probes.stdout.json" \
        2> "$JOB_ROOT/organism-qwen-phase-probes.stderr.log" || STATUS=$?
      unset AMOS_LOCAL_BENCHMARK_API_KEY
      ;;
    adapter-data-preflight)
      node scripts/exportAmosNativeTrainingDataset.js \
        --store "$AMOS_SWARM_REPLAY_DIR" \
        --output "$JOB_ROOT/dataset" \
        --preflight-only > "$JOB_ROOT/preflight.json" || STATUS=$?
      ;;
    adapter-stage0-curriculum)
      node scripts/generateAmosSyntheticCurriculum.js \
        --store "$AMOS_SWARM_REPLAY_DIR" \
        --examples-per-family 16 > "$JOB_ROOT/curriculum.json" || STATUS=$?
      if [[ "$STATUS" -eq 0 ]]; then
        node scripts/exportAmosNativeTrainingDataset.js \
          --store "$AMOS_SWARM_REPLAY_DIR" \
          --output "$JOB_ROOT/dataset" \
          --stage0 > "$JOB_ROOT/dataset.json" || STATUS=$?
      fi
      ;;
    organism-simulation)
      AP_CURRICULUM="$JOB_ROOT/ap-organism-curriculum-v1.json"
      aws s3 cp \
        "s3://$AMOS_RESEARCH_ARTIFACT_BUCKET/private-datasets/process-mining-data/ap/1.0.0/derived/ap-organism-curriculum-v1.json" \
        "$AP_CURRICULUM" \
        --region "$AMOS_AWS_REGION" \
        --only-show-errors || STATUS=$?
      if [[ "$STATUS" -eq 0 ]]; then
        node scripts/simulateSwarmOrganismTraining.js \
          --store "$AMOS_SWARM_REPLAY_DIR" \
          --output "$JOB_ROOT/organism-simulation.json" \
          --scenarios "$AP_CURRICULUM" \
          --scenario-partition training \
          --scenario-limit 24 \
          --rollouts 100000 \
          --candidates 256 \
          --elites 32 \
          --generations 8 > "$JOB_ROOT/organism-simulation.stdout.json" || STATUS=$?
      fi
      if [[ "$STATUS" -eq 0 ]]; then
        node scripts/createSwarmOrganismPromotionQueue.js \
          --simulation "$JOB_ROOT/organism-simulation.json" \
          --output "$JOB_ROOT/organism-promotion-queue.json" || STATUS=$?
      fi
      if [[ "$STATUS" -eq 0 ]]; then
        node scripts/evaluateSwarmOrganismCandidates.js \
          --simulation "$JOB_ROOT/organism-simulation.json" \
          --scenarios "$AP_CURRICULUM" \
          --store "$AMOS_SWARM_REPLAY_DIR" \
          --partition training \
          --limit 24 \
          --seed 7 \
          --output "$JOB_ROOT/organism-paired-policy-training.json" \
          > "$JOB_ROOT/organism-paired-policy-training.stdout.json" || STATUS=$?
      fi
      if [[ "$STATUS" -eq 0 ]]; then
        node scripts/evaluateSwarmOrganismCandidates.js \
          --simulation "$JOB_ROOT/organism-simulation.json" \
          --scenarios "$AP_CURRICULUM" \
          --store "$AMOS_SWARM_REPLAY_DIR" \
          --partition validation \
          --limit 500 \
          --seed 7 \
          --output "$JOB_ROOT/organism-paired-policy-validation.json" \
          > "$JOB_ROOT/organism-paired-policy-validation.stdout.json" || STATUS=$?
      fi
      if [[ "$STATUS" -eq 0 ]]; then
        node scripts/replaySwarmOrganismArtifacts.js \
          --queue "$JOB_ROOT/organism-promotion-queue.json" \
          --store "$AMOS_SWARM_REPLAY_DIR" \
          --limit 8 \
          --output "$JOB_ROOT/organism-artifact-replay-queue.json" \
          > "$JOB_ROOT/organism-artifact-replay.stdout.json" || STATUS=$?
      fi
      ;;
    organism-recursive-cycle)
      AP_CURRICULUM="$JOB_ROOT/ap-organism-curriculum-v1.json"
      aws s3 cp \
        "s3://$AMOS_RESEARCH_ARTIFACT_BUCKET/private-datasets/process-mining-data/ap/1.0.0/derived/ap-organism-curriculum-v1.json" \
        "$AP_CURRICULUM" \
        --region "$AMOS_AWS_REGION" \
        --only-show-errors || STATUS=$?
      if [[ "$STATUS" -eq 0 ]]; then
        ./infra/aws/qwen-inference/scripts/run-recursive-organism-cycle.sh \
          "$JOB_ROOT" "$JOB_ID" "$AP_CURRICULUM" || STATUS=$?
      fi
      ;;
  esac

  aws s3 sync "$JOB_ROOT/" \
    "s3://$AMOS_RESEARCH_ARTIFACT_BUCKET/runs/$JOB_ID/" \
    --region "$AMOS_AWS_REGION" \
    --only-show-errors || STATUS=$?
  aws s3 sync "$AMOS_SWARM_REPLAY_DIR/" \
    "s3://$AMOS_RESEARCH_ARTIFACT_BUCKET/replay/" \
    --region "$AMOS_AWS_REGION" \
    --only-show-errors || STATUS=$?

  FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$STATUS" -eq 0 ]]; then
    write_status "$JOB_ID" "$JOB_KIND" completed "$STARTED_AT" "$FINISHED_AT"
    aws sqs delete-message \
      --region "$AMOS_AWS_REGION" \
      --queue-url "$AMOS_RESEARCH_JOB_QUEUE_URL" \
      --receipt-handle "$RECEIPT_HANDLE"
  else
    write_status "$JOB_ID" "$JOB_KIND" failed "$STARTED_AT" "$FINISHED_AT"
    echo "Cloud research job $JOB_ID failed with status $STATUS; a new run ID is required for an intentional retry"
  fi
done
