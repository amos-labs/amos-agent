import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt
} from "node:crypto";
import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  CAPSULE_FORMAT,
  CAPSULE_VERSION,
  createCapsuleManifest,
  validateCapsuleManifest
} from "./memoryContract.js";
import {
  normalizePortableScratchpads,
  PORTABLE_SCRATCHPAD_KIND
} from "../model/conversationScratchpad.js";

export const ENCRYPTED_CAPSULE_FORMAT = "amos-encrypted-memory-capsule";
export const ENCRYPTED_CAPSULE_VERSION = "1";
export const MEMORY_CAPSULE_EXTENSION = "amos-memory";

const deriveKey = promisify(scrypt);
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const MAX_CAPSULE_BYTES = 256 * 1024 * 1024;
const MAX_MEMORIES = 250;
const MIN_PASSPHRASE_LENGTH = 12;
const MAX_PASSPHRASE_LENGTH = 1_024;

export async function writePrivateMemoryCapsule({
  filePath,
  passphrase,
  subjectId,
  tenantId = null,
  memories,
  scratchpads = [],
  journal = [],
  parentCapsuleId = null,
  now = new Date(),
  capsuleId = randomUUID()
}) {
  if (!filePath) throw new Error("Choose where to save the AMOS memory capsule");
  const secret = validPassphrase(passphrase);
  const records = normalizePrivateRecords(memories || []);
  const portableScratchpads = withScratchpadSizes(normalizePortableScratchpads(scratchpads));
  if (records.length === 0 && portableScratchpads.length === 0) {
    throw new Error("Choose at least one private memory to export");
  }
  if (records.length > MAX_MEMORIES) {
    throw new Error(`AMOS memory capsules support up to ${MAX_MEMORIES} private items`);
  }

  const createdAt = timestamp(now);
  const recordById = new Map(records.map((record) => [record.id, record]));
  const manifest = createCapsuleManifest({
    capsuleId,
    subjectId: clean(subjectId, 256) || "local-owner",
    tenantId,
    createdAt,
    parentCapsuleId,
    entries: [
      ...records.map((record) => ({
        id: record.id,
        memory_class: "private",
        source_id: record.id,
        content_hash: portableRecordHash(record),
        media_type: record.mime,
        created_at: record.createdAt,
        refreshed_at: record.updatedAt,
        visibility: "private",
        allowed_use: "context"
      })),
      ...portableScratchpads.map((record) => ({
        id: record.id,
        memory_class: "private",
        source_id: record.taskId,
        content_hash: portableRecordHash(portableScratchpadHashBody(record)),
        media_type: "application/json",
        created_at: record.updatedAt || createdAt,
        refreshed_at: record.updatedAt || createdAt,
        visibility: "private",
        allowed_use: PORTABLE_SCRATCHPAD_KIND
      }))
    ],
    journal: journal.filter((entry) => recordById.has(entry?.memory_id))
  });
  const plaintext = Buffer.from(JSON.stringify({
    format: CAPSULE_FORMAT,
    version: CAPSULE_VERSION,
    manifest,
    private_records: records,
    conversation_scratchpads: portableScratchpads.map(portableScratchpadHashBody)
  }), "utf8");
  if (plaintext.length > MAX_CAPSULE_BYTES) {
    throw new Error("This private-memory selection is too large for one portable capsule");
  }

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveCapsuleKey(secret, salt);
  const header = {
    format: ENCRYPTED_CAPSULE_FORMAT,
    version: ENCRYPTED_CAPSULE_VERSION,
    created_at: createdAt,
    capsule_id: manifest.capsule_id,
    kdf: {
      name: "scrypt",
      salt: salt.toString("base64"),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      key_bytes: KEY_BYTES
    },
    cipher: {
      name: "AES-256-GCM",
      iv: iv.toString("base64")
    }
  };
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    ...header,
    cipher: {
      ...header.cipher,
      auth_tag: cipher.getAuthTag().toString("base64")
    },
    ciphertext: ciphertext.toString("base64")
  };
  const serialized = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  if (serialized.length > MAX_CAPSULE_BYTES) {
    throw new Error("The encrypted AMOS memory capsule exceeds the portable size limit");
  }
  await atomicPrivateWrite(filePath, serialized);
  return capsuleSummary(manifest, records, portableScratchpads, serialized.length, filePath);
}

