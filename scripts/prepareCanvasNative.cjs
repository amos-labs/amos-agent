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
  const result = spawnSync("npm", args, { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[canvas-native] npm install exited with ${result.status}`);
    process.exit(result.status || 1);
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
