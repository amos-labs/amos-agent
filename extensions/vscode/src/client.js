const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SCHEMA = "amos.desktop-companion:1";

function companionPaths() {
  if (process.platform === "darwin") {
    return [path.join(os.homedir(), "Library", "Application Support", "AMOS Desktop", "companion.json")];
  }
  if (process.platform === "win32") {
    return [path.join(process.env.APPDATA || "", "AMOS Desktop", "companion.json")];
  }
  return [
    path.join(os.homedir(), ".config", "AMOS Desktop", "companion.json"),
    path.join(os.homedir(), ".config", "amos-desktop", "companion.json")
  ];
}

async function readCompanionFile() {
  for (const filePath of companionPaths()) {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (parsed?.schema === SCHEMA && parsed.port && parsed.token) return parsed;
    } catch {
      // Try the next known Desktop user-data location.
    }
  }
  throw new Error("AMOS Desktop is not running, or the local companion file is missing.");
}

async function companionRequest(pathname, { method = "GET", body } = {}) {
  const companion = await readCompanionFile();
  const response = await fetch(`http://127.0.0.1:${companion.port}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${companion.token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `AMOS companion returned ${response.status}`);
  }
  return payload;
}

module.exports = {
  companionRequest,
  readCompanionFile
};
