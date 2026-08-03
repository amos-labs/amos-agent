import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createSyncJournalEntry, memoryClassSpec } from "./memoryContract.js";

const STORE_VERSION = 1;
const MAX_ITEMS = 250;
const MAX_JOURNAL_ENTRIES = 1_000;
const MAX_ENCRYPTED_METADATA_CHARS = 256 * 1024;
const MAX_ENCRYPTED_CONTENT_CHARS = 48 * 1024 * 1024;
const MAX_TOTAL_ENCRYPTED_CHARS = 512 * 1024 * 1024;

export class PrivateMemoryStore {
  constructor({
    filePath,
    encrypt,
    decrypt,
    now = () => new Date(),
    createId = randomUUID
  }) {
    if (!filePath) throw new Error("Private memory requires a storage path");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Private memory requires platform encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.now = now;
    this.createId = createId;
  }

  async list(scope = null) {
    const store = await this.readStore();
    const items = store.items
      .map((envelope) => this.decryptMetadata(envelope))
      .filter((item) => scopeMatches(item, scope));
    return items
      .map(publicMemory)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id, scope = null) {
    const store = await this.readStore();
    const envelope = store.items.find((item) => item.id === id);
    if (!envelope) throw new Error("That private memory is no longer available");
    const memory = this.decryptEnvelope(envelope);
    if (!scopeMatches(memory, scope)) throw new Error("That private memory is no longer available");
    return memory;
  }

  async exportRecords(ids = null, scope = null) {
    const store = await this.readStore();
    const selected = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null;
    const records = store.items
      .filter((envelope) => !selected || selected.has(envelope.id))
      .map((envelope) => this.decryptEnvelope(envelope))
      .filter((item) => scopeMatches(item, scope));
    if (selected && records.length !== selected.size) {
      throw new Error("One or more selected private memories are no longer available");
    }
    return records.map((record) => ({ ...record, companyResult: null }));
  }

  async add(input, scope = null) {
    memoryClassSpec("private");
    const store = await this.readStore();
    const existing = store.items
      .map((envelope) => this.decryptMetadata(envelope))
      .find((item) => item.sha256 === input.sha256 && scopeMatches(item, scope));
    if (existing) return { item: publicMemory(existing), status: "already_saved" };
    if (store.items.length >= MAX_ITEMS) {
      throw new Error(`AMOS Desktop keeps up to ${MAX_ITEMS} private memories; forget one before adding another`);
    }

    const now = this.now().toISOString();
    const item = normalizePrivateMemory({
      ...input,
      id: this.createId(),
      memoryClass: "private",
      authority: "user",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
      promotedAt: null,
      companyResult: null,
      ...normalizedScope(scope)
    });
    const envelope = this.encryptItem(item);
    const encryptedSize = store.items.reduce((total, value) => total + encryptedEnvelopeSize(value), 0);
    if (encryptedSize + encryptedEnvelopeSize(envelope) > MAX_TOTAL_ENCRYPTED_CHARS) {
      throw new Error("Private memory has reached its 512 MB encrypted storage limit");
    }
    store.items.push(envelope);
    store.journal.push(createSyncJournalEntry({
      operation: "add",
      memoryId: item.id,
      memoryClass: "private",
      at: now,
      id: this.createId()
    }));
    await this.writeStore(store);
    return { item: publicMemory(item), status: "saved" };
  }

