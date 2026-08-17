#!/usr/bin/env node
"use strict";

// Ensures the @napi-rs/canvas native bindings for every desktop target are
// present in node_modules before electron-builder packs the app.
//
// Why this exists: @napi-rs/canvas loads its binding from a per-platform
// optional dependency (@napi-rs/canvas-<platform>-<arch>). `npm ci` on a macOS
// arm64 runner installs ONLY canvas-darwin-arm64 and skips the rest, so the
// x64 (and Windows) builds previously shipped with no matching binding and
// crashed on launch with "Cannot find native binding". This script installs
// the darwin x64/arm64 and win32 x64 bindings (no save, no scripts) so each
// installer can carry the binding its users actually need.

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CANVAS_RANGE = (() => {
  try {
    const pkg = require(path.join(ROOT, "package.json"));
    const range = pkg.dependencies?.["@napi-rs/canvas"] || "latest";
    return range.replace(/^[^0-9]*/, "") || "latest";
  } catch {
    return "latest";
  }
})();

const BINDINGS = [
  "@napi-rs/canvas-darwin-arm64",
  "@napi-rs/canvas-darwin-x64",
  "@napi-rs/canvas-win32-x64-msvc"
];

function spec(name) {
  return `${name}@${CANVAS_RANGE}`;
}

// Resolve the npm CLI entrypoint so we can invoke it with the current Node
// binary. Spawning "npm" directly fails on Windows runners, where npm is
// npm.cmd and not a directly-spawnable executable (spawnSync returns
// status:null alongside an ENOENT-style error). Running `node <npm-cli.js>`
// is platform-independent.
function resolveNpmCli() {
  const execPath = String(process.env.npm_execpath || "");
  if (execPath && /\.c?js$/i.test(execPath)) {
    return execPath;
  }
  // Fallbacks for direct `node scripts/prepareCanvasNative.cjs` invocation
  // (npm_execpath is only set inside an npm script). Look for the npm CLI
  // bundled with the running Node install, then in the project node_modules.
  const candidates = [
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ];
  for (const candidate of candidates) {
    try {
      return require.resolve(candidate);
    } catch {
      // try the next candidate
    }
  }
  try {
    return require.resolve("npm/bin/npm-cli.js", { paths: [ROOT, __dirname] });
  } catch {
    return null;
  }
}

function run() {
  const args = [
    "install",
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--force",
    ...BINDINGS.map(spec)
  ];
  console.log(`[canvas-native] installing ${BINDINGS.map(spec).join(", ")}`);

  const npmCli = resolveNpmCli();
  if (!npmCli) {
    console.error("[canvas-native] could not locate the npm CLI entrypoint");
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: ROOT,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(`[canvas-native] failed to launch npm: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `[canvas-native] npm install exited with code ${result.status} signal ${result.signal || "none"}`
    );
    process.exit(typeof result.status === "number" ? result.status : 1);
  }

  const missing = BINDINGS.filter((name) => {
    try {
      require.resolve(path.join(ROOT, "node_modules", name, "package.json"));
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    console.error(`[canvas-native] still missing after install: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("[canvas-native] all desktop canvas bindings present");
}

run();
