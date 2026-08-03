import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;
const MAX_RECEIPTS = 500;

export class LocalReceiptStore {
  constructor({
    filePath,
    encrypt,
    decrypt,
    now = () => new Date(),
    createId = randomUUID
  }) {
    if (!filePath) throw new Error("Local receipts require a storage path");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Local receipts require operating-system encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.now = now;
    this.createId = createId;
  }

  async list(scope = null) {
    const store = await this.readStore();
    return store.receipts
      .map((envelope) => {
        const receipt = JSON.parse(this.decrypt(envelope.payload));
        if (receipt.id !== envelope.id || receipt.digest !== envelope.digest) {
          throw new Error("local receipt envelope does not match its encrypted content");
        }
        return receipt;
      })
      .filter((receipt) => scopeMatches(receipt, scope))
      .map(publicReceipt)
      .reverse();
  }

  async add(input, scope = null) {
    const store = await this.readStore();
    const receipt = normalizeReceipt({
      ...input,
      ...normalizedScope(scope),
      id: this.createId(),
      recordedAt: this.now().toISOString()
    });
    receipt.digest = createHash("sha256")
      .update(JSON.stringify({ ...receipt, digest: undefined }))
      .digest("hex");
    store.receipts.push({
      id: receipt.id,
      recordedAt: receipt.recordedAt,
      digest: receipt.digest,
      payload: this.encrypt(JSON.stringify(receipt))
    });
    store.receipts = store.receipts.slice(-MAX_RECEIPTS);
    await this.writeStore(store);
    return publicReceipt(receipt);
  }

  async bindUnscoped(scope) {
    const normalized = normalizedScope(scope);
    if (!normalized.ownerSubjectId) return 0;
    const store = await this.readStore();
    let changed = 0;
    store.receipts = store.receipts.map((envelope) => {
      const receipt = JSON.parse(this.decrypt(envelope.payload));
      if (receipt.ownerSubjectId || receipt.ownerTenantId) return envelope;
      changed += 1;
      const updated = { ...receipt, ...normalized };
      updated.digest = createHash("sha256")
        .update(JSON.stringify({ ...updated, digest: undefined }))
        .digest("hex");
      return {
        ...envelope,
        digest: updated.digest,
        payload: this.encrypt(JSON.stringify(updated))
      };
    });
    if (changed > 0) await this.writeStore(store);
    return changed;
  }

  async readStore() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed?.version !== VERSION || !Array.isArray(parsed.receipts)) {
        throw new Error("unsupported receipt format");
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return { version: VERSION, receipts: [] };
      throw new Error(`Could not read local AMOS receipts: ${error.message}`);
    }
  }

  async writeStore(store) {
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }
}

function normalizeReceipt(input) {
  const status = ["completed", "failed", "canceled"].includes(input.status)
    ? input.status
    : "failed";
  return {
    id: String(input.id),
    taskId: String(input.taskId || "").slice(0, 128),
    status,
    boundary: ["online", "personal", "offline"].includes(input.boundary)
      ? input.boundary
      : "personal",
    workspace: String(input.workspace || "").slice(0, 256),
    model: String(input.model || "").slice(0, 256),
    objective: String(input.objective || "").slice(0, 500),
    startedAt: String(input.startedAt || ""),
    finishedAt: String(input.finishedAt || ""),
    events: Array.isArray(input.events)
      ? input.events.slice(0, 200).map((event) => ({
          type: String(event.type || "").slice(0, 80),
          name: String(event.name || "").slice(0, 160),
          outcome: String(event.outcome || "").slice(0, 160)
        }))
      : [],
    error: input.error ? String(input.error).slice(0, 1_000) : null,
    ownerSubjectId: clean(input.ownerSubjectId, 256),
    ownerTenantId: clean(input.ownerTenantId, 256),
    recordedAt: String(input.recordedAt),
    digest: ""
  };
}

function normalizedScope(scope) {
  return {
    ownerSubjectId: clean(scope?.ownerSubjectId, 256),
    ownerTenantId: clean(scope?.ownerTenantId, 256)
  };
}

function scopeMatches(receipt, scope) {
  if (!scope) return true;
  const normalized = normalizedScope(scope);
  return Boolean(
    normalized.ownerSubjectId &&
    receipt.ownerSubjectId === normalized.ownerSubjectId &&
    receipt.ownerTenantId === normalized.ownerTenantId
  );
}

function publicReceipt(receipt) {
  const { ownerSubjectId: _ownerSubjectId, ownerTenantId: _ownerTenantId, ...value } = receipt;
  return value;
}

function clean(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
