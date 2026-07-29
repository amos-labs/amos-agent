import assert from "node:assert/strict";
import { verify, createPublicKey } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DecisionKeyStore } from "../src/desktop/decisionKeyStore.js";

test("Desktop decision keys persist encrypted and sign server challenges", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-decision-key-"));
  const filePath = join(directory, "key.json");
  const encrypt = async (value) => Buffer.from(`encrypted:${value}`).toString("base64");
  const decrypt = async (value) => {
    const plaintext = Buffer.from(value, "base64").toString();
    assert.ok(plaintext.startsWith("encrypted:"));
    return plaintext.slice("encrypted:".length);
  };
  const store = new DecisionKeyStore({ filePath, encrypt, decrypt });

  const first = await store.getOrCreate();
  const second = await store.getOrCreate();
  assert.deepEqual(second, first);
  assert.match(first.id, /^[0-9a-f-]{36}$/i);
  assert.match(first.publicKey, /^[A-Za-z0-9_-]{43}$/);

  const disk = await readFile(filePath, "utf8");
  assert.equal(disk.includes("PRIVATE KEY"), false);

  const message = "AMOS-DESKTOP-APPROVAL-V1\nchallenge";
  const signature = await store.sign(message);
  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: first.publicKey },
    format: "jwk"
  });
  assert.equal(
    verify(null, Buffer.from(message), key, Buffer.from(signature, "base64url")),
    true
  );
});