  async importCapsuleRecords(records, {
    capsuleId,
    parentCapsuleId = null,
    importedAt = this.now().toISOString(),
    scope = null
  }) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error("That AMOS memory capsule contains no private memory");
    }
    const store = await this.readStore();
    const existingHashes = new Set(
      store.items
        .map((envelope) => this.decryptMetadata(envelope))
        .filter((item) => scopeMatches(item, scope))
        .map((item) => item.sha256)
    );
    const result = { imported: [], duplicates: [] };
    let encryptedSize = store.items.reduce(
      (total, value) => total + encryptedEnvelopeSize(value),
      0
    );
    for (const record of records) {
      if (existingHashes.has(record.sha256)) {
        result.duplicates.push({ sourceMemoryId: record.id, name: record.name });
        continue;
      }
      if (store.items.length >= MAX_ITEMS) {
        throw new Error(`AMOS Desktop keeps up to ${MAX_ITEMS} private memories; forget one before importing more`);
      }
      const item = normalizePrivateMemory({
        ...record,
        id: this.createId(),
        source: "amos-memory-capsule",
        memoryClass: "private",
        authority: "user",
        visibility: "private",
        updatedAt: importedAt,
        promotedAt: null,
        companyResult: null,
        ...normalizedScope(scope),
        lineage: {
          capsuleId,
          parentCapsuleId,
          sourceMemoryId: record.id,
          sourceCreatedAt: record.createdAt,
          importedAt
        }
      });
      const envelope = this.encryptItem(item);
      encryptedSize += encryptedEnvelopeSize(envelope);
      if (encryptedSize > MAX_TOTAL_ENCRYPTED_CHARS) {
        throw new Error("Private memory has reached its 512 MB encrypted storage limit");
      }
      store.items.push(envelope);
      existingHashes.add(item.sha256);
      store.journal.push(createSyncJournalEntry({
        operation: "add",
        memoryId: item.id,
        memoryClass: "private",
        at: importedAt,
        id: this.createId()
      }));
      result.imported.push(publicMemory(item));
    }
    if (result.imported.length > 0) await this.writeStore(store);
    return result;
  }

  async markPromoted(id, companyResult, scope = null) {
    const store = await this.readStore();
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("That private memory is no longer available");
    const current = this.decryptMetadata(store.items[index]);
    if (!scopeMatches(current, scope)) throw new Error("That private memory is no longer available");
    const now = this.now().toISOString();
    const item = normalizePrivateMetadata({
      ...current,
      updatedAt: now,
      promotedAt: now,
      companyResult: boundedJsonValue(companyResult)
    });
    store.items[index] = {
      ...store.items[index],
      metadata: this.encryptMetadata(item)
    };
    store.journal.push(createSyncJournalEntry({
      operation: "promote",
      memoryId: item.id,
      memoryClass: "private",
      at: now,
      id: this.createId()
    }));
    await this.writeStore(store);
    return publicMemory(item);
  }

  async forget(id, scope = null) {
    const store = await this.readStore();
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    if (!scopeMatches(this.decryptMetadata(store.items[index]), scope)) return false;
    store.items.splice(index, 1);
    store.journal.push(createSyncJournalEntry({
      operation: "forget",
      memoryId: id,
      memoryClass: "private",
      at: this.now().toISOString(),
      id: this.createId()
    }));
    await this.writeStore(store);
    return true;
  }

  async journal(scope = null) {
    const store = await this.readStore();
    if (!scope) return store.journal.map((entry) => ({ ...entry }));
    const visibleIds = new Set(
      store.items
        .map((envelope) => this.decryptMetadata(envelope))
        .filter((item) => scopeMatches(item, scope))
        .map((item) => item.id)
    );
    return store.journal.filter((entry) => visibleIds.has(entry.memoryId)).map((entry) => ({ ...entry }));
  }

  async bindUnscoped(scope) {
    const normalized = normalizedScope(scope);
    if (!normalized.ownerSubjectId) return 0;
    const store = await this.readStore();
    let changed = 0;
    store.items = store.items.map((envelope) => {
      const metadata = this.decryptMetadata(envelope);
      if (metadata.ownerSubjectId || metadata.ownerTenantId) return envelope;
      changed += 1;
      return { ...envelope, metadata: this.encryptMetadata({ ...metadata, ...normalized }) };
    });
    if (changed > 0) await this.writeStore(store);
    return changed;
  }

  encryptItem(item) {
    return {
      id: item.id,
      metadata: this.encryptMetadata(item),
      content: this.encryptContent(item)
    };
  }

  encryptMetadata(item) {
    const encrypted = this.encrypt(JSON.stringify(privateMetadata(item)));
    validateCiphertext(encrypted, MAX_ENCRYPTED_METADATA_CHARS, "metadata");
    return encrypted;
  }

  encryptContent(item) {
    const encrypted = this.encrypt(JSON.stringify({
      text: item.kind === "document" ? item.text : "",
      bufferBase64: item.kind === "image" ? item.bufferBase64 : ""
    }));
    validateCiphertext(encrypted, MAX_ENCRYPTED_CONTENT_CHARS, "content");
    return encrypted;
  }

  decryptMetadata(envelope) {
    try {
      validateEnvelope(envelope);
      const item = normalizePrivateMetadata(JSON.parse(this.decrypt(envelope.metadata)));
      if (item.id !== envelope.id) throw new Error("Private memory identity mismatch");
      return item;
    } catch (error) {
      throw new Error(`Could not decrypt private memory ${envelope?.id || "unknown"}: ${error.message}`);
    }
  }

  decryptEnvelope(envelope) {
    try {
      const metadata = this.decryptMetadata(envelope);
      const content = JSON.parse(this.decrypt(envelope.content));
      return normalizePrivateMemory({ ...metadata, ...content });
    } catch (error) {
      if (error.message.startsWith("Could not decrypt private memory")) throw error;
      throw new Error(`Could not decrypt private memory ${envelope?.id || "unknown"}: ${error.message}`);
    }
  }

  async readStore() {
    let value;
    try {
      value = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { version: STORE_VERSION, items: [], journal: [] };
      throw new Error(`Could not read private AMOS memory: ${error.message}`);
    }
    if (value?.version !== STORE_VERSION || !Array.isArray(value.items) || !Array.isArray(value.journal)) {
      throw new Error("Unsupported or corrupted private AMOS memory store");
    }
    return {
      version: STORE_VERSION,
      items: value.items.slice(0, MAX_ITEMS),
      journal: value.journal.slice(-MAX_JOURNAL_ENTRIES)
    };
  }

  async writeStore(store) {
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = {
      version: STORE_VERSION,
      items: store.items,
      journal: store.journal.slice(-MAX_JOURNAL_ENTRIES)
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }
}

