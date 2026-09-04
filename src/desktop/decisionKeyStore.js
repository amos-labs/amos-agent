import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign as signMessage
} from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class DecisionKeyStore {
  constructor({ filePath, encrypt, decrypt }) {
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
  }

  async getOrCreate(keyId = "") {
    const existing = await this.read(keyId);
    if (existing) return publicRecord(existing);

    return this.create();
  }

  async create() {
    const envelope = await this.readEnvelope();

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicJwk = publicKey.export({ format: "jwk" });
    const record = {
      id: randomUUID(),
      publicKey: publicJwk.x,
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      createdAt: new Date().toISOString()
    };
    envelope.keys.push(record);
    envelope.activeKeyId = record.id;
    await this.writeEnvelope(envelope);
    return publicRecord(record);
  }

  async getDefault() {
    const envelope = await this.readEnvelope();
    const existing = envelope.keys[0];
    return existing ? publicRecord(existing) : this.create();
  }

  async activate(keyId) {
    const envelope = await this.readEnvelope();
    if (!envelope.keys.some((record) => record.id === keyId)) {
      throw new Error("Desktop approval key is unavailable; reconnect this account");
    }
    envelope.activeKeyId = keyId;
    await this.writeEnvelope(envelope);
  }

  async sign(message, keyId = "") {
    if (typeof message !== "string" || message.length === 0 || message.length > 4_096) {
      throw new Error("AMOS returned an invalid Desktop approval challenge");
    }
    const record = await this.read(keyId);
    if (!record) throw new Error("Desktop approval key is unavailable; reconnect AMOS");
    const signature = signMessage(
      null,
      Buffer.from(message, "utf8"),
      createPrivateKey(record.privateKey)
    );
    return signature.toString("base64url");
  }

  async clear() {
    await rm(this.filePath, { force: true });
  }

  async remove(keyId) {
    const envelope = await this.readEnvelope();
    const next = envelope.keys.filter((record) => record.id !== keyId);
    if (next.length === envelope.keys.length) return false;
    if (next.length === 0) {
      await this.clear();
      return true;
    }
    envelope.keys = next;
    if (envelope.activeKeyId === keyId) envelope.activeKeyId = next[0].id;
    await this.writeEnvelope(envelope);
    return true;
  }

  async read(keyId = "") {
    const envelope = await this.readEnvelope();
    return envelope.keys.find((record) => record.id === (keyId || envelope.activeKeyId)) || null;
  }

  async readEnvelope() {
    try {
      const encrypted = await readFile(this.filePath, "utf8");
      const plaintext = await this.decrypt(encrypted);
      const stored = JSON.parse(plaintext);
      const envelope = stored?.version === 2 && Array.isArray(stored.keys)
        ? stored
        : { version: 2, activeKeyId: stored?.id || "", keys: stored?.id ? [stored] : [] };
      if (envelope.keys.some((record) => !validRecord(record))) {
        throw new Error("invalid Desktop approval key record");
      }
      if (envelope.keys.length > 0 && !envelope.keys.some((record) => record.id === envelope.activeKeyId)) {
        throw new Error("invalid active Desktop approval key");
      }
      return {
        version: 2,
        activeKeyId: envelope.activeKeyId || "",
        keys: envelope.keys
      };
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 2, activeKeyId: "", keys: [] };
      throw new Error("Desktop approval key could not be decrypted");
    }
  }

  async writeEnvelope(envelope) {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const encrypted = await this.encrypt(JSON.stringify({
      version: 2,
      activeKeyId: envelope.activeKeyId,
      keys: envelope.keys
    }));
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, encrypted, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

function validRecord(record) {
  return /^[0-9a-f-]{36}$/i.test(record?.id || "") &&
    typeof record?.publicKey === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(record.publicKey) &&
    typeof record?.privateKey === "string" &&
    record.privateKey.includes("PRIVATE KEY");
}

function publicRecord(record) {
  return {
    id: record.id,
    publicKey: record.publicKey,
    createdAt: record.createdAt
  };
}
