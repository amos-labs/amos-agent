import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;
const MAX_VIEWS = 50;

export class SavedViewStore {
  constructor({
    filePath,
    encrypt,
    decrypt,
    now = () => new Date(),
    createId = randomUUID
  }) {
    if (!filePath) throw new Error("Saved views require a storage path");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Saved views require operating-system encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.now = now;
    this.createId = createId;
  }

  async list(identity) {
    const owner = normalizeOwner(identity);
    if (!owner) return [];
    const store = await this.readStore();
    return store.views
      .map((envelope) => this.decryptView(envelope))
      .filter((view) => sameOwner(view.owner, owner))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(publicView);
  }

  async save(input, identity) {
    const owner = normalizeOwner(identity);
    if (!owner) throw new Error("Connect your AMOS company before saving a briefing");
    const prompt = boundedText(input?.prompt, "A saved briefing needs a refresh instruction", 500);
    const title = boundedText(input?.title, "A saved briefing needs a title", 160);
    const store = await this.readStore();
    const now = this.now().toISOString();
    const existingIndex = store.views.findIndex((envelope) => {
      const view = this.decryptView(envelope);
      return sameOwner(view.owner, owner) && view.prompt === prompt;
    });
    const current = existingIndex >= 0 ? this.decryptView(store.views[existingIndex]) : null;
    const view = {
      id: current?.id || this.createId(),
      title,
      prompt,
      sourceKind: ["live", "cached", "private", "local"].includes(input?.sourceKind)
        ? input.sourceKind
        : "live",
      owner,
      createdAt: current?.createdAt || now,
      updatedAt: now
    };
    const envelope = {
      id: view.id,
      subjectId: owner.subjectId,
      tenantId: owner.tenantId,
      payload: this.encrypt(JSON.stringify(view))
    };
    if (existingIndex >= 0) {
      store.views[existingIndex] = envelope;
    } else {
      if (store.views.length >= MAX_VIEWS) {
        throw new Error(`AMOS Desktop keeps up to ${MAX_VIEWS} saved briefings`);
      }
      store.views.push(envelope);
    }
    await this.writeStore(store);
    return publicView(view);
  }

  async remove(id, identity) {
    const owner = normalizeOwner(identity);
    if (!owner) throw new Error("Connect the AMOS company that owns this briefing");
    const store = await this.readStore();
    const index = store.views.findIndex((envelope) => envelope.id === id);
    if (index < 0) return false;
    const view = this.decryptView(store.views[index]);
    if (!sameOwner(view.owner, owner)) {
      throw new Error("That saved briefing belongs to another AMOS identity");
    }
    store.views.splice(index, 1);
    await this.writeStore(store);
    return true;
  }

  decryptView(envelope) {
    const view = JSON.parse(this.decrypt(envelope.payload));
    if (
      view.id !== envelope.id ||
      view.owner?.subjectId !== envelope.subjectId ||
      view.owner?.tenantId !== envelope.tenantId
    ) {
      throw new Error("saved briefing envelope does not match its encrypted content");
    }
    return view;
  }

  async readStore() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed?.version !== VERSION || !Array.isArray(parsed.views)) {
        throw new Error("unsupported saved briefing format");
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return { version: VERSION, views: [] };
      throw new Error(`Could not read saved AMOS briefings: ${error.message}`);
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

function normalizeOwner(identity) {
  const subjectId = String(identity?.sub || identity?.subject_id || "").trim();
  const tenantId = String(identity?.tenant_id || identity?.tenantId || "").trim();
  if (!subjectId || !tenantId) return null;
  return { subjectId, tenantId };
}

function sameOwner(left, right) {
  return left?.subjectId === right?.subjectId && left?.tenantId === right?.tenantId;
}

function boundedText(value, message, max) {
  const result = String(value || "").trim();
  if (!result) throw new Error(message);
  if (result.length > max) throw new Error(`${message} (${max} character limit)`);
  return result;
}

function publicView(view) {
  return {
    id: view.id,
    title: view.title,
    prompt: view.prompt,
    sourceKind: view.sourceKind,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt
  };
}
