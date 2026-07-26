import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrivateMemoryStore } from "../src/desktop/privateMemoryStore.js";

function codec() {
  return {
    encrypt(value) {
      return Buffer.from(`encrypted:${value}`).toString("base64");
    },
    decrypt(value) {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      if (!decoded.startsWith("encrypted:")) throw new Error("invalid test ciphertext");
      return decoded.slice("encrypted:".length);
    }
  };
}

test("private memory is encrypted at rest and can be reused", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-private-memory-"));
  const filePath = join(root, "private-memory.json");
  const store = new PrivateMemoryStore({
    filePath,
    ...codec(),
    now: () => new Date("2026-07-26T10:00:00Z"),
    createId: (() => {
      let index = 0;
      return () => `id-${++index}`;
    })()
  });

  const saved = await store.add({
    name: "secret-plan.md",
    mime: "text/markdown",
    kind: "document",
    size: 24,
    sha256: "b".repeat(64),
    text: "Private acquisition plan",
    source: "amos-desktop"
  });

  assert.equal(saved.status, "saved");
  assert.equal((await store.list())[0].visibility, "private");
  assert.equal((await store.get(saved.item.id)).text, "Private acquisition plan");
  const raw = await readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /Private acquisition plan|secret-plan/);
});

test("listing private memory decrypts metadata without loading full content", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-private-memory-list-"));
  const decrypted = [];
  const store = new PrivateMemoryStore({
    filePath: join(root, "private-memory.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt(value) {
      const plaintext = Buffer.from(value, "base64").toString("utf8");
      decrypted.push(plaintext);
      return plaintext;
    }
  });
  const saved = await store.add({
    name: "large-notes.md",
    mime: "text/markdown",
    kind: "document",
    size: 25,
    sha256: "e".repeat(64),
    text: "SENSITIVE PRIVATE CONTENT"
  });

  decrypted.length = 0;
  assert.equal((await store.list())[0].name, "large-notes.md");
  assert.doesNotMatch(decrypted.join("\n"), /SENSITIVE PRIVATE CONTENT/);
  assert.equal((await store.get(saved.item.id)).text, "SENSITIVE PRIVATE CONTENT");
});

test("private memory deduplicates, records promotion, and forgets explicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-private-memory-controls-"));
  let tick = 0;
  const store = new PrivateMemoryStore({
    filePath: join(root, "private-memory.json"),
    ...codec(),
    now: () => new Date(`2026-07-26T10:00:0${tick++}Z`),
    createId: (() => {
      let index = 0;
      return () => `id-${++index}`;
    })()
  });
  const input = {
    name: "brief.txt",
    mime: "text/plain",
    kind: "document",
    size: 5,
    sha256: "c".repeat(64),
    text: "brief"
  };

  const first = await store.add(input);
  const duplicate = await store.add(input);
  assert.equal(duplicate.status, "already_saved");
  assert.equal((await store.list()).length, 1);

  const promoted = await store.markPromoted(first.item.id, { document_id: "doc-1" });
  assert.equal(promoted.companyResult.document_id, "doc-1");
  assert.ok(promoted.promotedAt);

  assert.equal(await store.forget(first.item.id), true);
  assert.equal((await store.list()).length, 0);
  assert.deepEqual((await store.journal()).map((entry) => entry.operation), ["add", "promote", "forget"]);
});
