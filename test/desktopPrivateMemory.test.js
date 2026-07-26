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
    settingsStore: {},
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
