#!/usr/bin/env node
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prepareBlindComparison } from "../src/research/blindComparison.js";

const args = process.argv.slice(2);
const reportPaths = options("--report");
const saltPath = option("--salt-file");
const bundlePath = option("--bundle");
const mappingPath = option("--mapping");

if (reportPaths.length < 2) fail("At least two --report REPORT.json values are required");
if (!saltPath) fail("--salt-file PATH is required");
if (!bundlePath) fail("--bundle PUBLIC.json is required");
if (!mappingPath) fail("--mapping PRIVATE.json is required");
if (resolve(bundlePath) === resolve(mappingPath)) fail("Public bundle and private mapping paths must differ");

const reports = await Promise.all(reportPaths.map(readJson));
const resolvedSaltPath = resolve(saltPath);
const saltMetadata = await stat(resolvedSaltPath);
if ((saltMetadata.mode & 0o077) !== 0) {
  fail("--salt-file must not be readable or writable by group or other users (use chmod 600)");
}
const salt = await readFile(resolvedSaltPath);
const { bundle, mapping } = prepareBlindComparison({ reports, salt });
await atomicWriteJson(bundlePath, bundle);
await atomicWriteJson(mappingPath, mapping);

console.log(`Public bundle: ${resolve(bundlePath)}`);
console.log(`Private mapping: ${resolve(mappingPath)} (mode 0600; do not give this to the judge)`);
console.log(`Bundle digest: ${bundle.bundleDigest}`);
console.log(`Cases: ${bundle.caseCount} · candidates per case: ${bundle.candidateCount}`);

async function readJson(path) {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${resolve(path)}: ${error.message}`);
  }
}

async function atomicWriteJson(path, value) {
  const destination = resolve(path);
  const temporary = `${destination}.tmp-${process.pid}`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

function options(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${name} requires a value`);
    values.push(value);
  }
  return values;
}

function option(name) {
  const values = options(name);
  if (values.length > 1) fail(`${name} may only be supplied once`);
  return values[0] ?? "";
}

function fail(message) {
  console.error(
    `${message}\n\n` +
    "Usage: node scripts/prepareSwarmBlindComparison.js " +
    "--report DIRECT.json --report SWARM.json [--report FABLE.json] " +
    "--salt-file SECRET.bin --bundle PUBLIC.json --mapping PRIVATE.json"
  );
  process.exit(2);
}
