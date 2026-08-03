import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import { PrivateMemoryStore } from "../src/desktop/privateMemoryStore.js";

function privateStore(root) {
  return new PrivateMemoryStore({
    filePath: join(root, "private-memory.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  });
}

test("desktop saves, reuses, promotes, and forgets encrypted private memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-desktop-private-memory-"));
  const path = join(root, "founder-notes.md");
  await writeFile(path, "Private founder working context.");
  const store = privateStore(root);
  let companyPayload;
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: { read: async () => ({ operatingMode: "online" }) },
    privateMemoryStore: store,
    openBrowser() {},
    emit() {}
  });
  controller.getRuntime = async () => ({
    config: { model: { capabilities: { vision: false } } },
    runtime: {
      modelClient: {},
      amosClient: {
        async callTool(name, args) {
          companyPayload = { name, args };
          return { document_id: "company-doc-1", status: "indexed" };
        }
      },
      loop: {
        async run() {
          return "done";
        }
      }
    }
  });

  const [attachment] = await controller.addAttachmentPaths([path]);
  const result = await controller.run({
    text: "Use this privately",
    attachments: [{ id: attachment.id, retention: "private" }]
  });
  assert.equal(result.memory[0].status, "saved_private");
  const [memory] = await store.list();
  assert.equal(memory.name, "founder-notes.md");

  const reused = await controller.usePrivateMemory(memory.id);
  assert.equal(reused.attachments.at(-1).memoryStatus, "private");
  assert.equal(controller.attachments.get(reused.attachment.id).text, "Private founder working context.");

  const promoted = await controller.promotePrivateMemory(memory.id);
  assert.equal(companyPayload.name, "call_engine_tool");
  assert.equal(companyPayload.args.engine, "company");
  assert.equal(companyPayload.args.arguments.content, "Private founder working context.");
  assert.equal(promoted.promoted.companyResult.document_id, "company-doc-1");

  const forgotten = await controller.forgetPrivateMemory(memory.id);
  assert.deepEqual(forgotten.privateMemory, []);
});

test("desktop previews encrypted capsules before importing private memory", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "amos-desktop-capsule-source-"));
  const destinationRoot = await mkdtemp(join(tmpdir(), "amos-desktop-capsule-destination-"));
  const sourceStore = privateStore(sourceRoot);
  const sourceScope = { ownerSubjectId: "user-1", ownerTenantId: "tenant-1" };
  await sourceStore.add({
    name: "portable-context.md",
    mime: "text/markdown",
    kind: "document",
    size: 19,
    sha256: "9".repeat(64),
    text: "Portable context"
  }, sourceScope);
  const sourceController = new DesktopController({
    userDataPath: sourceRoot,
    settingsStore: { read: async () => ({ operatingMode: "online" }) },
    privateMemoryStore: sourceStore,
    openBrowser() {},
    emit() {}
  });
  sourceController.identity = {
    user: { id: "user-1", email: "owner@example.com" },
    tenant_id: "tenant-1"
  };
  const filePath = join(sourceRoot, "portable.amos-memory");
  const exported = await sourceController.exportPrivateMemoryCapsule({
    filePath,
    passphrase: "portable private passphrase",
    ids: null
  });
  assert.equal(exported.itemCount, 1);

  const destinationStore = privateStore(destinationRoot);
  const destinationController = new DesktopController({
    userDataPath: destinationRoot,
    settingsStore: { read: async () => ({ operatingMode: "online" }) },
    privateMemoryStore: destinationStore,
    openBrowser() {},
    emit() {}
  });
  const preview = await destinationController.previewPrivateMemoryCapsule({
    filePath,
    passphrase: "portable private passphrase"
  });
  assert.equal(preview.itemCount, 1);
  assert.deepEqual(await destinationStore.list(), []);

  const imported = await destinationController.importPrivateMemoryCapsule(preview.previewId);
  assert.equal(imported.importedCount, 1);
  assert.equal(imported.privateMemory[0].lineage.capsuleId, preview.capsuleId);
  await assert.rejects(
    destinationController.importPrivateMemoryCapsule(preview.previewId),
    /preview expired/
  );
});
