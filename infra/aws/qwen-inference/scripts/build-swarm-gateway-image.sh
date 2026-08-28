#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$TF_DIR/../../.." && pwd)"
MODE="${1:---load}"

case "$MODE" in
  --load|--push) ;;
  *) echo "Usage: $0 [--load|--push]" >&2; exit 2 ;;
esac

SOURCE_REVISION="$(git -C "$REPO_DIR" rev-parse HEAD)"
SHORT_REVISION="${SOURCE_REVISION:0:12}"
LOCAL_IMAGE="amos-swarm-mission-gateway:$SHORT_REVISION"

if [[ "$MODE" == "--load" ]]; then
  docker buildx build \
    --platform linux/amd64 \
    --file "$TF_DIR/gateway/Dockerfile" \
    --build-arg "AMOS_SOURCE_REVISION=$SOURCE_REVISION" \
    --tag "$LOCAL_IMAGE" \
    --load \
    "$REPO_DIR"
  docker image inspect "$LOCAL_IMAGE" --format '{{json .RepoDigests}}'
  echo "$LOCAL_IMAGE"
  exit 0
fi

REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
REPOSITORY_URL="$(terraform -chdir="$TF_DIR" output -raw swarm_gateway_repository_url)"
REGISTRY="${REPOSITORY_URL%%/*}"
TAG="sha-$SOURCE_REVISION"

aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$REGISTRY"
docker buildx build \
  --platform linux/amd64 \
  --file "$TF_DIR/gateway/Dockerfile" \
  --build-arg "AMOS_SOURCE_REVISION=$SOURCE_REVISION" \
  --tag "$REPOSITORY_URL:$TAG" \
  --push \
  "$REPO_DIR"

DIGEST="$(aws ecr describe-images \
  --region "$REGION" \
  --repository-name "${REPOSITORY_URL#*/}" \
  --image-ids "imageTag=$TAG" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"
[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "ECR returned an invalid gateway digest" >&2
  exit 1
}
echo "$REPOSITORY_URL@$DIGEST"
