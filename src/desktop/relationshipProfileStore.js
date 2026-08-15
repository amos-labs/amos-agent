import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  emptyRelationshipProfile,
  normalizeRelationshipProfile,
  removeExplicitPreference,
  setExplicitPreference
} from "./relationshipProfile.js";

const STORE_VERSION = 1;
const MAX_RECORDS = 24;
const MAX_STORE_CHARS = 512 * 1024;

export class RelationshipProfileStore {
  constructor({ filePath, encrypt, decrypt, now = () => new Date() }) {
    if (!filePath) throw new Error("Collaboration profile requires a storage path");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Collaboration profile requires operating-system encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.now = now;
    this.mutationQueue = Promise.resolve();
  }

  async load(scope) {
    const key = profileOwnerKey(scope);
    const store = await this.readStore();
    const record = store.records.find((item) => item.key === key);
    return record
      ? normalizeRelationshipProfile(record.profile, { now: this.now })
      : emptyRelationshipProfile({ now: this.now });
  }

  async setPreference(scope, key, value, { expectedRevision = null } = {}) {
    return this.mutate(scope, (profile) => setExplicitPreference(profile, key, value, {
      now: this.now
    }), expectedRevision);
  }

  async clearPreference(scope, key, { expectedRevision = null } = {}) {
    return this.mutate(scope, (profile) => removeExplicitPreference(profile, key, {
      now: this.now
    }), expectedRevision);
  }

  async reset(scope, { expectedRevision = null } = {}) {
    return this.mutate(scope, (profile) => emptyRelationshipProfile({
      now: this.now,
      revision: profile.revision
    }), expectedRevision);
  }

  async mutate(scope, mutate, expectedRevision) {
    return this.enqueueMutation(async () => {
      const key = profileOwnerKey(scope);
      const store = await this.readStore();
      const existing = store.records.find((item) => item.key === key);
      const current = existing
        ? normalizeRelationshipProfile(existing.profile, { now: this.now })
        : emptyRelationshipProfile({ now: this.now });
      if (expectedRevision != null && Number(expectedRevision) !== current.revision) {
        throw new Error(
          `stale collaboration profile revision: expected ${expectedRevision}, found ${current.revision}`
        );
      }
      const next = mutate(current);
      next.revision = current.revision + 1;
      const record = { key, profile: next };
      const records = [
        record,
        ...store.records.filter((item) => item.key !== key)
      ].slice(0, MAX_RECORDS);
      await this.writeStore({ version: STORE_VERSION, records });
      return next;
    });
  }

  enqueueMutation(work) {
    const run = this.mutationQueue.then(work, work);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async readStore() {
    let outer;
    try {
      outer = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { version: STORE_VERSION, records: [] };
      throw new Error(`Could not read collaboration profile: ${error.message}`);
    }
    if (
      outer?.version !== STORE_VERSION ||
      typeof outer.encryptedRecord !== "string" ||
      !outer.encryptedRecord
    ) {
      throw new Error("Unsupported or corrupted collaboration-profile store");
    }
    try {
      const decrypted = JSON.parse(this.decrypt(outer.encryptedRecord));
      if (decrypted?.version !== STORE_VERSION || !Array.isArray(decrypted.records)) {
        throw new Error("invalid store contract");
      }
      return {
        version: STORE_VERSION,
        records: decrypted.records.slice(0, MAX_RECORDS)
      };
    } catch (error) {
      throw new Error(`Could not decrypt collaboration profile: ${error.message}`);
    }
  }

  async writeStore(store) {
    const normalized = {
      version: STORE_VERSION,
      records: store.records
    };
    const encryptedRecord = this.encrypt(JSON.stringify(normalized));
    if (typeof encryptedRecord !== "string" || encryptedRecord.length > MAX_STORE_CHARS) {
      throw new Error("Encrypted collaboration profile exceeds the local storage limit");
    }
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(
      temporary,
      `${JSON.stringify({ version: STORE_VERSION, encryptedRecord }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }
}

export function profileOwnerScope({ identity = null, boundary = "personal" } = {}) {
  const normalizedBoundary = ["online", "personal", "offline"].includes(boundary)
    ? boundary
    : "personal";
  if (normalizedBoundary === "online") {
    const subjectId = String(identity?.sub || identity?.user?.id || "").trim();
    const tenantId = String(identity?.tenant_id || "").trim();
    if (!subjectId || !tenantId) {
      throw new Error("Company collaboration profile requires the signed-in user and tenant");
    }
    return { boundary: "online", subjectId, tenantId };
  }
  return { boundary: normalizedBoundary, subjectId: "local-user", tenantId: normalizedBoundary };
}

export function profileOwnerKey(scope) {
  if (scope?.subjectId && scope?.tenantId) {
    const boundary = ["online", "personal", "offline"].includes(scope.boundary)
      ? scope.boundary
      : "personal";
    return `${boundary}:${scope.subjectId}:${scope.tenantId}`;
  }
  const normalized = profileOwnerScope(scope);
  return `${normalized.boundary}:${normalized.subjectId}:${normalized.tenantId}`;
}
