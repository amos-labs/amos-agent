#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$TF_DIR/../../.." && pwd)"
ORGANISM_DIR="${AMOS_ORGANISM_DIR:-$(cd "$REPO_DIR/../amos-organism" && pwd)}"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region 2>/dev/null || printf 'us-east-1')"
REPOSITORY="$(terraform -chdir="$TF_DIR" output -raw runner_repository_url)"

REVISION="$(git -C "$REPO_DIR" rev-parse HEAD)"
SOURCE_DIGEST="$(cd "$REPO_DIR" && node --input-type=module - <<'NODE'
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { relative } from "node:path";
const roots = [
  "package.json",
  "package-lock.json",
  "benchmarks",
  "scripts",
  "src",
  "infra/aws/qwen-inference/scripts",
  "infra/aws/qwen-research-plane/runner",
  "infra/aws/qwen-research-plane/scripts/build-runner-image.sh"
];
const ignored = /(^|\/)(__pycache__|\.terraform)(\/|$)|\.pyc$|\.tfstate($|\.)|\.tfvars$/;
const files = [];
async function walk(path) {
  const info = await stat(path);
  if (info.isFile()) return files.push(path);
  for (const entry of await readdir(path)) await walk(`${path}/${entry}`);
}
for (const root of roots) await walk(root);
const hash = createHash("sha256");
for (const path of files.filter((value) => !ignored.test(value)).sort()) {
  hash.update(relative(".", path));
  hash.update("\0");
  hash.update(await readFile(path));
  hash.update("\0");
}
process.stdout.write(hash.digest("hex"));
NODE
)"
ORGANISM_DIGEST="$(node --input-type=module - "$ORGANISM_DIR" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
const root = resolve(process.argv[2]);
const roots = ["package.json", "package-lock.json", "src", "scripts"];
const files = [];
async function walk(path) {
  const info = await stat(path);
  if (info.isFile()) return files.push(path);
  for (const entry of await readdir(path)) await walk(`${path}/${entry}`);
}
for (const path of roots) await walk(`${root}/${path}`);
const hash = createHash("sha256");
for (const path of files.sort()) {
  hash.update(relative(root, path));
  hash.update("\0");
  hash.update(await readFile(path));
  hash.update("\0");
}
process.stdout.write(hash.digest("hex"));
NODE
)"
SOURCE_DIGEST="$(printf '%s\0%s' "$SOURCE_DIGEST" "$ORGANISM_DIGEST" | sha256sum | cut -d' ' -f1)"
TAG="source-${SOURCE_DIGEST}"
REGISTRY="${REPOSITORY%%/*}"

aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$REGISTRY"
docker build \
  --platform linux/amd64 \
  --provenance=false \
  --build-context "amos-organism=$ORGANISM_DIR" \
  --build-arg "AMOS_SOURCE_REVISION=$REVISION" \
  --build-arg "AMOS_SOURCE_DIGEST=$SOURCE_DIGEST" \
  --label "org.opencontainers.image.revision=$REVISION" \
  --label "com.amoslabs.source.digest=$SOURCE_DIGEST" \
  --tag "$REPOSITORY:$TAG" \
  --file "$TF_DIR/runner/Dockerfile" \
  "$REPO_DIR"
docker push "$REPOSITORY:$TAG"

DIGEST="$(aws ecr describe-images \
  --region "$REGION" \
  --repository-name "${REPOSITORY#*/}" \
  --image-ids "imageTag=$TAG" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"
printf '%s@%s\n' "$REPOSITORY" "$DIGEST"
