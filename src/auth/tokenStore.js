import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
