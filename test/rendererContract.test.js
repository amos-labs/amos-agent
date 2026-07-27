import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("every renderer element reference is registered and present in the HTML shell", async () => {
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);
  const registrySource = javascript.match(
    /const elements = Object\.fromEntries\(([\s\S]*?)\.map\(\(id\)/
  )?.[1];
  assert.ok(registrySource, "renderer element registry must be discoverable");

  const registered = new Set(
    [...registrySource.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1])
  );
  const referenced = new Set(
    [...javascript.matchAll(/elements\.([A-Za-z0-9_]+)/g)].map((match) => match[1])
  );
  const htmlIds = new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  );

  assert.deepEqual(
    [...referenced].filter((id) => !registered.has(id)),
    [],
    "all elements.* references must be in the renderer registry"
  );
  assert.deepEqual(
    [...registered].filter((id) => !htmlIds.has(id)),
    [],
    "all registered renderer elements must exist in index.html"
  );
});
