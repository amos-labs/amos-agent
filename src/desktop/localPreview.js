import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, relative } from "node:path";
import { assertSafeAgentPath, resolveWorkspacePath } from "../util/pathSafety.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".json", ".map", ".svg",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf"
]);
const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
});

export class LocalPreviewRuntime {
  constructor({ serverFactory = createServer } = {}) {
    this.serverFactory = serverFactory;
    this.previews = new Map();
  }

  async start(scope, { workspace, path = ".", signal = null } = {}) {
    const key = previewScopeKey(scope);
    const workspaceRoot = resolveWorkspacePath(workspace, ".", false);
    const requested = resolveWorkspacePath(workspaceRoot, path || ".", false);
    assertSafeAgentPath(requested, workspaceRoot);
    const requestedInfo = await stat(requested);
    const root = requestedInfo.isDirectory() ? requested : dirname(requested);
    const entry = requestedInfo.isDirectory() ? "index.html" : basename(requested);
    assertSafeAgentPath(root, workspaceRoot);
    await assertPreviewFile(resolveWorkspacePath(root, entry, false), root);

    await this.close(scope);
    const server = this.serverFactory((request, response) => {
      this.serve({ request, response, root, entry }).catch(() => {
        if (!response.headersSent) response.writeHead(500, securityHeaders("text/plain; charset=utf-8"));
        response.end("Preview unavailable");
      });
    });
    server.on("clientError", (_error, socket) => socket.destroy());
    await listenLoopback(server);
    server.unref?.();
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("AMOS could not allocate a loopback preview port");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const record = { key, server, origin, root, entry };
    this.previews.set(key, record);
    if (signal?.aborted) {
      await this.close(scope);
      throw new Error("Local preview was canceled");
    }
    return {
      ok: true,
      status: "ready",
      origin,
      url: new URL(encodePreviewPath(entry), `${origin}/`).toString(),
      root: relative(workspaceRoot, root) || ".",
      entry,
      network: "exact loopback origin only"
    };
  }

  async close(scope) {
    const key = previewScopeKey(scope);
    const record = this.previews.get(key);
    if (!record) return false;
    this.previews.delete(key);
    await new Promise((resolve) => {
      record.server.close(() => resolve());
      record.server.closeAllConnections?.();
    });
    return true;
  }

  closeAll() {
    const records = [...this.previews.values()];
    this.previews.clear();
    for (const record of records) {
      record.server.close();
      record.server.closeAllConnections?.();
    }
  }

  async serve({ request, response, root, entry }) {
    if (!new Set(["GET", "HEAD"]).has(request.method)) {
      response.writeHead(405, securityHeaders("text/plain; charset=utf-8"));
      response.end("Method not allowed");
      return;
    }
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || entry;
    } catch {
      response.writeHead(400, securityHeaders("text/plain; charset=utf-8"));
      response.end("Invalid preview path");
      return;
    }
    let file = resolveWorkspacePath(root, requestedPath, false);
    try {
      await assertPreviewFile(file, root);
    } catch (error) {
      if (!extname(requestedPath) && request.headers.accept?.includes("text/html")) {
        file = resolveWorkspacePath(root, entry, false);
        await assertPreviewFile(file, root);
      } else {
        response.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
        response.end("Preview file not found");
        return;
      }
    }
    const extension = extname(file).toLowerCase();
    const bytes = await readFile(file);
    response.writeHead(200, {
      ...securityHeaders(CONTENT_TYPES[extension]),
      "Content-Length": String(bytes.length)
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  }
}

async function assertPreviewFile(file, root) {
  assertSafeAgentPath(file, root);
  const extension = extname(file).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`Local preview does not serve ${extension || "extensionless"} files`);
  }
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) {
    throw new Error("Local preview files must be regular files no larger than 10 MB");
  }
}

function securityHeaders(contentType) {
  return {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function previewScopeKey(scope = {}) {
  const values = [scope.boundary, scope.subjectId, scope.tenantId, scope.taskId]
    .map((value) => String(value || "").trim());
  if (values.some((value) => !value)) throw new Error("A complete task scope is required for local preview");
  return values.join("\u0000");
}

function encodePreviewPath(value) {
  return String(value || "index.html")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
