#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  canonicalizeSignedText,
  signedTextSha256
} from "../src/model/signedText.js";
import { downloadRouterArtifactToFile } from "./routerArtifactDownload.js";

const root = resolve(import.meta.dirname, "..");
const manifestPath = join(root, "src", "model", "intelligence-router-artifact-v1.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const promptPath = join(dirname(manifestPath), manifest.prompt);
const prompt = canonicalizeSignedText(await readFile(promptPath, "utf8"));
const defaultSource = resolve(
  root,
  "..",
  "amos-platform",
  "model_program",
  "router",
  "artifacts",
  "export-pilot003",
  manifest.gguf
);
const configuredSource = String(process.env.AMOS_ROUTER_GGUF_SOURCE || "").trim();
const source = resolve(configuredSource || defaultSource);
const sourceUrl = String(process.env.AMOS_ROUTER_GGUF_URL || "").trim();
const destination = join(root, "desktop", "vendor", "router");
const destinationGguf = join(destination, manifest.gguf);

assertManifest(manifest);
await verifyTextFile(promptPath, manifest.prompt_sha256);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const sourceStats = await stat(source).catch(() => null);
let sourceDescription;
if (sourceStats?.isFile()) {
  await verifySizeAndDigest(source, manifest);
  await copyFile(source, destinationGguf);
  sourceDescription = source;
} else if (sourceUrl) {
  await downloadRouterArtifactToFile(sourceUrl, destinationGguf, manifest);
  sourceDescription = "the configured HTTPS artifact source";
} else {
  throw new Error(
    `Router GGUF was not found at ${source}. Set AMOS_ROUTER_GGUF_SOURCE or AMOS_ROUTER_GGUF_URL.`
  );
}
await verifySizeAndDigest(destinationGguf, manifest);
await writeFile(
  join(destination, "Modelfile"),
  [
    `FROM ./${basename(destinationGguf)}`,
    "PARAMETER temperature 0",
    "PARAMETER num_ctx 4096",
    'SYSTEM """',
    prompt.trim(),
    '"""',
    ""
  ].join("\n")
);
await writeFile(
  join(destination, "manifest.json"),
  `${JSON.stringify({ ...manifest, prepared_at: new Date().toISOString() }, null, 2)}\n`
);

console.log(`Prepared ${manifest.model} from ${sourceDescription} at ${destination}`);

function assertManifest(value) {
  if (
    value?.schema !== "amos.intelligence-router-artifact" ||
    value?.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(value.gguf_sha256 || "") ||
    !/^[a-f0-9]{64}$/.test(value.prompt_sha256 || "") ||
    !Number.isSafeInteger(value.gguf_size_bytes) ||
    value.gguf_size_bytes <= 0
  ) {
    throw new Error("Unsupported or invalid router artifact manifest");
  }
}

async function verifyFile(filePath, expected) {
  const actual = await digest(filePath);
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
}

async function verifyTextFile(filePath, expected) {
  const actual = signedTextSha256(await readFile(filePath, "utf8"));
  if (actual !== expected) {
    throw new Error(
      `Canonical SHA-256 mismatch for ${filePath}: expected ${expected}, got ${actual}`
    );
  }
}

async function verifySizeAndDigest(filePath, value) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size !== value.gguf_size_bytes) {
    throw new Error(
      `Router GGUF size mismatch: expected ${value.gguf_size_bytes}, got ${fileStats.size}`
    );
  }
  await verifyFile(filePath, value.gguf_sha256);
}

async function digest(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
