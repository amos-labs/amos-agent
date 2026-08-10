import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeDocumentFormats,
  normalizeDocumentSpec
} from "../src/artifacts/documentSpec.js";
import { extractDocumentText } from "../src/desktop/attachments.js";
import { createArtifactTools } from "../src/tools/artifacts.js";

const DOCUMENT = {
  version: "1",
  title: "Quarterly Operating Brief",
  subtitle: "A verified AMOS Desktop artifact",
  author: "AMOS Labs",
  subject: "Operating review",
  style: "business",
  blocks: [
    { type: "heading", level: 1, text: "Executive summary" },
    { type: "paragraph", text: "Revenue is growing and the expansion pipeline remains strong." },
    { type: "list", style: "bullets", items: ["Protect retention", "Expand qualified accounts"] },
    {
      type: "table",
      headers: ["Metric", "Current", "Status"],
      rows: [["ARR", "$3M", "Growing"], ["Expansion", "Strong", "On track"]]
    },
    { type: "callout", label: "Decision", text: "Fund the next operating phase." },
    {
      type: "sources",
      sources: [{ label: "Operating snapshot", source_ref: "amos:briefing:quarterly" }]
    }
  ]
};

test("DocumentSpec is bounded and rejects unsafe source contracts", () => {
  const spec = normalizeDocumentSpec(DOCUMENT);
  assert.equal(spec.title, DOCUMENT.title);
  assert.deepEqual(normalizeDocumentFormats(["pdf", "pdf"]), ["pdf"]);
  assert.throws(
    () => normalizeDocumentSpec({
      title: "Unsafe source",
      blocks: [{
        type: "sources",
        sources: [{ label: "Metadata", url: "http://169.254.169.254/latest/meta-data" }]
      }]
    }),
    /must use HTTPS/
  );
  assert.throws(
    () => normalizeDocumentSpec({
      title: "Wide table",
      blocks: [{
        type: "table",
        headers: Array.from({ length: 9 }, (_, index) => `Column ${index}`),
        rows: [Array(9).fill("value")]
      }]
    }),
    /between 1 and 8 items/
  );
});

test("Desktop creates and reopens verified DOCX and PDF from one specification", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-documents-"));
  let approvals = 0;
  const tool = createArtifactTools()[0];
  const result = await tool.handler(
    {
      path: "reports/quarterly-operating-brief",
      formats: ["docx", "pdf"],
      document: DOCUMENT,
      reason: "Prepare the operating review"
    },
    {
      config: {
        safety: {
          workspaceRoot: root,
          allowOutsideWorkspace: false,
          autoApproveWrites: false,
          autoApproveKinds: []
        }
      },
      approvals: {
        confirm: async (_message, options) => {
          approvals += 1;
          assert.equal(options.kind, "file-write");
          return true;
        }
      }
    }
  );

  assert.equal(approvals, 1);
  assert.equal(result.ok, true);
  assert.equal(result.contract, "amos.document-spec:1");
  assert.deepEqual(result.artifacts.map((artifact) => artifact.format), ["docx", "pdf"]);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.verified, true);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await stat(join(root, artifact.path))).size, artifact.bytes);
    const buffer = await readFile(join(root, artifact.path));
    if (artifact.format === "pdf") {
      const pageObjects = buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || [];
      assert.equal(pageObjects.length, 1);
    }
    const mime = artifact.format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const text = await extractDocumentText({ name: artifact.path, mime, buffer });
    assert.match(text, /Quarterly Operating Brief/);
    assert.match(text, /Fund the next operating phase/);
  }
});

test("Document creation denies writes cleanly and rejects paths outside the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-documents-denied-"));
  const tool = createArtifactTools()[0];
  const context = {
    config: {
      safety: {
        workspaceRoot: root,
        allowOutsideWorkspace: false,
        autoApproveWrites: false,
        autoApproveKinds: []
      }
    },
    approvals: { confirm: async () => false }
  };
  const denied = await tool.handler({ path: "brief", formats: ["pdf"], document: DOCUMENT }, context);
  assert.deepEqual(denied, {
    ok: false,
    denied: true,
    message: "User denied document creation."
  });
  await assert.rejects(stat(join(root, "brief.pdf")), /ENOENT/);
  await assert.rejects(
    tool.handler({ path: "../escape", formats: ["pdf"], document: DOCUMENT }, context),
    /escapes workspace/
  );
  await assert.rejects(
    tool.handler({ path: "already.pdf", formats: ["pdf"], document: DOCUMENT }, context),
    /must not include a file extension/
  );
});
