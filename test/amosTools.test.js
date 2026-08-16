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

test("large AMOS engines require and then activate one advertised subtoolkit", async () => {
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
        if (!args.toolkit) {
          return {
            structuredContent: {
              engine: args.engine,
              requires_toolkit: true,
              engine_tool_count: 53,
              tools: [],
              toolkits: [
                { name: "company", unlocked: true, available_tools: 21 },
                { name: "docs", unlocked: true, available_tools: 9 },
                { name: "briefings", unlocked: false, available_tools: 0 }
              ],
              note: "Choose one toolkit."
            },
            content: [{ type: "text", text: "legacy fallback should not be parsed" }],
            isError: false
          };
        }
        return {
          structuredContent: {
            engine: args.engine,
            toolkit: args.toolkit,
            requires_toolkit: false,
            tools: [{
              name: "search_documents",
              description: "Search company documents",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
                additionalProperties: false
              }
            }]
          },
          content: [],
          isError: false
        };
      }
    }
  };

  const compact = await registry.execute("amos_load_engine_tools", { engine: "company" }, context);
  assert.equal(compact.requires_toolkit, true);
  assert.deepEqual(compact.available_toolkits, [
    { name: "company", available_tools: 21 },
    { name: "docs", available_tools: 9 }
  ]);
  assert.equal(registry.list().some((tool) => tool.name === "amos_company_search_documents"), false);

  const loaded = await registry.execute(
    "amos_load_engine_tools",
    { engine: "company", toolkit: "docs" },
    context
  );
  assert.equal(loaded.ok, true);
  assert.equal(loaded.toolkit, "docs");
  assert.ok(registry.openAiTools({ activeOnly: true }).some((tool) =>
    tool.function.name === "amos_company_search_documents"
  ));
  assert.deepEqual(calls.map(({ name, args }) => ({ name, args })), [{
    name: "load_engine_tools",
    args: { engine: "company" }
  }, {
    name: "load_engine_tools",
    args: { engine: "company", toolkit: "docs" }
  }]);
});
