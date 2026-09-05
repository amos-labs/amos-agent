#!/usr/bin/env node
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { reviewRouterCorrection, routerCorrectionDigest } from "../src/research/routerCorrectionReview.js";

const [inputPath, outputPath, ...extra] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/reviewRouterCorrections.js input.json output.json [--store existing-store --organism-root checkout]");
const options = {};
for (let i = 0; i < extra.length; i += 2) {
  if (!["--store", "--organism-root"].includes(extra[i]) || !extra[i+1] || extra[i+1].startsWith("--") || options[extra[i]]) throw new Error("Invalid store options");
  options[extra[i]] = resolve(extra[i+1]);
}
if (Boolean(options["--store"]) !== Boolean(options["--organism-root"])) throw new Error("--store and --organism-root are required together");
if ((await stat(resolve(inputPath))).size > 8 * 1024 * 1024) throw new Error("Correction review input exceeds 8 MiB");
const bytes = await readFile(resolve(inputPath));
if (bytes.length > 8 * 1024 * 1024) throw new Error("Correction review input exceeds 8 MiB");
const input = JSON.parse(bytes);
if (!Array.isArray(input) || input.length > 500) throw new Error("Expected at most 500 {observation,adjudication} entries");
const reviews = input.map(reviewRouterCorrection);
const unique = new Map();
for (const review of reviews) {
  const key = `${review.observationSha256}:${review.requestId}`;
  if (unique.has(key) && unique.get(key).digest !== review.digest) throw new Error("Conflicting adjudications for one observation/request");
  unique.set(key, review);
}
const body = { schema: "amos.router-correction-review-batch", version: 1, reviews: [...unique.values()].sort((a,b)=>a.observationSha256.localeCompare(b.observationSha256)||a.requestId.localeCompare(b.requestId)), inferenceCalls: 0, trainingJobs: 0, promotionAllowed: false };
const serialized = JSON.stringify({ ...body, digest: routerCorrectionDigest(body) }, null, 2) + "\n";
// Identical retries are safe; changed evidence cannot overwrite an old review.
try { await writeFile(resolve(outputPath), serialized, { flag: "wx", mode: 0o600 }); }
catch (error) { if (error.code !== "EEXIST" || await readFile(resolve(outputPath), "utf8") !== serialized) throw error; }
let blobDigest = null;
if (options["--store"]) {
  for (const directory of ["blobs", "objects", "episodes"]) {
    if (!(await stat(join(options["--store"], directory))).isDirectory()) throw new Error("Select an existing Swarm learning store");
  }
  const { openSwarmLearningStore } = await import(pathToFileURL(join(options["--organism-root"], "swarm/src/swarmLearningStore.js")));
  const store = await openSwarmLearningStore(options["--store"]);
  blobDigest = await store.putBlob(serialized);
}
console.log(JSON.stringify({ reviewed: unique.size, eligibleForPolicyDatasetReview: body.reviews.filter(r=>r.eligibleForPolicyDatasetReview).length, trainingRecordsCreated: 0, episodesCreated: 0, blobDigest, output: resolve(outputPath) }));
