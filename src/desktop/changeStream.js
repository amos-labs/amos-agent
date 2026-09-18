import { fetchCompat } from "../util/fetchCompat.js";

/**
 * The platform change stream (amos-managed-platform docs/MCP.md, "Client
 * change stream"): `GET {origin}/api/v1/events` as server-sent events naming
 * WHICH surface moved, never what changed. Desktop refetches that surface
 * through `desktop_snapshot`, which re-enters every platform gate, so nothing
 * on this stream is authority or data.
 *
 * Behaviour:
 * - connects with the current access token and refreshes it once on 401;
 * - tracks the cursor (the SSE `id`) and reconnects with `Last-Event-ID`
 *   after `stream.end` (immediately) or a dropped connection (exponential
 *   backoff, 1 s → 30 s, jittered);
 * - honours `Retry-After` on 503 (too many streams);
 * - gives up for this server on 404 (an older platform without the route)
 *   and reports `supported: false`, so the caller keeps its periodic poll.
 *
 * Nothing here logs. `lastError` carries an HTTP status or a short reason,
 * never headers or the token.
 */

export const CHANGE_STREAM_SURFACES = Object.freeze([
  "approvals",
  "connections",
  "receipts",
  "briefings",
  "automations",
  "tasks",
  "projects",
  "pipelines",
  "jobs",
  "webhooks",
  "mappings"
]);

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 300_000;
const MAX_DATA_BYTES = 8_192;

/**
 * Split buffered SSE text into complete events. Returns the events and the
 * unconsumed remainder (a partial event still being received). Comment lines
 * (":heartbeat") are ignored; `data:` lines are joined with "\n" per the spec.
 */
export function parseSseBuffer(buffer) {
  const text = String(buffer || "").replace(/\r\n/g, "\n");
  const events = [];
  let rest = text;
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary === -1) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const event = { event: "message", id: null, data: "" };
    const dataLines = [];
    let sawField = false;
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      sawField = true;
      if (field === "event") event.event = value || "message";
      else if (field === "id") event.id = value;
      else if (field === "data") dataLines.push(value.slice(0, MAX_DATA_BYTES));
    }
    if (!sawField) continue;
    event.data = dataLines.join("\n");
    events.push(event);
  }
  return { events, rest };
}

function parseCursor(value) {
  if (value === null || value === undefined) return null;
  const number = Number(String(value).trim());
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function retryAfterMs(response) {
  const raw = response?.headers?.get?.("retry-after");
  const seconds = Number(String(raw || "").trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

async function* bodyChunks(body) {
  if (!body) return;
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) yield decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock?.();
    }
    return;
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      yield typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    }
    return;
  }
  if (typeof body === "string") yield body;
}

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    timer.unref?.();
    function done() {
      signal?.removeEventListener?.("abort", done);
      resolve();
    }
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

export class ChangeStreamClient {
  constructor({
    origin,
    getAccessToken,
    onReady = () => {},
    onChange = () => {},
    onStateChange = () => {},
    fetchImpl = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : fetchCompat,
    sleep = defaultSleep,
    random = Math.random,
    surfaces = CHANGE_STREAM_SURFACES
  }) {
    if (!origin) throw new Error("The change stream needs the platform origin");
    if (typeof getAccessToken !== "function") {
      throw new Error("The change stream needs an access token provider");
    }
    this.url = new URL("/api/v1/events", origin).toString();
    this.getAccessToken = getAccessToken;
    this.onReady = onReady;
    this.onChange = onChange;
    this.onStateChange = onStateChange;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.random = random;
    this.surfaces = new Set(surfaces);
    this.cursor = null;
    this.supported = null;
    this.connected = false;
    this.lastError = null;
    this.attempts = 0;
    this.abort = null;
    this.loop = null;
    this.stopped = true;
  }

  state() {
    return {
      supported: this.supported,
      connected: this.connected,
      cursor: this.cursor,
      lastError: this.lastError
    };
  }

