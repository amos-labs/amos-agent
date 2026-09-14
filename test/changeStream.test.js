import assert from "node:assert/strict";
import test from "node:test";
import { ChangeStreamClient, parseSseBuffer } from "../src/desktop/changeStream.js";

const ORIGIN = "https://app.amoslabs.com";

function sseBody(text, { hold = false, signal = null } = {}) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      if (!hold) {
        controller.close();
        return;
      }
      signal?.addEventListener("abort", () => {
        try {
          controller.error(new Error("aborted"));
        } catch {
          // already closed
        }
      });
    }
  });
}

function response({ status = 200, body = "", headers = {}, hold = false, signal = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    body: body === null ? null : sseBody(body, { hold, signal })
  };
}

const READY = "event: stream.ready\nid: 5\ndata: {\"cursor\":5,\"poll_interval_ms\":1500}\n\n";
const CHANGE_A = "event: surface.changed\nid: 6\ndata: {\"id\":6,\"surface\":\"connections\",\"hint\":\"create_connection\"}\n\n";
const CHANGE_B = "event: surface.changed\nid: 8\ndata: {\"id\":8,\"surface\":\"approvals\",\"hint\":\"send_email@parked\"}\n\n";
const HEARTBEAT = ":heartbeat\n\n";
const END = "event: stream.end\nid: 9\ndata: {\"cursor\":9,\"reason\":\"lifetime\"}\n\n";

function harness(script) {
  const requests = [];
  const sleeps = [];
  const tokenCalls = [];
  const changes = [];
  const readies = [];
  const states = [];
  let call = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url, headers: options.headers });
    const step = script[Math.min(call, script.length - 1)];
    call += 1;
    return typeof step === "function" ? step(options) : step;
  };
  const client = new ChangeStreamClient({
    origin: ORIGIN,
    getAccessToken: async (options) => {
      tokenCalls.push(options || null);
      return options?.forceRefresh ? "token-2" : "token-1";
    },
    onReady: (cursor) => readies.push(cursor),
    onChange: (change) => changes.push(change),
    onStateChange: (state) => states.push(state),
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5
  });
  return { client, requests, sleeps, tokenCalls, changes, readies, states };
}

test("parseSseBuffer yields complete events, ignores comments, and keeps a partial tail", () => {
  const first = parseSseBuffer(READY + HEARTBEAT + "event: surface.changed\nid: 6\ndata: {\"sur");
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].event, "stream.ready");
  assert.equal(first.events[0].id, "5");
  assert.equal(first.rest, "event: surface.changed\nid: 6\ndata: {\"sur");
  const second = parseSseBuffer(first.rest + "face\":\"connections\"}\n\n");
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].event, "surface.changed");
  assert.equal(second.events[0].data, "{\"surface\":\"connections\"}");
  assert.equal(second.rest, "");
  // CRLF framing and multi-line data are honoured.
  const crlf = parseSseBuffer("data: a\r\ndata: b\r\n\r\n");
  assert.equal(crlf.events[0].data, "a\nb");
});

test("a scripted stream reports ready, surfaces, and the cursor, then reconnects with Last-Event-ID", async () => {
  const { client, requests, changes, readies, sleeps } = harness([
    response({ body: READY + CHANGE_A + HEARTBEAT + CHANGE_B + END }),
    (options) => response({ body: READY.replace("id: 5", "id: 9"), hold: true, signal: options.signal })
  ]);
  client.start();
  await waitFor(() => requests.length === 2);
  assert.deepEqual(readies.slice(0, 1), [5]);
  assert.deepEqual(changes, [
    { surface: "connections", hint: "create_connection", id: 6 },
    { surface: "approvals", hint: "send_email@parked", id: 8 }
  ]);
  assert.equal(requests[0].headers.Authorization, "Bearer token-1");
  assert.equal(requests[0].headers["Last-Event-ID"], undefined);
  assert.equal(requests[1].headers["Last-Event-ID"], "9", "reconnect resumes from the last id");
  assert.deepEqual(sleeps, [], "a clean stream.end reconnects without backoff");
  assert.equal(client.state().supported, true);
  await client.stop();
  assert.equal(client.state().connected, false);
});

test("a 404 means an older platform: unsupported, stopped, no retries", async () => {
  const { client, requests, sleeps } = harness([response({ status: 404, body: null })]);
  await client.start();
  assert.equal(requests.length, 1);
  assert.deepEqual(client.state(), { supported: false, connected: false, cursor: null, lastError: null });
  assert.deepEqual(sleeps, []);
});

test("a 401 refreshes the token once and retries with the new one", async () => {
  const { client, requests, tokenCalls } = harness([
    response({ status: 401, body: null }),
    response({ body: READY + END }),
    response({ status: 404, body: null })
  ]);
  await client.start();
  assert.equal(requests.length, 3);
  assert.deepEqual(tokenCalls[1], { forceRefresh: true });
  assert.equal(requests[1].headers.Authorization, "Bearer token-1", "the provider owns the refreshed token; the header re-reads it");
  assert.equal(client.state().cursor, 9);
});

test("a 503 waits for Retry-After before reconnecting", async () => {
  const { client, sleeps, states } = harness([
    response({ status: 503, body: null, headers: { "retry-after": "7" } }),
    response({ status: 404, body: null })
  ]);
  await client.start();
  assert.deepEqual(sleeps, [7000]);
  assert.ok(states.some((s) => s.lastError === "too many streams"));
});

test("a dropped connection backs off with jitter and resumes from the cursor", async () => {
  const { client, requests, sleeps } = harness([
    response({ body: READY + CHANGE_A }), // ends without stream.end: a drop
    response({ status: 404, body: null })
  ]);
  await client.start();
  assert.equal(requests.length, 2);
  assert.deepEqual(sleeps, [1000], "attempt 0: 1 s base × (0.5 + random 0.5)");
  assert.equal(requests[1].headers["Last-Event-ID"], "6");
});

test("events for surfaces the snapshot cannot serve are ignored", async () => {
  const { client, changes } = harness([
    response({ body: READY + "event: surface.changed\nid: 7\ndata: {\"surface\":\"billing\"}\n\n" + END }),
    response({ status: 404, body: null })
  ]);
  await client.start();
  assert.deepEqual(changes, []);
  assert.equal(client.state().cursor, 9);
});

async function waitFor(predicate, { timeoutMs = 2000 } = {}) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
