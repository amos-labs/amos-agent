import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { AmosMcpClient, normalizeMcpToolResult } from "../src/mcp/amosMcpClient.js";

test("AmosMcpClient accepts the AMOS config object produced by loadConfig", async () => {
  const config = loadConfig(
    {
      MOONSHOT_API_KEY: "model-key",
      AMOS_API_KEY: "amos-key",
      AMOS_MCP_URL: "https://amos.example/mcp"
    },
    "."
  );
  let requestedUrl;
  const client = new AmosMcpClient(config.amos, async (url, options) => {
    requestedUrl = url;
    const { method, id } = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : null },
      async text() {
        return JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: method === "initialize" ? { protocolVersion: "2025-06-18" } : { tools: [] }
        });
      }
    };
  });

  const result = await client.listTools();

  assert.equal(requestedUrl, "https://amos.example/mcp");
  assert.deepEqual(result, { tools: [] });
});

// A fake Streamable HTTP MCP server. `behaviour` decides how it treats the
// lifecycle so tests can model AMOS (no lifecycle), spec servers, and expiry.
function fakeMcpServer(behaviour = {}) {
  const calls = [];
  const sessions = [];
  let sessionCounter = 0;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ headers: options.headers, body });
    const respond = (status, payload, headers = {}) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name) => {
          const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
          return key ? headers[key] : name.toLowerCase() === "content-type" ? "application/json" : null;
        }
      },
      async text() {
        return payload === undefined ? "" : JSON.stringify(payload);
      }
    });

    if (body.method === "initialize") {
      if (behaviour.initialize === "method_not_found") {
        return respond(200, { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
      }
      if (behaviour.initialize === "http_404") return respond(404, undefined);
      if (behaviour.initialize === "http_503") return respond(503, undefined);
      sessionCounter += 1;
      const sessionId = behaviour.sessionless ? null : `session-${sessionCounter}`;
      if (sessionId) sessions.push(sessionId);
      return respond(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-amos", version: "1.0.0" }
        }
      }, sessionId ? { "Mcp-Session-Id": sessionId } : {});
    }
    if (body.method === "notifications/initialized") return respond(202, undefined);

    const presented = options.headers["Mcp-Session-Id"] || null;
    if (sessions.length > 0 && (!presented || behaviour.expired?.has(presented))) {
      return respond(404, undefined);
    }
    if (body.method === "tools/list") {
      return respond(200, { jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "amos_whoami" }] } });
    }
    if (body.method === "tools/call") {
      return respond(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: true, name: body.params.name }) }] }
      });
    }
    return respond(200, { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
  };
  return { fetchImpl, calls, sessions };
}

const clientConfig = { url: "https://amos.example/mcp", apiKey: "amos-key" };

test("AmosMcpClient performs a lazy initialize handshake and honors Mcp-Session-Id", async () => {
  const server = fakeMcpServer();
  const client = new AmosMcpClient({ ...clientConfig, clientInfo: { name: "amos-agent-test", version: "9.9.9" } }, server.fetchImpl);

  const [tools, call] = await Promise.all([
    client.listTools(),
    client.callTool("amos_whoami", {})
  ]);

  assert.deepEqual(tools, { tools: [{ name: "amos_whoami" }] });
  assert.equal(JSON.parse(call.content[0].text).name, "amos_whoami");
  assert.deepEqual(server.calls.map((entry) => entry.body.method), [
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call"
  ]);

  const initialize = server.calls[0];
  assert.equal(initialize.body.params.protocolVersion, "2025-06-18");
  assert.deepEqual(initialize.body.params.clientInfo, { name: "amos-agent-test", version: "9.9.9" });
  assert.deepEqual(initialize.body.params.capabilities, {});
  assert.equal(initialize.headers["Mcp-Session-Id"], undefined);
  assert.equal(initialize.headers.Authorization, "Bearer amos-key");

  const initialized = server.calls[1];
  assert.equal(initialized.body.id, undefined, "notifications carry no id");
  assert.equal(initialized.headers["Mcp-Session-Id"], "session-1");

  for (const entry of server.calls.slice(2)) {
    assert.equal(entry.headers["Mcp-Session-Id"], "session-1");
    assert.equal(entry.headers["MCP-Protocol-Version"], "2025-06-18");
  }
  assert.equal(client.session.negotiated, true);
  assert.equal(client.session.serverInfo.name, "fake-amos");
});

