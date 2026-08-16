import test from "node:test";
import assert from "node:assert/strict";
import { createAmosTools } from "../src/tools/amos.js";
import { ToolRegistry } from "../src/tools/registry.js";

function mcpResult(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    isError
  };
}

function engineSchemas(engine) {
  return mcpResult({
    tools: [{
      name: `read_${engine}`,
      description: `Read ${engine}`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }]
  });
}

test("AMOS engine loading returns a compact receipt and exposes one bounded engine at a time", async () => {
  const registry = new ToolRegistry({ progressive: true });
  for (const tool of createAmosTools()) registry.register(tool);
  const calls = [];
  const context = {
    registry,
    config: { agent: {} },
    signal: null,
    amosClient: {
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "load_engine_tools") return engineSchemas(args.engine);
        return mcpResult({ engine: args.engine, tool: args.tool, value: 42 });
      }
    }
  };

  const finance = await registry.execute("amos_load_engine_tools", { engine: "finance" }, context);
  assert.equal(finance.ok, true);
  assert.equal(finance.tool_count, 1);
  assert.equal("result" in finance, false);
  assert.equal("text" in finance, false);
  assert.ok(registry.openAiTools({ activeOnly: true }).some((tool) =>
    tool.function.name === "amos_finance_read_finance"
  ));

  const toolResult = await registry.execute("amos_finance_read_finance", {}, context);
  assert.deepEqual(toolResult, {
    ok: true,
    engine: "finance",
    tool: "read_finance",
    value: 42
  });

  const connections = await registry.execute("amos_load_engine_tools", { engine: "connections" }, context);
  assert.equal(connections.ok, true);
  assert.deepEqual(connections.deactivated_toolkits, ["amos-engine:finance"]);
  assert.equal(connections.removed_prior_engine_tools, 1);
  assert.equal(registry.list().some((tool) => tool.name === "amos_finance_read_finance"), false);
  assert.equal(calls.length, 3);
});

test("AMOS MCP error envelopes fail the agent tool cycle", async () => {
  const registry = new ToolRegistry();
  for (const tool of createAmosTools()) registry.register(tool);
  const result = await registry.execute("amos_company_overview", {}, {
    signal: null,
    amosClient: {
      callTool: async () => mcpResult({ error: "tenant unavailable" }, true)
    }
  });
  assert.deepEqual(result, { ok: false, error: "tenant unavailable" });
});
