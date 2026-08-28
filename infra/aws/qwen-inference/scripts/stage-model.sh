#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="${AWS_REGION:-$(terraform -chdir="$TF_DIR" output -raw aws_region)}"
BUCKET="$(terraform -chdir="$TF_DIR" output -raw model_bucket)"
PREFIX="$(terraform -chdir="$TF_DIR" output -raw model_key_prefix)"
MODEL="Qwen/Qwen3.8-27B-FP8"
REVISION="017b9c7af6b5689d5dd426a76e0bc077eb5ca20a"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/amos-qwen-model.XXXXXX")"
MODEL_DIR="$STAGING_DIR/files"
MANIFEST="$STAGING_DIR/model-manifest.sha256"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

command -v aws >/dev/null
command -v hf >/dev/null || {
  echo "The Hugging Face 'hf' CLI is required. Install huggingface-hub first." >&2
  exit 1
}

mkdir -p "$MODEL_DIR"
hf download "$MODEL" --revision "$REVISION" --local-dir "$MODEL_DIR"
rm -rf "$MODEL_DIR/.cache"

(
  cd "$MODEL_DIR"
  find . -type f -print | LC_ALL=C sort | while IFS= read -r file; do
    shasum -a 256 "$file"
  done
) > "$MANIFEST"

MANIFEST_DIGEST="$(shasum -a 256 "$MANIFEST" | awk '{print $1}')"

aws s3 sync "$MODEL_DIR/" "s3://$BUCKET/$PREFIX/files/" \
  --region "$REGION" \
  --sse aws:kms \
  --only-show-errors
aws s3 cp "$MANIFEST" "s3://$BUCKET/$PREFIX/model-manifest.sha256" \
  --region "$REGION" \
  --sse aws:kms \
  --only-show-errors

echo "model_manifest_sha256 = \"$MANIFEST_DIGEST\""
echo "staged s3://$BUCKET/$PREFIX at upstream revision $REVISION"
