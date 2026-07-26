import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopController } from "../src/desktop/controller.js";

test("desktop explicitly promotes selected document attachments into governed company memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-controller-attachments-"));
  const path = join(root, "brief.md");
  await writeFile(path, "Durable launch evidence.");
  const events = [];
  let stored;
  let modelContent;
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: { read: async () => ({ operatingMode: "online" }) },
    openBrowser() {},
    emit(channel, payload) {
      events.push({ channel, payload });
    }
  });
  const [attachment] = await controller.addAttachmentPaths([path]);
  controller.getRuntime = async () => ({
    config: { model: { capabilities: { vision: false } } },
    runtime: {
      modelClient: {},
      amosClient: {
        async callTool(name, args) {
          stored = { name, args };
          return { document_id: "document-1", status: "indexed" };
        }
      },
      loop: {
        async run(content) {
          modelContent = content;
          return "done";
        }
      }
    }
  });

  const result = await controller.run({
    text: "Use the evidence",
    attachments: [{ id: attachment.id, retention: "company" }]
  });

  assert.equal(stored.name, "call_engine_tool");
  assert.equal(stored.args.engine, "company");
  assert.equal(stored.args.tool, "store_document");
  assert.equal(stored.args.arguments.content, "Durable launch evidence.");
  assert.match(modelContent, /Durable launch evidence/);
  assert.equal(result.attachments[0].memoryStatus, "requested");
  assert.ok(events.some((event) => event.payload?.name === "amos_company_store_document"));
});
