import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCHEMA = "amos.desktop-companion:1";
const MAX_BODY_BYTES = 256 * 1024;

export class DesktopCompanionServer {
  constructor({
    userDataPath,
    controller,
    listen = createServer,
    now = () => new Date()
  }) {
    this.userDataPath = userDataPath;
    this.controller = controller;
    this.listen = listen;
    this.now = now;
    this.server = null;
    this.token = "";
    this.port = 0;
    this.filePath = join(userDataPath, "companion.json");
  }

  async start() {
    if (this.server) return this.status();
    this.token = randomBytes(32).toString("hex");
    this.server = this.listen((request, response) => {
      this.handle(request, response).catch((error) => {
        if (!response.headersSent) writeJson(response, 500, { error: error.message });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.port = this.server.address().port;
    await mkdir(this.userDataPath, { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, `${JSON.stringify({
      schema: SCHEMA,
      host: "127.0.0.1",
      port: this.port,
      token: this.token,
      pid: process.pid,
      startedAt: this.now().toISOString()
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(this.filePath, 0o600).catch(() => {});
    return this.status();
  }

  async stop() {
    if (this.server) {
      await new Promise((resolve) => this.server.close(() => resolve()));
      this.server = null;
    }
    await unlink(this.filePath).catch(() => {});
  }

  status() {
    return {
      schema: SCHEMA,
      listening: Boolean(this.server),
      host: "127.0.0.1",
      port: this.port,
      filePath: this.filePath
    };
  }

  async handle(request, response) {
    if (!authorize(request, this.token)) {
      writeJson(response, 401, { error: "Companion token required" });
      return;
    }
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/v1/health") {
      writeJson(response, 200, { ok: true, schema: SCHEMA });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/status") {
      writeJson(response, 200, await this.controller.companionStatus());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/tasks") {
      const body = await readJson(request);
      writeJson(response, 200, await this.controller.companionStartTask(body));
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/steer") {
      const body = await readJson(request);
      writeJson(response, 200, await this.controller.steerTask({
        id: body.taskId || body.id,
        content: body.content || body.text
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/workspace") {
      const body = await readJson(request);
      writeJson(response, 200, await this.controller.companionSetWorkspace(body));
      return;
    }
    writeJson(response, 404, { error: "Unknown companion route" });
  }
}

function authorize(request, token) {
  const header = String(request.headers.authorization || "");
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : String(request.headers["x-amos-companion-token"] || "").trim();
  return Boolean(token) && presented === token;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Companion request is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Companion request must be JSON"));
      }
    });
    request.on("error", reject);
  });
}

function writeJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}
