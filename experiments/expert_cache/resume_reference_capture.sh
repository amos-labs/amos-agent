#!/usr/bin/env bash
set -Eeuo pipefail

: "${AMOS_RUN_ID:?AMOS_RUN_ID is required}"
: "${AMOS_RESULT_BUCKET:?AMOS_RESULT_BUCKET is required}"
: "${AMOS_RESULT_PREFIX:=runs/${AMOS_RUN_ID}}"
: "${AWS_REGION:=us-east-1}"
: "${AMOS_GIT_COMMIT:?AMOS_GIT_COMMIT is required}"
: "${AMOS_HOLD_AFTER_RUN:=1}"

export HF_HOME=/opt/amos-expert-cache/huggingface
export PYTHONUNBUFFERED=1

ROOT=/opt/amos-expert-cache
RESULTS="${ROOT}/results"
LOG="${RESULTS}/resume-runner.log"
S3_URI="s3://${AMOS_RESULT_BUCKET}/${AMOS_RESULT_PREFIX}/"
mkdir -p "${RESULTS}" "${HF_HOME}"
rm -f "${RESULTS}/run-status.json"
exec > >(tee -a "${LOG}") 2>&1

telemetry_pid=""

upload_results() {
  aws s3 sync "${RESULTS}/" "${S3_URI}" --only-show-errors || true
}

finish() {
  status=$?
  trap - EXIT
  if [[ -n "${telemetry_pid}" ]]; then
    kill "${telemetry_pid}" 2>/dev/null || true
  fi
  python3 - "${RESULTS}/run-status.json" "${status}" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

Path(sys.argv[1]).write_text(
    json.dumps(
        {
            "schema": "amos.expert-cache-reference-run",
            "version": 1,
            "exit_status": int(sys.argv[2]),
            "complete": int(sys.argv[2]) == 0,
            "resumed": True,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
PY
  upload_results
  if [[ "${AMOS_HOLD_AFTER_RUN}" != "1" ]]; then
    shutdown -h now || true
  fi
  exit "${status}"
}
trap finish EXIT

cd "${ROOT}/repo"
actual_commit=$(git rev-parse HEAD)
if [[ "${actual_commit}" != "${AMOS_GIT_COMMIT}" ]]; then
  echo "Worker checkout ${actual_commit} does not match ${AMOS_GIT_COMMIT}" >&2
  exit 1
fi
printf '%s\n' "${actual_commit}" | tee "${RESULTS}/git-commit.txt"

source "${ROOT}/venv/bin/activate"
python -m pip freeze > "${RESULTS}/python-freeze.txt"
nvidia-smi > "${RESULTS}/nvidia-smi-resume-start.txt"
nvidia-smi \
  --query-gpu=timestamp,name,uuid,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw \
  --format=csv -l 10 > "${RESULTS}/nvidia-smi-resume.csv" &
telemetry_pid=$!

python experiments/expert_cache/inspect_gpt_oss_checkpoint.py \
  --cache-dir "${HF_HOME}" \
  --output "${RESULTS}/checkpoint-inspection.json"
upload_results

expert_bytes=$(jq -r '.expert_bytes_per_layer_expert' "${RESULTS}/checkpoint-inspection.json")
weight_bytes=$(jq -r '.total_tensor_bytes' "${RESULTS}/checkpoint-inspection.json")
shared_bytes=$(jq -r '.shared_weight_bytes' "${RESULTS}/checkpoint-inspection.json")

capture() {
  name=$1
  input=$2
  mode=$3
  samples=$4
  output="${RESULTS}/${name}.trace.jsonl"
  rm -f "${output}" "${output}.partial" "${output}.summary.json"
  args=(
    experiments/expert_cache/capture_gpt_oss_trace.py
    --input "${input}"
    --output "${output}"
    --expert-bytes "${expert_bytes}"
    --weight-store-bytes "${weight_bytes}"
    --shared-resident-bytes "${shared_bytes}"
    --max-new-tokens 128
    --queue-size 65536
    --capture-mode "${mode}"
    --samples-per-case "${samples}"
    --acknowledge-safe-input
  )
  if [[ "${mode}" == "sampled" ]]; then
    args+=(--temperature 0.7 --top-p 0.95 --seed 42)
  fi
  python "${args[@]}"
  upload_results
}

capture \
  "gpt-oss-120b.training.greedy" \
  experiments/expert_cache/reference-prompts.training.jsonl \
  greedy \
  1
capture \
  "gpt-oss-120b.evaluation.greedy" \
  experiments/expert_cache/reference-prompts.evaluation.jsonl \
  greedy \
  1
capture \
  "gpt-oss-120b.evaluation.sampled" \
  experiments/expert_cache/reference-prompts.evaluation.jsonl \
  sampled \
  2

nvidia-smi > "${RESULTS}/nvidia-smi-resume-finish.txt"
echo "Resumed reference capture completed"
