import { randomBytes } from "node:crypto";
import http from "node:http";
import { openSystemBrowser } from "./oauth.js";

const CALLBACK_PATH = "/desktop/demo/callback";
const MAX_BODY_BYTES = 32 * 1024;

function randomState() {
  return randomBytes(32).toString("base64url");
}

function amosOrigin(value) {
  const url = new URL(value);
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error("AMOS demo launch requires HTTPS except for localhost development");
  }
  return url.origin;
}

export class AmosDesktopDemoSession {
  constructor({
    mcpUrl,
    store,
    openBrowser = openSystemBrowser,
    callbackReceiverFactory = createDemoCallbackReceiver
  }) {
    this.mcpUrl = mcpUrl;
    this.store = store;
    this.openBrowser = openBrowser;
    this.callbackReceiverFactory = callbackReceiverFactory;
  }

  async start({ timeoutMs = 300_000, previousWorkspace = "", installId = "" } = {}) {
    const state = randomState();
    const receiver = await this.callbackReceiverFactory({ state, timeoutMs });
    try {
      const url = new URL("/playground/console", amosOrigin(this.mcpUrl));
      url.searchParams.set("src", "desktop-demo");
      if (/^[0-9a-f-]{36}$/i.test(installId)) {
        url.searchParams.set("desktop_install_id", installId);
      }
      url.searchParams.set("desktop_callback", receiver.redirectUri);
      url.searchParams.set("desktop_state", state);
      if (!this.openBrowser(url.toString())) {
        throw new Error("AMOS could not open the browser for the Northwind demo");
      }
      const payload = await receiver.result;
      const expiresAt = Date.parse(payload.expires_at);
      if (
        !payload.api_key ||
        payload.api_key.length > 16_384 ||
        !/^[0-9a-f-]{36}$/i.test(payload.tenant_id || "") ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() + 60_000
      ) {
        throw new Error("AMOS returned an invalid or already-expired demo session");
      }
      const credentials = {
        access_token: payload.api_key,
        token_type: "Bearer",
        scope: "playground",
        expires_at: expiresAt,
        mcp_url: this.mcpUrl,
        demo: true,
        tenant_id: payload.tenant_id,
        previous_workspace: previousWorkspace
      };
      await this.store.write(credentials);
      return credentials;
    } finally {
      receiver.close();
    }
  }
}

export async function createDemoCallbackReceiver({ state, timeoutMs = 300_000 }) {
  let settled = false;
  let resolveResult;
  let rejectResult;
  let timer;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== CALLBACK_PATH) {
      response.writeHead(404).end("Not found");
      return;
    }
    const contentType = String(request.headers["content-type"] || "").split(";", 1)[0];
    if (contentType !== "application/x-www-form-urlencoded") {
      response.writeHead(415).end("Unsupported content type");
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) request.destroy();
    });
    request.on("end", () => {
      const form = new URLSearchParams(body);
      if (form.get("state") !== state) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end(
          "AMOS Desktop could not verify this demo handoff. Return to the app and try again."
        );
        finish(new Error("AMOS Desktop demo state mismatch"));
        return;
      }
      const payload = {
        api_key: form.get("api_key") || "",
        tenant_id: form.get("tenant_id") || "",
        expires_at: form.get("expires_at") || ""
      };
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
        "<!doctype html><meta charset=utf-8><title>Northwind is ready</title><body style='font-family:system-ui;max-width:38rem;margin:5rem auto;padding:1rem'><h1>Northwind Labs is ready in AMOS Desktop</h1><p>This is sample data in a short-lived demo company. You can close this tab and return to AMOS Desktop.</p></body>"
      );
      finish(null, payload);
    });
    request.on("error", (error) => finish(error));
  });

  function finish(error, value) {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (error) rejectResult(error);
    else resolveResult(value);
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
  timer = setTimeout(
    () => finish(new Error("The Northwind demo launch timed out. Return to AMOS Desktop and try again.")),
    timeoutMs
  );
  timer.unref?.();

  return {
    redirectUri,
    result,
    close() {
      if (timer) clearTimeout(timer);
      server.close();
    }
  };
}
