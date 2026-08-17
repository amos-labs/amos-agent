#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  canonicalizeSignedText,
  signedTextSha256
} from "../src/model/signedText.js";

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
  await downloadVerifiedArtifact(sourceUrl, destinationGguf, manifest);
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

async function downloadVerifiedArtifact(urlValue, destinationPath, value) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:") {
    throw new Error("AMOS_ROUTER_GGUF_URL must use HTTPS");
  }
  // The artifact lives behind a GitHub release-asset URL, which answers the
  // initial request with a 302 to a short-lived signed CDN URL. Handle two
  // failure modes:
  //   - The GitHub asset endpoint 403s unless authenticated, so attach the
  //     Actions GITHUB_TOKEN when the host is GitHub.
  //   - The signed CDN URL must NOT receive the Authorization header (the CDN
  //     rejects an unexpected Bearer token), so resolve the redirect manually
  //     and download the final URL without auth.
  const isGitHub =
    /(^|\.)github\.com$/i.test(url.hostname) ||
    /(^|\.)githubusercontent\.com$/i.test(url.hostname) ||
    /(^|\.)githubassets\.com$/i.test(url.hostname);
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  const authHeaders = isGitHub && token ? { Authorization: `Bearer ${token}` } : {};
  const ua = { "user-agent": "AMOS-Desktop-release-builder/1" };
  const head = await fetch(url, {
    redirect: "manual",
    headers: { ...ua, ...authHeaders },
    signal: AbortSignal.timeout(20 * 60_000)
  });
  const location = head.headers.get("location");
  const isRedirect = head.status >= 300 && head.status < 400 && !!location;
  const finalUrl = isRedirect ? new URL(location, url) : url;
  if (finalUrl.protocol !== "https:") {
    throw new Error("Router artifact download redirected outside HTTPS");
  }
  // A redirect target (signed CDN URL) carries its auth in the query string, so
  // do not forward the bearer token. A direct non-redirect response keeps the
  // auth headers in case the asset endpoint streams the body inline.
  const response = isRedirect
    ? await fetch(finalUrl, { headers: { ...ua }, signal: AbortSignal.timeout(20 * 60_000) })
    : head;
  if (!response.ok || !response.body) {
    throw new Error(`Router artifact download failed with HTTP ${response.status}`);
  }
  const contentLength = response.headers.get("content-length");
  const declaredSize = contentLength == null ? null : Number(contentLength);
  if (Number.isSafeInteger(declaredSize) && declaredSize !== value.gguf_size_bytes) {
    throw new Error(
      `Router artifact download size mismatch: expected ${value.gguf_size_bytes}, got ${declaredSize}`
    );
  }
  const temporary = `${destinationPath}.${process.pid}.download`;
  let bytes = 0;
  const hash = createHash("sha256");
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      async function* verify(sourceStream) {
        for await (const chunk of sourceStream) {
          bytes += chunk.length;
          if (bytes > value.gguf_size_bytes) {
            throw new Error("Router artifact download exceeded its signed size");
          }
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(temporary, { flags: "wx", mode: 0o600 })
    );
    if (bytes !== value.gguf_size_bytes || hash.digest("hex") !== value.gguf_sha256) {
      throw new Error("Router artifact download failed signed size or SHA-256 verification");
    }
    await rename(temporary, destinationPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function digest(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