function normalizePrivateMemory(input) {
  const metadata = normalizePrivateMetadata(input);
  const kind = metadata.kind;
  const text = kind === "document" ? String(input.text || "") : "";
  const bufferBase64 = kind === "image"
    ? String(input.bufferBase64 || (Buffer.isBuffer(input.buffer) ? input.buffer.toString("base64") : ""))
    : "";
  if (kind === "document" && !text) throw new Error("Private document memory requires extracted text");
  if (kind === "image" && !bufferBase64) throw new Error("Private image memory requires image bytes");
  return { ...metadata, text, bufferBase64 };
}

function normalizePrivateMetadata(input) {
  const kind = input.kind === "image" ? "image" : "document";
  if (!/^[a-f0-9]{64}$/i.test(String(input.sha256 || ""))) {
    throw new Error("Private memory requires a SHA-256 content hash");
  }
  return {
    id: clean(input.id, 128),
    memoryClass: "private",
    authority: "user",
    visibility: "private",
    name: clean(input.name, 240) || "Private memory",
    mime: clean(input.mime, 256) || "text/plain",
    kind,
    size: nonNegativeNumber(input.size),
    sha256: String(input.sha256).toLowerCase(),
    source: clean(input.source || "amos-desktop", 128),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
    promotedAt: input.promotedAt ? timestamp(input.promotedAt) : null,
    companyResult: boundedJsonValue(input.companyResult),
    ownerSubjectId: clean(input.ownerSubjectId, 256),
    ownerTenantId: clean(input.ownerTenantId, 256),
    lineage: normalizeLineage(input.lineage)
  };
}

function privateMetadata(item) {
  const { text: _text, bufferBase64: _bufferBase64, ...metadata } = item;
  return metadata;
}

function publicMemory(item) {
  return {
    id: item.id,
    memoryClass: "private",
    authority: "user",
    visibility: "private",
    name: item.name,
    mime: item.mime,
    kind: item.kind,
    size: item.size,
    sha256: item.sha256,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    promotedAt: item.promotedAt,
    companyResult: item.companyResult,
    lineage: item.lineage
  };
}

function normalizedScope(scope) {
  if (!scope) return { ownerSubjectId: "", ownerTenantId: "" };
  return {
    ownerSubjectId: clean(scope.ownerSubjectId, 256),
    ownerTenantId: clean(scope.ownerTenantId, 256)
  };
}

function scopeMatches(item, scope) {
  if (!scope) return true;
  const normalized = normalizedScope(scope);
  return Boolean(
    normalized.ownerSubjectId &&
    item.ownerSubjectId === normalized.ownerSubjectId &&
    item.ownerTenantId === normalized.ownerTenantId
  );
}

function normalizeLineage(value) {
  if (!value) return null;
  const lineage = {
    capsuleId: clean(value.capsuleId, 128),
    parentCapsuleId: value.parentCapsuleId ? clean(value.parentCapsuleId, 128) : null,
    sourceMemoryId: clean(value.sourceMemoryId, 128),
    sourceCreatedAt: timestamp(value.sourceCreatedAt),
    importedAt: timestamp(value.importedAt)
  };
  if (!lineage.capsuleId || !lineage.sourceMemoryId) {
    throw new Error("Imported private memory requires capsule lineage");
  }
  return lineage;
}

function boundedJsonValue(value) {
  if (value === null || value === undefined) return null;
  const encoded = JSON.stringify(value);
  if (encoded.length > 16_000) return { truncated: true, preview: encoded.slice(0, 16_000) };
  return JSON.parse(encoded);
}

function nonNegativeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Private memory size is invalid");
  return parsed;
}

function timestamp(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Private memory timestamp is invalid");
  return parsed.toISOString();
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function validateEnvelope(envelope) {
  if (typeof envelope?.id !== "string" || !envelope.id) {
    throw new Error("invalid encrypted envelope");
  }
  validateCiphertext(envelope.metadata, MAX_ENCRYPTED_METADATA_CHARS, "metadata");
  validateCiphertext(envelope.content, MAX_ENCRYPTED_CONTENT_CHARS, "content");
}

function validateCiphertext(value, maxLength, label) {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw new Error(`Private memory encryption returned invalid ${label}`);
  }
}

function encryptedEnvelopeSize(envelope) {
  return String(envelope?.metadata || "").length + String(envelope?.content || "").length;
}

export const privateMemoryLimits = Object.freeze({
  maxItems: MAX_ITEMS,
  maxEncryptedStorageBytes: MAX_TOTAL_ENCRYPTED_CHARS
});
