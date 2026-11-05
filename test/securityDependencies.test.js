import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const packages = Object.entries(lock.packages);
const matches = (path, name) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`);

function atLeast(version, minimum) {
  const actual = version.split(".").map(Number);
  const expected = minimum.split(".").map(Number);
  assert.equal(actual.length, 3, `Unexpected version ${version}`);
  assert.ok(actual.every(Number.isSafeInteger), `Expected a stable release: ${version}`);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== expected[index]) return actual[index] > expected[index];
  }
  return true;
}

test("the shipped Electron runtime and XML/YAML parsers stay on patched releases", () => {
  for (const [name, minimum] of [["electron", "45.2.3"], ["@xmldom/xmldom", "0.8.15"], ["js-yaml", "4.3.2"]]) {
    const resolved = packages.filter(([path]) => matches(path, name));
    assert.ok(resolved.length, `Missing ${name}`);
    for (const [, pkg] of resolved) assert.ok(atLeast(pkg.version, minimum), `${name}@${pkg.version} is below ${minimum}`);
  }
});

test("packaging glob dependencies retain patched versions in each used major", () => {
  for (const [path, pkg] of packages) {
    const major = Number(pkg.version?.split(".")[0]);
    if (matches(path, "brace-expansion")) {
      const minimum = { 1: "1.1.21", 2: "2.1.7", 4: "5.0.12", 5: "5.0.12" }[major];
      if (minimum) assert.ok(atLeast(pkg.version, minimum), `${path}@${pkg.version}`);
    }
    if (matches(path, "minimatch") && major >= 7) {
      assert.ok(atLeast(pkg.version, "11.0.1"), `${path}@${pkg.version}`);
    }
  }
});

test("the Electron installer no longer resolves the unpatched extract-zip package", () => {
  assert.equal(packages.some(([path]) => matches(path, "extract-zip")), false);
  assert.ok(packages.some(([path]) => matches(path, "@electron-internal/extract-zip")));
});
