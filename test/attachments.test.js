import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import {
  attachmentTextBudget,
  attachmentToolkit,
  AttachmentManager
} from "../src/desktop/attachments.js";

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
  assert.match(content, new RegExp(`attachment_id=${attachment.id}`));
  assert.match(content, new RegExp(`SHA-256 ${attachment.sha256}`));
  assert.equal(manager.memoryPayload(attachment.id).source, "amos-desktop");
});

test("browser uploads revalidate the exact attachment bytes before staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-upload-attachment-"));
  const file = join(root, "report.csv");
  await writeFile(file, "region,revenue\nwest,42\n");
  const manager = new AttachmentManager();
  const [attachment] = await manager.addPaths([file]);
  const payload = await manager.browserUploadPayload(attachment.id);

  assert.equal(payload.name, "report.csv");
  assert.equal(payload.buffer.toString(), "region,revenue\nwest,42\n");
  await writeFile(file, "region,revenue\neast,999\n");
  await assert.rejects(
    manager.browserUploadPayload(attachment.id),
    /changed after it was attached/
  );
});

test("browser downloads enter the supported attachment pipeline and retain verified bytes", async () => {
  const manager = new AttachmentManager();
  const bytes = Buffer.from("region,revenue\nwest,42\n");
  const attachment = await manager.addBrowserDownload({
    name: "report.csv",
    mime: "text/csv",
    bytes,
    sourceUrl: "https://example.com/reports"
  });

  assert.equal(attachment.source, "browser-download");
  assert.equal(manager.browserDownloadPayload(attachment.id).buffer.equals(bytes), true);
  await assert.rejects(
    manager.addBrowserDownload({
      name: "payload.exe",
      mime: "application/octet-stream",
      bytes: Buffer.from([0, 1, 2, 3])
    }),
    /not supported yet/
  );
  await assert.rejects(
    manager.addBrowserDownload({
      name: "spoofed.png",
      mime: "image/png",
      bytes: Buffer.from("not really a png")
    }),
    /does not match its image format/
  );
});

test("native XLSX attachments expose sheet values and formulas to the model", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-xlsx-attachment-"));
  const file = join(root, "model.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Assumptions");
  sheet.getCell("A1").value = "Current MRR";
  sheet.getCell("B1").value = 2_200;
  sheet.getCell("A2").value = "Annualized";
  sheet.getCell("B2").value = { formula: "B1*12", result: 26_400 };
  await workbook.xlsx.writeFile(file);

  const manager = new AttachmentManager();
  const [attachment] = await manager.addPaths([file]);
  const content = manager.buildMessageContent(
    "Review the model",
    [{ id: attachment.id, retention: "task" }],
    { vision: false }
  );

  assert.match(content, /\[Sheet: Assumptions\]/);
  assert.match(content, /Current MRR\t2200/);
  assert.match(content, /=B1\*12 \[result: 26400\]/);
  assert.equal(attachment.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(attachmentToolkit(attachment), "spreadsheets");
  assert.equal(attachmentToolkit({ name: "plan.docx", kind: "document" }), "documents");
  assert.equal(attachmentToolkit({ name: "brief.pptx", kind: "document" }), "presentations");
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

test("large attachment excerpts follow the selected model context and remain chunk-readable", () => {
  const manager = new AttachmentManager();
  const marker = "IMPORTANT-LATER-SECTION";
  const attachment = manager.addPrivateMemory({
    id: "large-private",
    name: "large.txt",
    mime: "text/plain",
    kind: "document",
    text: `${"start ".repeat(40_000)}${marker}${" end".repeat(10_000)}`
  });
  const content = manager.buildMessageContent(
    "Find the important section",
    [{ id: attachment.id }],
    { vision: false, contextTokens: 16_384, maxOutputTokens: 4_096 }
  );
  assert.ok(content.length < 35_000);
  assert.match(content, /attachment text truncated/);

  const chunk = manager.readModelChunk(attachment.id, { query: marker, maxChars: 2_000 });
  assert.equal(chunk.ok, true);
  assert.match(chunk.content, new RegExp(marker));
  assert.ok(chunk.offset > 0);
  assert.ok(attachmentTextBudget({ contextTokens: 16_384, maxOutputTokens: 4_096 }) < 30_000);
});

test("CSV attachments expose a bounded preview and direct the model to the deterministic importer", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-csv-attachment-"));
  const file = join(root, "customers.csv");
  await writeFile(file, `email,name\n${"person@example.com,Person\n".repeat(2_000)}`);
  const manager = new AttachmentManager();
  const [attachment] = await manager.addPaths([file]);

  const content = manager.buildMessageContent(
    "Create a marketing group from this file",
    [{ id: attachment.id }],
    { vision: false, contextTokens: 131_072, maxOutputTokens: 8_192 }
  );

  assert.ok(content.length < 10_000);
  assert.match(content, /desktop_import_email_contacts_csv/);
  assert.match(content, /Do not search Downloads/);
  assert.match(content, /attachment text truncated/);
});
