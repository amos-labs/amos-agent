import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { AmosMcpClient } from "../src/mcp/amosMcpClient.js";

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
  const client = new AmosMcpClient(config.amos, async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [] }
        });
      }
    };
  });

  const result = await client.listTools();

  assert.equal(requestedUrl, "https://amos.example/mcp");
  assert.deepEqual(result, { tools: [] });
});