test("AmosMcpClient keeps working against a server that returns no session id", async () => {
  const server = fakeMcpServer({ sessionless: true });
  const client = new AmosMcpClient(clientConfig, server.fetchImpl);

  await client.listTools();
  await client.listTools();

  assert.deepEqual(server.calls.map((entry) => entry.body.method), [
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/list"
  ]);
  assert.ok(server.calls.every((entry) => entry.headers["Mcp-Session-Id"] === undefined));
  assert.equal(client.session.id, null);
  assert.equal(client.session.negotiated, true);
});

test("AmosMcpClient falls back to plain JSON-RPC when the server rejects initialize", async () => {
  for (const initialize of ["method_not_found", "http_404"]) {
    const server = fakeMcpServer({ initialize });
    const client = new AmosMcpClient(clientConfig, server.fetchImpl);

    const tools = await client.listTools();
    await client.callTool("amos_whoami");

    assert.deepEqual(tools, { tools: [{ name: "amos_whoami" }] }, initialize);
    assert.deepEqual(server.calls.map((entry) => entry.body.method), [
      "initialize",
      "tools/list",
      "tools/call"
    ], initialize);
    assert.ok(server.calls.every((entry) =>
      entry.headers["Mcp-Session-Id"] === undefined && entry.headers["MCP-Protocol-Version"] === undefined
    ), initialize);
    assert.equal(client.session.negotiated, false, initialize);
  }
});

test("AmosMcpClient retries the handshake after a transient initialize failure", async () => {
  const server = fakeMcpServer({ initialize: "http_503" });
  const client = new AmosMcpClient(clientConfig, server.fetchImpl);

  await assert.rejects(() => client.listTools(), /503/);
  assert.equal(client.session, null);

  delete server.fetchImpl.behaviour;
  const healthy = fakeMcpServer();
  client.fetch = healthy.fetchImpl;
  assert.deepEqual(await client.listTools(), { tools: [{ name: "amos_whoami" }] });
  assert.equal(healthy.calls[0].body.method, "initialize");
});

test("AmosMcpClient re-initializes once when the server has expired the session", async () => {
  const expired = new Set();
  const server = fakeMcpServer({ expired });
  const client = new AmosMcpClient(clientConfig, server.fetchImpl);

  await client.listTools();
  expired.add("session-1");
  const tools = await client.listTools();

  assert.deepEqual(tools, { tools: [{ name: "amos_whoami" }] });
  assert.deepEqual(server.calls.map((entry) => [entry.body.method, entry.headers["Mcp-Session-Id"]]), [
    ["initialize", undefined],
    ["notifications/initialized", "session-1"],
    ["tools/list", "session-1"],
    ["tools/list", "session-1"],
    ["initialize", undefined],
    ["notifications/initialized", "session-2"],
    ["tools/list", "session-2"]
  ]);
});

test("AmosMcpClient refreshes an expired OAuth token during the handshake", async () => {
  const server = fakeMcpServer();
  let rejectedOnce = false;
  const fetchImpl = async (url, options) => {
    if (!rejectedOnce && options.headers.Authorization === "Bearer stale") {
      rejectedOnce = true;
      return { ok: false, status: 401, headers: { get: () => null }, async text() { return ""; } };
    }
    return server.fetchImpl(url, options);
  };
  const tokens = ["stale", "fresh"];
  const client = new AmosMcpClient({
    url: "https://amos.example/mcp",
    getAccessToken: async ({ forceRefresh } = {}) => (forceRefresh ? "fresh" : tokens[0])
  }, fetchImpl);

  await client.listTools();
  assert.equal(server.calls[0].body.method, "initialize");
  assert.equal(server.calls[0].headers.Authorization, "Bearer fresh");
  assert.equal(client.session.id, "session-1");
});

test("normalizeMcpToolResult parses structured JSON once", () => {
  assert.deepEqual(normalizeMcpToolResult({
    content: [{ type: "text", text: JSON.stringify({ total: 12 }) }],
    isError: false
  }), { ok: true, total: 12 });
});

test("normalizeMcpToolResult turns MCP error envelopes into failed tool results", () => {
  assert.deepEqual(normalizeMcpToolResult({
    content: [{ type: "text", text: JSON.stringify({ error: "connection expired" }) }],
    isError: true
  }), { ok: false, error: "connection expired" });
});
