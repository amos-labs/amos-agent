import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  applyDocumentReview,
  finalizeDocumentReview,
  inspectDocumentReview
} from "../src/artifacts/documentReview.js";
import { renderDocumentArtifact } from "../src/artifacts/documentRenderer.js";
import { extractDocumentText } from "../src/desktop/attachments.js";
import { createDocumentReviewTools } from "../src/tools/documentReview.js";

const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SOURCE_SPEC = {
  version: "1",
  title: "Review Source",
  blocks: [
    { type: "heading", level: 1, text: "Executive summary" },
    { type: "paragraph", text: "Revenue is growing and the expansion pipeline remains strong." }
  ]
};

test("DOCX review creates true tracked replacements and inline comments", async () => {
  const source = await renderDocumentArtifact(SOURCE_SPEC, "docx");
  const reviewed = await applyDocumentReview(source, {
    author: "AMOS Reviewer",
    edits: [{
      find: "Revenue is growing",
      replace: "ARR has increased",
      comment: "Updated to the measured operating term."
    }],
    comments: [{
      find: "expansion pipeline",
      text: "Confirm this statement against the current CRM snapshot."
    }]
  });

  assert.deepEqual(reviewed.review, {
    tracked_insertions: 1,
    tracked_deletions: 1,
    comment_anchors: 2,
    comment_bodies: 2
  });
  const reviewedZip = await JSZip.loadAsync(reviewed.buffer);
  assert.ok(reviewedZip.file("word/comments.xml"));
  assert.match(
    await reviewedZip.file("word/_rels/document.xml.rels").async("string"),
    /relationships\/comments/
  );
  assert.match(
    await reviewedZip.file("[Content_Types].xml").async("string"),
    /wordprocessingml\.comments\+xml/
  );
  const accepted = await finalizeDocumentReview(reviewed.buffer, {
    changes: "accept",
    comments: "remove"
  });
  assert.deepEqual(await inspectDocumentReview(accepted.buffer), {
    tracked_insertions: 0,
    tracked_deletions: 0,
    comment_anchors: 0,
    comment_bodies: 0
  });
  const text = await extractDocumentText({ name: "accepted.docx", mime: MIME, buffer: accepted.buffer });
  assert.match(text, /ARR has increased/);
  assert.doesNotMatch(text, /Revenue is growing/);

  const rejected = await finalizeDocumentReview(reviewed.buffer, {
    changes: "reject",
    comments: "remove"
  });
  const rejectedText = await extractDocumentText({ name: "rejected.docx", mime: MIME, buffer: rejected.buffer });
  assert.match(rejectedText, /Revenue is growing/);
  assert.doesNotMatch(rejectedText, /ARR has increased/);
});

test("document review tools preserve source lineage and require a different safe output", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-document-review-"));
  const source = await renderDocumentArtifact(SOURCE_SPEC, "docx");
  await writeFile(join(root, "source.docx"), source);
  const [editTool, finalizeTool] = createDocumentReviewTools();
  let approvals = 0;
  const context = {
    config: {
      safety: {
        workspaceRoot: root,
        autoApproveWrites: false,
        autoApproveKinds: []
      }
    },
    approvals: {
      confirm: async () => {
        approvals += 1;
        return true;
      }
    }
  };
  const reviewed = await editTool.handler({
    source_path: "source.docx",
    output_path: "reviewed.docx",
    edits: [{ find: "Revenue is growing", replace: "ARR has increased" }]
  }, context);
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.contract, "amos.document-review:1");
  assert.match(reviewed.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await stat(join(root, reviewed.artifact.path))).isFile(), true);

  const finalized = await finalizeTool.handler({
    source_path: "reviewed.docx",
    output_path: "final.docx",
    changes: "accept",
    comments: "remove"
  }, context);
  assert.equal(finalized.review.tracked_insertions, 0);
  assert.equal(approvals, 2);
  assert.equal((await readFile(join(root, "source.docx"))).equals(source), true);
  await assert.rejects(
    editTool.handler({
      source_path: "source.docx",
      output_path: "source.docx",
      edits: [{ find: "Revenue", replace: "ARR" }]
    }, context),
    /must differ/
  );
});
