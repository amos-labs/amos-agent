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

  async getOrCreate() {
    const existing = await this.read();
    if (existing) return publicRecord(existing);

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicJwk = publicKey.export({ format: "jwk" });
    const record = {
      id: randomUUID(),
      publicKey: publicJwk.x,
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      createdAt: new Date().toISOString()
    };
    await this.write(record);
    return publicRecord(record);
  }

  async sign(message) {
    if (typeof message !== "string" || message.length === 0 || message.length > 4_096) {
      throw new Error("AMOS returned an invalid Desktop approval challenge");
    }
    const record = await this.read();
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

  async read() {
    try {
      const encrypted = await readFile(this.filePath, "utf8");
      const plaintext = await this.decrypt(encrypted);
      const record = JSON.parse(plaintext);
      if (
        !/^[0-9a-f-]{36}$/i.test(record?.id || "") ||
        typeof record?.publicKey !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(record.publicKey) ||
        typeof record?.privateKey !== "string" ||
        !record.privateKey.includes("PRIVATE KEY")
      ) {
        throw new Error("invalid Desktop approval key record");
      }
      return record;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new Error("Desktop approval key could not be decrypted");
    }
  }

  async write(record) {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const encrypted = await this.encrypt(JSON.stringify(record));
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, encrypted, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

function publicRecord(record) {
  return {
    id: record.id,
    publicKey: record.publicKey,
    createdAt: record.createdAt
  };
}
