import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicUrl, isPrivateAddress } from "../src/tools/web.js";

test("private, loopback, link-local, and metadata ranges are blocked", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("93.184.216.34"), false);
  assert.equal(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946"), false);
});

test("public fetch refuses redirects to private addresses", async () => {
  let calls = 0;
  const response = {
    status: 302,
    headers: { get: (name) => name === "location" ? "http://127.0.0.1/admin" : null }
  };
  await assert.rejects(
    () => fetchPublicUrl("http://93.184.216.34/start", { fetchImpl: async () => { calls += 1; return response; } }),
    /Private or local/
  );
  assert.equal(calls, 1);
});