export async function readPrivateMemoryCapsule({ filePath, passphrase }) {
  if (!filePath) throw new Error("Choose an AMOS memory capsule to import");
  const secret = validPassphrase(passphrase);
  const details = await stat(filePath);
  if (!details.isFile() || details.size <= 0 || details.size > MAX_CAPSULE_BYTES) {
    throw new Error("That AMOS memory capsule is empty or exceeds the portable size limit");
  }

  let envelope;
  try {
    envelope = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("That file is not a valid AMOS memory capsule");
  }
  const header = validateEncryptedEnvelope(envelope);
  const salt = decodeSizedBase64(header.kdf.salt, SALT_BYTES, "capsule salt");
  const iv = decodeSizedBase64(header.cipher.iv, IV_BYTES, "capsule IV");
  const authTag = decodeSizedBase64(envelope.cipher.auth_tag, 16, "capsule authentication tag");
  const ciphertext = decodeBoundedBase64(envelope.ciphertext, MAX_CAPSULE_BYTES, "capsule ciphertext");
  const key = await deriveCapsuleKey(secret, salt);

  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(JSON.stringify(header), "utf8"));
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("AMOS could not unlock this capsule. Check the passphrase or use an unmodified file.");
  }

  let payload;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("The decrypted AMOS memory capsule is corrupted");
  }
  if (payload?.format !== CAPSULE_FORMAT || payload?.version !== CAPSULE_VERSION) {
    throw new Error("Unsupported AMOS memory capsule payload");
  }
  validateCapsuleManifest(payload.manifest);
  if (
    payload.manifest.capsule_id !== envelope.capsule_id ||
    payload.manifest.created_at !== envelope.created_at
  ) {
    throw new Error("AMOS memory capsule header does not match its protected manifest");
  }
  if (payload.manifest.expires_at && Date.parse(payload.manifest.expires_at) <= Date.now()) {
    throw new Error("This AMOS memory capsule has expired");
  }

  const records = normalizePrivateRecords(payload.private_records || []);
  const portableScratchpads = withScratchpadSizes(
    normalizePortableScratchpads(payload.conversation_scratchpads)
  );
  if (records.length + portableScratchpads.length !== payload.manifest.entries.length) {
    throw new Error("AMOS memory capsule content does not match its manifest");
  }
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const scratchpadsById = new Map(portableScratchpads.map((record) => [record.id, record]));
  for (const entry of payload.manifest.entries) {
    if (entry.memory_class !== "private") {
      throw new Error("This Desktop release imports private memory only");
    }
    const record = recordsById.get(entry.id);
    const scratchpad = scratchpadsById.get(entry.id);
    const portable = record || (scratchpad ? portableScratchpadHashBody(scratchpad) : null);
    if (!portable || portableRecordHash(portable) !== entry.content_hash) {
      throw new Error(`AMOS memory capsule failed integrity validation for ${entry.id}`);
    }
  }
  return {
    manifest: payload.manifest,
    records,
    scratchpads: portableScratchpads,
    summary: capsuleSummary(payload.manifest, records, portableScratchpads, details.size, filePath)
  };
}

function normalizePrivateRecords(memories) {
  if (!Array.isArray(memories)) throw new Error("AMOS memory capsules require private-memory records");
  const ids = new Set();
  return memories.map((memory) => {
    if (memory?.memoryClass && memory.memoryClass !== "private") {
      throw new Error("Only private memory can be exported without a live AMOS policy decision");
    }
    const record = {
      id: clean(memory?.id, 128),
      name: clean(memory?.name, 240) || "Private memory",
      mime: clean(memory?.mime, 256) || "text/plain",
      kind: memory?.kind === "image" ? "image" : "document",
      size: boundedNumber(memory?.size),
      sha256: sha256(memory?.sha256),
      source: clean(memory?.source || "amos-desktop", 128),
      createdAt: timestamp(memory?.createdAt),
      updatedAt: timestamp(memory?.updatedAt),
      text: memory?.kind === "image" ? "" : String(memory?.text || ""),
      bufferBase64: memory?.kind === "image" ? validImageBase64(memory?.bufferBase64) : ""
    };
    if (!record.id) throw new Error("Private memory requires an ID before capsule export");
    if (ids.has(record.id)) throw new Error(`Duplicate private-memory ID: ${record.id}`);
    ids.add(record.id);
    if (record.kind === "document" && !record.text) {
      throw new Error(`Private document ${record.name} has no portable content`);
    }
    return record;
  });
}

