import test from "node:test";
import assert from "node:assert/strict";
import { fetchCompat } from "../src/util/fetchCompat.js";

test("fetchCompat uses global fetch when available", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => "application/json" },
    async json() {
      return { ok: true, method: options.method };
    },
    async text() {
      return JSON.stringify({ ok: true, method: options.method });
    }
  });
  try {
    const response = await fetchCompat("https://example.com/test", { method: "POST" });
    assert.equal(response.ok, true);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), { ok: true, method: "POST" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