  start() {
    if (this.loop) return this.loop;
    this.stopped = false;
    this.abort = new AbortController();
    this.loop = this.run().catch(() => {}).finally(() => {
      this.loop = null;
    });
    return this.loop;
  }

  async stop() {
    this.stopped = true;
    this.abort?.abort();
    this.abort = null;
    const loop = this.loop;
    this.setConnected(false, null);
    if (loop) await loop;
  }

  setConnected(connected, lastError) {
    const changed = this.connected !== connected || this.lastError !== lastError;
    this.connected = connected;
    if (lastError !== undefined) this.lastError = lastError;
    if (changed) this.onStateChange(this.state());
  }

  backoffMs() {
    const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.min(this.attempts, 10));
    return Math.round(base * (0.5 + this.random()));
  }

  /** The wait before the next attempt; the first retry waits about a second. */
  nextBackoff() {
    const ms = this.backoffMs();
    this.attempts += 1;
    return ms;
  }

  async run() {
    let refreshedOnce = false;
    while (!this.stopped) {
      const signal = this.abort?.signal;
      let token;
      try {
        token = await this.getAccessToken();
      } catch (error) {
        this.setConnected(false, String(error?.message || "sign-in required"));
        await this.sleep(this.nextBackoff(), signal);
        continue;
      }
      if (!token) {
        this.setConnected(false, "sign-in required");
        await this.sleep(this.nextBackoff(), signal);
        continue;
      }
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...(this.cursor !== null ? { "Last-Event-ID": String(this.cursor) } : {})
      };
      let response;
      try {
        response = await this.fetch(this.url, { method: "GET", headers, signal });
      } catch (error) {
        if (this.stopped) return;
        this.setConnected(false, String(error?.message || "connection failed").slice(0, 200));
        await this.sleep(this.nextBackoff(), signal);
        continue;
      }
      if (this.stopped) return;

      if (response.status === 401 && !refreshedOnce) {
        refreshedOnce = true;
        try {
          await this.getAccessToken({ forceRefresh: true });
        } catch {
          // The next loop reports the failure through the normal path.
        }
        continue;
      }
      if (response.status === 404) {
        // An older platform without the route: fall back to polling for good.
        this.supported = false;
        this.stopped = true;
        this.setConnected(false, null);
        return;
      }
      if (response.status === 503) {
        this.setConnected(false, "too many streams");
        await this.sleep(retryAfterMs(response) ?? this.nextBackoff(), signal);
        continue;
      }
      if (!response.ok) {
        this.setConnected(false, `HTTP ${response.status}`);
        await this.sleep(this.nextBackoff(), signal);
        continue;
      }

      refreshedOnce = false;
      this.supported = true;
      this.attempts = 0;
      this.setConnected(true, null);
      let endedCleanly = false;
      try {
        let buffer = "";
        for await (const chunk of bodyChunks(response.body)) {
          if (this.stopped) break;
          buffer += chunk;
          const { events, rest } = parseSseBuffer(buffer);
          buffer = rest;
          for (const event of events) {
            if (this.handle(event) === "end") {
              endedCleanly = true;
              break;
            }
          }
          if (endedCleanly) break;
        }
      } catch (error) {
        if (!this.stopped) this.lastError = String(error?.message || "stream dropped").slice(0, 200);
      }
      if (this.stopped) return;
      this.setConnected(false, endedCleanly ? null : this.lastError || "stream dropped");
      if (!endedCleanly) {
        await this.sleep(this.nextBackoff(), signal);
      }
    }
  }

  handle(event) {
    const cursor = parseCursor(event.id);
    if (cursor !== null) this.cursor = cursor;
    if (event.event === "stream.ready") {
      this.onReady(this.cursor);
      return "ready";
    }
    if (event.event === "stream.end") {
      return "end";
    }
    if (event.event === "surface.changed") {
      const data = parseJson(event.data);
      const surface = String(data.surface || "").trim();
      if (!this.surfaces.has(surface)) return "ignored";
      this.onChange({
        surface,
        hint: String(data.hint || "").slice(0, 120),
        id: cursor ?? parseCursor(data.id)
      });
      return "change";
    }
    return "ignored";
  }
}