function portableRecordHash(record) {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function capsuleSummary(manifest, records, scratchpads = [], bytes, filePath) {
  const pads = Array.isArray(scratchpads) ? scratchpads : [];
  return {
    capsuleId: manifest.capsule_id,
    parentCapsuleId: manifest.parent_capsule_id,
    subjectId: manifest.subject_id,
    tenantId: manifest.tenant_id,
    createdAt: manifest.created_at,
    itemCount: records.length + pads.length,
    memoryCount: records.length,
    scratchpadCount: pads.length,
    totalBytes: records.reduce((total, record) => total + record.size, 0)
      + pads.reduce((total, record) => total + (record.size || 0), 0),
    encryptedBytes: bytes,
    filePath,
    items: [
      ...records.map((record) => ({
        id: record.id,
        name: record.name,
        kind: record.kind,
        mime: record.mime,
        size: record.size,
        updatedAt: record.updatedAt
      })),
      ...pads.map((record) => ({
        id: record.id,
        name: record.title,
        kind: PORTABLE_SCRATCHPAD_KIND,
        mime: "application/json",
        size: record.size || 0,
        updatedAt: record.updatedAt
      }))
    ]
  };
}

function portableScratchpadHashBody(record) {
  return {
    id: record.id,
    kind: PORTABLE_SCRATCHPAD_KIND,
    taskId: record.taskId,
    contextKey: record.contextKey,
    title: record.title,
    objective: record.objective,
    scratchpad: record.scratchpad,
    updatedAt: record.updatedAt
  };
}

function withScratchpadSizes(records) {
  return records.map((record) => ({
    ...record,
    size: Buffer.byteLength(JSON.stringify(portableScratchpadHashBody(record)), "utf8")
  }));
}

function validateEncryptedEnvelope(value) {
  if (
    value?.format !== ENCRYPTED_CAPSULE_FORMAT ||
    value?.version !== ENCRYPTED_CAPSULE_VERSION
  ) {
    throw new Error("Unsupported encrypted AMOS memory capsule");
  }
  if (
    value?.kdf?.name !== "scrypt" ||
    value.kdf.N !== SCRYPT_N ||
    value.kdf.r !== SCRYPT_R ||
    value.kdf.p !== SCRYPT_P ||
    value.kdf.key_bytes !== KEY_BYTES ||
    value?.cipher?.name !== "AES-256-GCM"
  ) {
    throw new Error("Unsupported AMOS memory capsule encryption parameters");
  }
  const createdAt = timestamp(value.created_at);
  const capsuleId = clean(value.capsule_id, 128);
  if (!capsuleId) throw new Error("Encrypted AMOS memory capsules require a capsule ID");
  return {
    format: ENCRYPTED_CAPSULE_FORMAT,
    version: ENCRYPTED_CAPSULE_VERSION,
    created_at: createdAt,
    capsule_id: capsuleId,
    kdf: {
      name: "scrypt",
      salt: clean(value.kdf.salt, 128),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      key_bytes: KEY_BYTES
    },
    cipher: {
      name: "AES-256-GCM",
      iv: clean(value.cipher.iv, 128)
    }
  };
}

async function deriveCapsuleKey(passphrase, salt) {
  return deriveKey(passphrase, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY
  });
}

async function atomicPrivateWrite(filePath, payload) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, payload, { mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => {});
  await rename(temporary, filePath);
  await chmod(filePath, 0o600).catch(() => {});
}

function validPassphrase(value) {
  const passphrase = String(value || "");
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Use a capsule passphrase with at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
    throw new Error("That capsule passphrase is too long");
  }
  return passphrase;
}

function decodeSizedBase64(value, size, label) {
  const buffer = decodeBoundedBase64(value, size, label);
  if (buffer.length !== size) throw new Error(`Invalid ${label}`);
  return buffer;
}

function decodeBoundedBase64(value, maxBytes, label) {
  const encoded = String(value || "");
  if (!encoded || encoded.length > Math.ceil(maxBytes * 4 / 3) + 8) {
    throw new Error(`Invalid ${label}`);
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0 || buffer.length > maxBytes) throw new Error(`Invalid ${label}`);
  return buffer;
}

function validImageBase64(value) {
  const encoded = String(value || "");
  if (!encoded) throw new Error("Private image memory requires portable image bytes");
  decodeBoundedBase64(encoded, MAX_CAPSULE_BYTES, "private image content");
  return encoded;
}

function sha256(value) {
  const hash = clean(value, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Private memory requires a SHA-256 source hash");
  return hash;
}

function timestamp(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("AMOS memory capsule contains an invalid timestamp");
  return parsed.toISOString();
}

function boundedNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_CAPSULE_BYTES) {
    throw new Error("Private-memory size is invalid");
  }
  return parsed;
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export const memoryCapsuleLimits = Object.freeze({
  maxCapsuleBytes: MAX_CAPSULE_BYTES,
  maxMemories: MAX_MEMORIES,
  minimumPassphraseLength: MIN_PASSPHRASE_LENGTH
});
