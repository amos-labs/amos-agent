import assert from "node:assert/strict";
import test from "node:test";
import {
  createCapsuleManifest,
  createSyncJournalEntry,
  evidencePackDecision,
  exportDecision,
  MEMORY_CLASSES,
  validateCapsuleManifest
} from "../src/desktop/memoryContract.js";

const hash = "a".repeat(64);

test("formal memory classes keep desktop and AMOS authority distinct", () => {
  assert.equal(MEMORY_CLASSES.private.authority, "user");
  assert.equal(MEMORY_CLASSES.private.persistence, "encrypted_local");
  assert.equal(MEMORY_CLASSES.company.authority, "amos");
  assert.equal(MEMORY_CLASSES.receipt.mutable, false);
});

test("export policy requires AMOS authorization and signatures for managed memory", () => {
  assert.equal(exportDecision("private").allowed, true);
  assert.equal(exportDecision("company").allowed, false);
  assert.equal(exportDecision("company", { amosAuthorized: true }).signatureRequired, true);
  assert.equal(exportDecision("receipt", { amosAuthorized: true, signed: false }).allowed, false);
  assert.equal(exportDecision("receipt", { amosAuthorized: true, signed: true }).readOnly, true);
});

test("evidence pack export is a read-only unsigned window dump, not a receipt capsule", () => {
  const decision = evidencePackDecision();
  assert.equal(decision.allowed, true);
  assert.equal(decision.readOnly, true);
  assert.equal(decision.signed, false);
  assert.equal(decision.signatureRequired, false);
  assert.equal(decision.memoryClassExport, false);
  assert.equal(exportDecision("receipt").allowed, false);
  assert.equal(exportDecision("receipt", { amosAuthorized: true, signed: false }).allowed, false);
});

test("capsule manifests prohibit credentials and require managed signatures", () => {
  const manifest = createCapsuleManifest({
    capsuleId: "capsule-1",
    subjectId: "user-1",
    tenantId: "tenant-1",
    createdAt: "2026-07-26T00:00:00Z",
    entries: [{
      id: "private-1",
      memory_class: "private",
      source_id: "local-1",
      content_hash: hash,
      media_type: "text/plain",
      created_at: "2026-07-26T00:00:00Z"
    }],
    journal: [{
      id: "journal-1",
      operation: "add",
      memory_id: "private-1",
      memory_class: "private",
      at: "2026-07-26T00:00:00Z"
    }]
  });

  assert.equal(manifest.encryption.required, true);
  assert.equal(manifest.encryption.credentials_allowed, false);
  assert.equal(manifest.entries[0].memory_class, "private");
  assert.throws(
    () => createCapsuleManifest({
      subjectId: "user-1",
      entries: [{
        id: "company-1",
        memory_class: "company",
        source_id: "doc-1",
        content_hash: hash,
        created_at: "2026-07-26T00:00:00Z"
      }]
    }),
    /requires an AMOS signature/
  );
});

test("sync journal rejects unknown operations", () => {
  assert.throws(
    () => createSyncJournalEntry({
      operation: "overwrite",
      memoryId: "private-1",
      memoryClass: "private"
    }),
    /Unsupported memory journal operation/
  );
});

test("imported capsule manifests validate journal operations and unique entries", () => {
  const manifest = createCapsuleManifest({
    capsuleId: "capsule-1",
    subjectId: "user-1",
    createdAt: "2026-07-26T00:00:00Z",
    entries: [{
      id: "private-1",
      memory_class: "private",
      source_id: "local-1",
      content_hash: hash,
      created_at: "2026-07-26T00:00:00Z"
    }]
  });
  assert.throws(
    () => validateCapsuleManifest({
      ...manifest,
      sync_journal: [{
        id: "journal-1",
        operation: "overwrite",
        memory_id: "private-1",
        memory_class: "private",
        at: "2026-07-26T00:00:00Z"
      }]
    }),
    /Unsupported memory journal operation/
  );
  assert.throws(
    () => validateCapsuleManifest({
      ...manifest,
      entries: [manifest.entries[0], manifest.entries[0]]
    }),
    /Duplicate memory capsule entry ID/
  );
});
