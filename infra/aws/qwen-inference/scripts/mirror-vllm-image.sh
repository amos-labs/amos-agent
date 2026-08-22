#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REGION="${AWS_REGION:-$(terraform -chdir="$TF_DIR" output -raw aws_region)}"
REPOSITORY_URL="$(terraform -chdir="$TF_DIR" output -raw vllm_repository_url)"
SOURCE_IMAGE="${VLLM_SOURCE_IMAGE:-docker.io/vllm/vllm-openai:v0.27.1}"
TARGET_TAG="v0.27.1"
REGISTRY="${REPOSITORY_URL%%/*}"

command -v aws >/dev/null
command -v docker >/dev/null

aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$REGISTRY"
docker pull --platform linux/amd64 "$SOURCE_IMAGE"
docker tag "$SOURCE_IMAGE" "$REPOSITORY_URL:$TARGET_TAG"
docker push "$REPOSITORY_URL:$TARGET_TAG"

DIGEST="$(aws ecr describe-images \
  --region "$REGION" \
  --repository-name "${REPOSITORY_URL#*/}" \
  --image-ids "imageTag=$TARGET_TAG" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"

if [[ ! "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "ECR returned an invalid image digest: $DIGEST" >&2
  exit 1
fi

echo "vllm_image_uri = \"$REPOSITORY_URL@$DIGEST\""
echo "runtime binary digest for the research manifest: ${DIGEST#sha256:}"
