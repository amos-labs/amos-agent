import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { clean } from "../util/validate.js";

const ACCOUNT_STORE_VERSION = 1;

export class FileTokenStore {
  constructor(filePath) {
    if (!filePath) throw new Error("OAuth credential path is required");
    this.filePath = filePath;
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const value = JSON.parse(raw);
      return value?.version === 1 ? value : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error(`Could not read AMOS OAuth credentials: ${error.message}`);
    }
  }

  async write(credentials) {
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(temporary, `${JSON.stringify({ ...credentials, version: 1 }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }

  async clear() {
    await rm(this.filePath, { force: true });
  }
}

export class MemoryTokenStore {
  constructor(value = null) {
    this.value = value;
  }

  async read() {
    return this.value ? structuredClone(this.value) : null;
  }

  async write(credentials) {
    this.value = structuredClone(credentials);
  }

  async clear() {
    this.value = null;
  }
}

// Desktop keeps independently authenticated AMOS accounts local. The Platform
// never receives this index and therefore cannot infer that two accounts are
// present on the same computer. Each complete OAuth record is sealed with
// Electron safeStorage before it is written to disk.
export class DesktopAccountStore {
  constructor({ filePath, encrypt, decrypt, legacyFilePath = "" }) {
    if (!filePath) throw new Error("Desktop account path is required");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Desktop account storage requires operating-system encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.legacyFilePath = legacyFilePath;
  }

  async initialize() {
    const current = await this.readEnvelope();
    if (current.accounts.length > 0 || !this.legacyFilePath) return;
    let legacy = null;
    try {
      legacy = JSON.parse(await readFile(this.legacyFilePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Could not migrate the existing AMOS sign-in: ${error.message}`);
      }
    }
    if (!legacy?.access_token) return;
    await this.add(legacy, { label: legacy.demo ? "Northwind Labs demo" : "AMOS account" });
    await rm(this.legacyFilePath, { force: true });
  }

  async read() {
    const envelope = await this.readEnvelope();
    const account = envelope.accounts.find((item) => item.id === envelope.activeAccountId);
    return account ? this.open(account).credentials : null;
  }

  async write(credentials) {
    const envelope = await this.readEnvelope();
    const index = envelope.accounts.findIndex((item) => item.id === envelope.activeAccountId);
    if (index < 0) {
      await this.add(credentials);
      return;
    }
    const current = this.open(envelope.accounts[index]);
    envelope.accounts[index] = this.seal({
      ...current,
      credentials: structuredClone(credentials),
      lastUsedAt: new Date().toISOString()
    }, envelope.accounts[index].id);
    await this.writeEnvelope(envelope);
  }

  async clear() {
    const envelope = await this.readEnvelope();
    if (!envelope.activeAccountId) return;
    envelope.accounts = envelope.accounts.filter((item) => item.id !== envelope.activeAccountId);
    envelope.activeAccountId = newestAccountId(envelope.accounts, (item) => this.open(item));
    await this.writeEnvelope(envelope);
  }

  async add(credentials, profile = {}) {
    if (!credentials?.access_token) throw new Error("An AMOS account requires an OAuth session");
    const envelope = await this.readEnvelope();
    const id = randomUUID();
    const now = new Date().toISOString();
    envelope.accounts.push(this.seal({
      credentials: structuredClone(credentials),
      profile: sanitizeProfile(profile),
      createdAt: now,
      lastUsedAt: now
    }, id));
    envelope.activeAccountId = id;
    await this.writeEnvelope(envelope);
    return id;
  }

  async activate(accountId) {
    const envelope = await this.readEnvelope();
    const index = envelope.accounts.findIndex((item) => item.id === accountId);
    if (index < 0) throw new Error("That AMOS account is not available on this computer");
    const record = this.open(envelope.accounts[index]);
    record.lastUsedAt = new Date().toISOString();
    envelope.accounts[index] = this.seal(record, accountId);
    envelope.activeAccountId = accountId;
    await this.writeEnvelope(envelope);
  }

  async remove(accountId) {
    const envelope = await this.readEnvelope();
    if (!envelope.accounts.some((item) => item.id === accountId)) return false;
    envelope.accounts = envelope.accounts.filter((item) => item.id !== accountId);
    if (envelope.activeAccountId === accountId) {
      envelope.activeAccountId = newestAccountId(envelope.accounts, (item) => this.open(item));
    }
    await this.writeEnvelope(envelope);
    return true;
  }

  async updateActiveProfile(identity) {
    const envelope = await this.readEnvelope();
    const index = envelope.accounts.findIndex((item) => item.id === envelope.activeAccountId);
    if (index < 0) return;
    const record = this.open(envelope.accounts[index]);
    record.profile = sanitizeProfile({
      subjectId: identity?.user?.id || identity?.subject_id || identity?.sub,
      name: identity?.user?.name,
      email: identity?.user?.email,
      tenantId: identity?.tenant_id,
      tenantSlug: identity?.tenant_slug,
      role: identity?.role,
      label: identity?.user?.name || identity?.user?.email || identity?.tenant_slug
    });
    envelope.accounts[index] = this.seal(record, envelope.activeAccountId);
    if (record.profile.subjectId && record.profile.tenantId) {
      envelope.accounts = envelope.accounts.filter((item) => {
        if (item.id === envelope.activeAccountId) return true;
        const candidate = this.open(item).profile || {};
        return candidate.subjectId !== record.profile.subjectId || candidate.tenantId !== record.profile.tenantId;
      });
    }
    await this.writeEnvelope(envelope);
  }

  async list() {
    const envelope = await this.readEnvelope();
    return {
      currentAccountId: envelope.activeAccountId,
      accounts: envelope.accounts.map((item) => {
        const record = this.open(item);
        const profile = sanitizeProfile(record.profile);
        return {
          id: item.id,
          label: profile.label,
          name: profile.name,
          email: profile.email,
          tenantId: profile.tenantId,
          tenantSlug: profile.tenantSlug,
          role: profile.role,
          demo: Boolean(record.credentials?.demo),
          lastUsedAt: record.lastUsedAt || null
        };
      })
    };
  }

  async activeScope() {
    const envelope = await this.readEnvelope();
    const account = envelope.accounts.find((item) => item.id === envelope.activeAccountId);
    if (!account) return null;
    const profile = sanitizeProfile(this.open(account).profile);
    if (!profile.subjectId || !profile.tenantId) return null;
    return {
      ownerSubjectId: profile.subjectId,
      ownerTenantId: profile.tenantId
    };
  }

  seal(record, id) {
    return { id, encryptedRecord: this.encrypt(JSON.stringify(record)) };
  }

  open(item) {
    try {
      const record = JSON.parse(this.decrypt(item.encryptedRecord));
      if (!record?.credentials || !record.createdAt) throw new Error("incomplete record");
      return record;
    } catch (error) {
      throw new Error(`Could not decrypt an AMOS account: ${error.message}`);
    }
  }

  async readEnvelope() {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8"));
      if (value?.version !== ACCOUNT_STORE_VERSION || !Array.isArray(value.accounts)) {
        throw new Error("unsupported account-store version");
      }
      return {
        version: ACCOUNT_STORE_VERSION,
        activeAccountId: String(value.activeAccountId || ""),
        accounts: value.accounts.filter(
          (item) => typeof item?.id === "string" && typeof item?.encryptedRecord === "string"
        )
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { version: ACCOUNT_STORE_VERSION, activeAccountId: "", accounts: [] };
      }
      throw new Error(`Could not read AMOS Desktop accounts: ${error.message}`);
    }
  }

  async writeEnvelope(envelope) {
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(temporary, `${JSON.stringify({
      version: ACCOUNT_STORE_VERSION,
      activeAccountId: envelope.activeAccountId || "",
      accounts: envelope.accounts
    }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }
}

function sanitizeProfile(value = {}) {
  return {
    subjectId: clean(value.subjectId, 256),
    label: clean(value.label, 160) || clean(value.name, 160) || clean(value.email, 320) || "AMOS account",
    name: clean(value.name, 160),
    email: clean(value.email, 320),
    tenantId: clean(value.tenantId, 128),
    tenantSlug: clean(value.tenantSlug, 160),
    role: clean(value.role, 80)
  };
}


function newestAccountId(accounts, open) {
  return accounts
    .map((item) => ({ id: item.id, at: Date.parse(open(item).lastUsedAt || 0) || 0 }))
    .sort((left, right) => right.at - left.at)[0]?.id || "";
}
