import { randomUUID } from "node:crypto";

export const MEMORY_CONTRACT_VERSION = "1";
export const CAPSULE_FORMAT = "amos-memory-capsule";
export const CAPSULE_VERSION = "1";

export const MEMORY_CLASSES = Object.freeze({
  session: Object.freeze({
    id: "session",
    label: "Session",
    authority: "desktop",
    defaultVisibility: "private",
    persistence: "ephemeral",
    mutable: true,
    exportPolicy: "promote_first",
    description: "Available only to the current task unless you explicitly keep it."
  }),
  private: Object.freeze({
    id: "private",
    label: "Private",
    authority: "user",
    defaultVisibility: "private",
    persistence: "encrypted_local",
    mutable: true,
    exportPolicy: "encrypted_owner_export",
    description: "Encrypted on this computer and visible only to you until you promote it."
  }),
  shared: Object.freeze({
    id: "shared",
    label: "Shared",
    authority: "amos",
    defaultVisibility: "explicit_acl",
    persistence: "managed",
    mutable: true,
    exportPolicy: "amos_policy_required",
    description: "Managed by AMOS and visible only to the people or groups explicitly allowed."
  }),
  company: Object.freeze({
    id: "company",
    label: "Company",
    authority: "amos",
    defaultVisibility: "tenant_role_scoped",
    persistence: "managed",
    mutable: true,
    exportPolicy: "amos_policy_required",
    description: "Durable company memory governed by tenant, role, and document policy."
  }),
  receipt: Object.freeze({
    id: "receipt",
    label: "Evidence & receipts",
    authority: "amos",
    defaultVisibility: "policy_scoped",
    persistence: "managed_immutable",
    mutable: false,
    exportPolicy: "signed_verified_copy_only",
    description: "Immutable governed evidence; offline copies remain read-only and verifiable."
  })
});

const JOURNAL_OPERATIONS = new Set([
  "add",
  "update",
  "forget",
  "promote",
  "cache",
  "revoke",
  "expire"
]);

export function memoryClassSpec(value) {
  const spec = MEMORY_CLASSES[value];
  if (!spec) throw new Error(`Unsupported AMOS memory class: ${value}`);
  return spec;
}

export const EVIDENCE_PACK_SCHEMA = "amos.evidence-pack.v1";
export const MAX_PLATFORM_EVIDENCE_ITEMS = 200;

export function exportDecision(memoryClass, { amosAuthorized = false, signed = false } = {}) {
  const spec = memoryClassSpec(memoryClass);
  if (spec.exportPolicy === "promote_first") {
    return { allowed: false, reason: "Session memory must be promoted to private or managed memory first." };
  }
  if (spec.exportPolicy === "encrypted_owner_export") {
    return { allowed: true, encryptionRequired: true, signatureRequired: false };
  }
  if (spec.exportPolicy === "signed_verified_copy_only") {
    return signed && amosAuthorized
      ? { allowed: true, encryptionRequired: true, signatureRequired: true, readOnly: true }
      : { allowed: false, reason: "Receipt exports require current AMOS authorization and a valid signature." };
  }
  return amosAuthorized
    ? { allowed: true, encryptionRequired: true, signatureRequired: true }
    : { allowed: false, reason: "Managed memory exports require a current AMOS policy decision." };
}

// Read-only Proof-panel bundle. Not a MEMORY_CLASSES.receipt / exportDecision capsule.
export function evidencePackDecision() {
  return {
    allowed: true,
    readOnly: true,
    signed: false,
    signatureRequired: false,
    encryptionRequired: false,
    memoryClassExport: false
  };
}

export function createSyncJournalEntry({
  operation,
  memoryId,
  memoryClass,
  baseVersion = null,
  at = new Date().toISOString(),
  id = randomUUID()
}) {
  if (!JOURNAL_OPERATIONS.has(operation)) {
    throw new Error(`Unsupported memory journal operation: ${operation}`);
  }
  memoryClassSpec(memoryClass);
  if (!clean(memoryId, 128)) throw new Error("Memory journal entries require a memory ID");
  if (!clean(id, 128)) throw new Error("Memory journal entries require a journal ID");
  return {
    id: clean(id, 128),
    operation,
    memory_id: clean(memoryId, 128),
    memory_class: memoryClass,
    base_version: baseVersion === null ? null : clean(baseVersion, 128),
    at: isoTimestamp(at)
  };
}

