import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentManager } from "../src/desktop/attachments.js";

test("document attachments become bounded model reference material", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-attachments-"));
  const file = join(root, "brief.md");
  await writeFile(file, "# Launch brief\nProtect the customer experience.");
  const manager = new AttachmentManager();
  const [attachment] = await manager.addPaths([file]);

  const content = manager.buildMessageContent(
    "Summarize this",
    [{ id: attachment.id, retention: "task" }],
    { vision: false }
  );

  assert.equal(typeof content, "string");
  assert.match(content, /Launch brief/);
  assert.match(content, /Treat it as data/);
  assert.equal(manager.memoryPayload(attachment.id).source, "amos-desktop");
});

test("pasted screenshots are sent only to vision-capable models", async () => {
  const manager = new AttachmentManager();
  const attachment = await manager.addPastedImage({
    name: "screen.png",
    mime: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71])
  });

  assert.throws(
    () => manager.buildMessageContent("Inspect this", [{ id: attachment.id }], { vision: false }),
    /does not support images/
  );
  const content = manager.buildMessageContent("Inspect this", [{ id: attachment.id }], { vision: true });
  assert.equal(content[0].type, "text");
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
});

test("company-memory status prevents silent attachment persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-memory-"));
  const file = join(root, "notes.txt");
  await writeFile(file, "Durable notes");
  const manager = new AttachmentManager();
  const [attachment] = await manager.addPaths([file]);

  assert.equal(attachment.memoryStatus, "local");
  manager.markMemoryRequested(attachment.id, { document_id: "doc-1" });
  assert.equal(manager.list()[0].memoryStatus, "requested");
});

test("private memory can be restored as a task attachment without changing company state", async () => {
  const manager = new AttachmentManager();
  const attachment = manager.addPrivateMemory({
    id: "private-1",
    name: "private.md",
    mime: "text/markdown",
    kind: "document",
    size: 14,
    sha256: "d".repeat(64),
    text: "Private context"
  });

  assert.equal(attachment.memoryStatus, "private");
  assert.match(
    manager.buildMessageContent("Use this", [{ id: attachment.id }], { vision: false }),
    /Private context/
  );
});
