#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$TF_DIR/../../.." && pwd)"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region 2>/dev/null || printf 'us-east-1')"
REPOSITORY_URL="$(terraform -chdir="$TF_DIR" output -raw trainer_repository_url)"
REGISTRY="${REPOSITORY_URL%%/*}"
SOURCE_REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SOURCE_DIRTY="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=all)"
if [[ -n "$SOURCE_DIRTY" ]]; then
  SOURCE_STATE="dirty"
else
  SOURCE_STATE="clean"
fi
TAG="stage0-${SOURCE_REVISION:0:12}-$(date -u +%Y%m%d%H%M%S)"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"
docker buildx build \
  --platform linux/amd64 \
  --provenance=true \
  --sbom=true \
  --label "org.opencontainers.image.revision=$SOURCE_REVISION" \
  --label "org.opencontainers.image.source-state=$SOURCE_STATE" \
  --file "$TF_DIR/trainer/Dockerfile" \
  --tag "$REPOSITORY_URL:$TAG" \
  --push \
  "$REPO_ROOT"

DIGEST="$(aws ecr describe-images \
  --region "$REGION" \
  --repository-name "${REPOSITORY_URL#*/}" \
  --image-ids "imageTag=$TAG" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"
printf '%s@%s\n' "$REPOSITORY_URL" "$DIGEST"