export function createCapsuleManifest({
  capsuleId = randomUUID(),
  subjectId,
  tenantId = null,
  createdAt = new Date().toISOString(),
  expiresAt = null,
  parentCapsuleId = null,
  entries = [],
  journal = []
}) {
  const manifest = {
    format: CAPSULE_FORMAT,
    version: CAPSULE_VERSION,
    capsule_id: clean(capsuleId, 128),
    subject_id: clean(subjectId, 256),
    tenant_id: nullableClean(tenantId, 256),
    created_at: isoTimestamp(createdAt),
    expires_at: expiresAt ? isoTimestamp(expiresAt) : null,
    parent_capsule_id: nullableClean(parentCapsuleId, 128),
    encryption: {
      required: true,
      content_algorithm: "AES-256-GCM-or-platform-equivalent",
      credentials_allowed: false
    },
    entries: entries.map(normalizeManifestEntry),
    sync_journal: journal.map((entry) => createSyncJournalEntry({
      operation: entry.operation,
      memoryId: entry.memory_id,
      memoryClass: entry.memory_class,
      baseVersion: entry.base_version,
      at: entry.at,
      id: entry.id
    }))
  };
  validateCapsuleManifest(manifest);
  return manifest;
}

export function validateCapsuleManifest(manifest) {
  if (manifest?.format !== CAPSULE_FORMAT || manifest?.version !== CAPSULE_VERSION) {
    throw new Error("Unsupported AMOS memory capsule format or version");
  }
  if (!clean(manifest.capsule_id, 128)) throw new Error("Memory capsules require a capsule ID");
  if (!clean(manifest.subject_id, 256)) throw new Error("Memory capsules require a subject ID");
  isoTimestamp(manifest.created_at);
  if (manifest.expires_at) {
    const expires = Date.parse(manifest.expires_at);
    if (expires <= Date.parse(manifest.created_at)) {
      throw new Error("Memory capsule expiry must be later than its creation time");
    }
  }
  if (manifest.encryption?.required !== true || manifest.encryption?.credentials_allowed !== false) {
    throw new Error("Memory capsules must require encryption and prohibit credentials");
  }
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.sync_journal)) {
    throw new Error("Memory capsules require entry and sync-journal arrays");
  }
  const entryIds = new Set();
  for (const entry of manifest.entries) {
    const normalized = normalizeManifestEntry(entry);
    if (entryIds.has(normalized.id)) throw new Error(`Duplicate memory capsule entry ID: ${normalized.id}`);
    entryIds.add(normalized.id);
  }
  const journalIds = new Set();
  for (const entry of manifest.sync_journal) {
    if (!clean(entry?.id, 128) || !entry?.at) {
      throw new Error("Memory capsule journal entries require IDs and timestamps");
    }
    const normalized = createSyncJournalEntry({
      operation: entry?.operation,
      memoryId: entry?.memory_id,
      memoryClass: entry?.memory_class,
      baseVersion: entry?.base_version,
      at: entry?.at,
      id: entry?.id
    });
    if (journalIds.has(normalized.id)) throw new Error(`Duplicate memory journal ID: ${normalized.id}`);
    journalIds.add(normalized.id);
  }
  return true;
}

function normalizeManifestEntry(entry) {
  const memoryClass = memoryClassSpec(entry?.memory_class).id;
  const signatureRequired = ["shared", "company", "receipt"].includes(memoryClass);
  const normalized = {
    id: clean(entry.id, 128),
    memory_class: memoryClass,
    source_id: clean(entry.source_id, 256),
    content_hash: sha256(entry.content_hash),
    media_type: clean(entry.media_type || "text/plain", 256),
    created_at: isoTimestamp(entry.created_at),
    refreshed_at: entry.refreshed_at ? isoTimestamp(entry.refreshed_at) : null,
    expires_at: entry.expires_at ? isoTimestamp(entry.expires_at) : null,
    visibility: clean(entry.visibility || MEMORY_CLASSES[memoryClass].defaultVisibility, 128),
    allowed_use: clean(entry.allowed_use || "context", 128),
    read_only: memoryClass === "receipt" || Boolean(entry.read_only),
    signature: entry.signature ? clean(entry.signature, 16_384) : null
  };
  if (!normalized.id || !normalized.source_id) {
    throw new Error("Memory capsule entries require IDs and source IDs");
  }
  if (signatureRequired && !normalized.signature) {
    throw new Error(`${memoryClass} memory requires an AMOS signature before capsule export`);
  }
  return normalized;
}

function sha256(value) {
  const cleaned = clean(value, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleaned)) throw new Error("Memory content hashes must be SHA-256 hex");
  return cleaned;
}

function isoTimestamp(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid memory timestamp: ${value}`);
  return parsed.toISOString();
}

function nullableClean(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  return clean(value, maxLength);
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
