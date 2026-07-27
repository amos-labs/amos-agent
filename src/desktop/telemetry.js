import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchCompat } from "../util/fetchCompat.js";

const VERSION = 1;
const MAX_PENDING = 100;
const REQUEST_TIMEOUT_MS = 5_000;

export class DesktopTelemetry {
  constructor({
    filePath,
    appVersion = "",
    platform = process.platform,
    architecture = process.arch,
    releaseChannel = "stable",
    fetchImpl = fetchCompat
  }) {
    this.filePath = filePath;
    this.appVersion = clean(appVersion, 32);
    this.platform = clean(platform, 32);
    this.architecture = clean(architecture, 32);
    this.releaseChannel = clean(releaseChannel, 32);
    this.fetch = fetchImpl;
    this.writeChain = Promise.resolve();
  }

  async initialize({ mcpUrl }) {
    const state = await this.read();
    await this.record("desktop_first_launch", {
      mcpUrl,
      once: true,
      context: { surface: "desktop" }
    });
    return state.installId;
  }

  async installId() {
    return (await this.read()).installId;
  }

  async record(eventType, {
    mcpUrl,
    accessToken = "",
    context = {},
    once = false
  } = {}) {
    if (!mcpUrl) return { accepted: false, reason: "missing_endpoint" };
    const state = await this.read();
    const onceKey = once ? clean(eventType, 64) : "";
    if (
      onceKey &&
      (state.completed.includes(onceKey) ||
        state.pending.some((event) => event.onceKey === onceKey))
    ) {
      await this.flush({ mcpUrl, accessToken });
      return { accepted: true, duplicate: true };
    }
    state.pending.push({
      event_id: randomUUID(),
      event_type: clean(eventType, 64),
      install_id: state.installId,
      app_version: this.appVersion,
      platform: this.platform,
      architecture: this.architecture,
      release_channel: this.releaseChannel,
      occurred_at: new Date().toISOString(),
      context: safeContext(context),
      onceKey
    });
    state.pending = state.pending.slice(-MAX_PENDING);
    await this.write(state);
    return this.flush({ mcpUrl, accessToken });
  }

  async flush({ mcpUrl, accessToken = "" } = {}) {
    if (!mcpUrl) return { accepted: false, reason: "missing_endpoint" };
    const state = await this.read();
    if (state.pending.length === 0) return { accepted: true, sent: 0 };
    let sent = 0;
    const retained = [];
    for (const event of state.pending) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      timer.unref?.();
      try {
        const response = await this.fetch(endpointFor(mcpUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
          },
          body: JSON.stringify(publicEvent(event)),
          signal: controller.signal
        });
        if (response.ok) {
          sent += 1;
          if (event.onceKey && !state.completed.includes(event.onceKey)) {
            state.completed.push(event.onceKey);
          }
        } else if (
          response.status === 404 ||
          response.status === 405 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          // Retain across a staged rollout where Desktop may update before the
          // matching platform route is live.
          retained.push(event);
        } else if (event.onceKey && !state.completed.includes(event.onceKey)) {
          // A permanent 4xx means this client/server pairing rejected the
          // schema. Do not create an infinite retry loop.
          state.completed.push(event.onceKey);
        }
      } catch {
        retained.push(event);
      } finally {
        clearTimeout(timer);
      }
    }
    state.pending = retained.slice(-MAX_PENDING);
    state.completed = state.completed.slice(-50);
    await this.write(state);
    return { accepted: true, sent, pending: state.pending.length };
  }

  async read() {
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8"));
      if (
        stored.version === VERSION &&
        UUID_PATTERN.test(stored.installId || "") &&
        Array.isArray(stored.pending) &&
        Array.isArray(stored.completed)
      ) {
        return stored;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        // A corrupt analytics file should never prevent the product from
        // starting. Replace it with a fresh random installation identity.
      }
    }
    const state = {
      version: VERSION,
      installId: randomUUID(),
      pending: [],
      completed: []
    };
    await this.write(state);
    return state;
  }

  async write(state) {
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const directory = dirname(this.filePath);
      const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700).catch(() => {});
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      await rename(temporary, this.filePath);
      await chmod(this.filePath, 0o600).catch(() => {});
    });
    return this.writeChain;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function endpointFor(mcpUrl) {
  const origin = new URL(mcpUrl).origin;
  return new URL("/api/v1/desktop/events", origin).toString();
}

function publicEvent(event) {
  const { onceKey: _onceKey, ...payload } = event;
  return payload;
}

function safeContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const encoded = JSON.stringify(value);
  return encoded.length <= 8_000 ? value : { truncated: true };
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
