import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import {
  OLLAMA_RUNTIME_RELEASE,
  ollamaRuntimeAsset
} from "../src/desktop/ollamaRuntimeManifest.js";

const root = resolve(import.meta.dirname, "..");
const destination = join(root, "desktop", "vendor", "ollama");
const asset = ollamaRuntimeAsset();
const archivePath = join(
  tmpdir(),
  `amos-ollama-${OLLAMA_RUNTIME_RELEASE.version}-${basename(asset.archive)}`
);

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

if (!(await matchesDigest(archivePath, asset.sha256))) {
  await download(asset.url, archivePath);
}
await verifyDigest(archivePath, asset.sha256);
await extract(archivePath, destination);

const binaryPath = join(destination, asset.binary);
const binary = await stat(binaryPath).catch(() => null);
if (!binary?.isFile() || binary.size === 0) {
  throw new Error(`Prepared runtime is missing ${asset.binary}`);
}
if (process.platform !== "win32") await chmod(binaryPath, 0o755);

await copyFile(
  join(root, "third_party", "ollama-LICENSE.txt"),
  join(destination, "LICENSE-ollama.txt")
);
await writeFile(
  join(destination, "amos-runtime.json"),
  `${JSON.stringify({
    runtime: "ollama",
    version: OLLAMA_RUNTIME_RELEASE.version,
    source: OLLAMA_RUNTIME_RELEASE.source,
    archive: asset.archive,
    sha256: asset.sha256,
    platform: asset.platform,
    arch: asset.arch
  }, null, 2)}\n`
);

console.log(`Prepared AMOS Local runtime ${OLLAMA_RUNTIME_RELEASE.version} at ${destination}`);

async function download(url, filePath) {
  console.log(`Downloading verified AMOS Local runtime from ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Runtime download failed with HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(filePath));
}

async function matchesDigest(filePath, expected) {
  try {
    return await digest(filePath) === expected;
  } catch {
    return false;
  }
}

async function verifyDigest(filePath, expected) {
  const actual = await digest(filePath);
  if (actual !== expected) {
    await rm(filePath, { force: true });
    throw new Error(`Runtime checksum mismatch: expected ${expected}, got ${actual}`);
  }
}

async function digest(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function extract(filePath, outputPath) {
  if (asset.archive.endsWith(".tgz")) {
    await command("tar", ["-xzf", filePath, "-C", outputPath]);
    return;
  }
  if (asset.archive.endsWith(".zip")) {
    if (process.platform === "win32") {
      const script = [
        "Expand-Archive",
        "-LiteralPath",
        quotePowerShell(filePath),
        "-DestinationPath",
        quotePowerShell(outputPath),
        "-Force"
      ].join(" ");
      await command("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
      return;
    }
    await command("unzip", ["-q", filePath, "-d", outputPath]);
    return;
  }
  throw new Error(`Unsupported runtime archive: ${asset.archive}`);
}

function command(executable, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, args, { stdio: "inherit", windowsHide: true });
    child.once("error", rejectCommand);
    child.once("exit", (code) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`${executable} exited with code ${code}`));
    });
  });
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
