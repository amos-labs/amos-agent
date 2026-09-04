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
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }]
  });
}

test("AMOS engine loading retains bounded engine toolkits and marks read operations parallel-safe", async () => {
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
  assert.deepEqual(connections.deactivated_toolkits, []);
  assert.equal(connections.removed_prior_engine_tools, 0);
  assert.equal(registry.list().some((tool) => tool.name === "amos_finance_read_finance"), true);
  assert.deepEqual(registry.executionPolicy("amos_finance_read_finance"), {
    readOnly: true,
    parallelSafe: true
  });
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

test("deterministic AMOS bootstrap reads are classified as read-only", () => {
  const registry = new ToolRegistry();
  for (const tool of createAmosTools()) registry.register(tool);

  for (const name of [
    "amos_get_started",
    "amos_whoami",
    "amos_resume_company",
    "amos_company_overview",
    "amos_list_engines"
  ]) {
    assert.deepEqual(registry.executionPolicy(name), {
      readOnly: true,
      parallelSafe: true
    });
  }
  assert.deepEqual(registry.executionPolicy("amos_execute_capability"), {
    readOnly: false,
    parallelSafe: false
  });
});

test("plain-English capability resolution registers a pinned typed operation and executes through its manifest", async () => {
  const registry = new ToolRegistry({ progressive: true });
  for (const tool of createAmosTools()) registry.register(tool);
  const calls = [];
  const manifestId = "1a5d7649-4c5b-4596-bfaa-c6bc628f5df7";
  const context = {
    registry,
    config: { agent: {} },
    signal: null,
    amosClient: {
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "resolve_capabilities") {
          return mcpResult({
            manifest_id: manifestId,
            manifest_sha256: "a".repeat(64),
            expires_at: "2026-09-01T00:00:00Z",
            authority: "none",
            operations: [{
              operation: "create_mission",
              effect: "write",
              description: "Create a bounded Mission",
              input_schema: {
                type: "object",
                properties: { objective: { type: "string" } },
                required: ["objective"],
                additionalProperties: false
              }
            }]
          });
        }
        return mcpResult({ mission_id: "mission-1", status: "pending_approval" });
      }
    }
  };

  const resolved = await registry.execute(
    "amos_resolve_capabilities",
    { outcome: "create a prospecting mission" },
    context
  );
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.registered_dynamic_tools, ["amos_capability_create_mission"]);
  assert.ok(registry.openAiTools({ activeOnly: true }).some((tool) =>
    tool.function.name === "amos_capability_create_mission"
  ));

  const executed = await registry.execute(
    "amos_capability_create_mission",
    { objective: "Find qualified prospects" },
    context
  );
  assert.equal(executed.status, "pending_approval");
  assert.deepEqual(calls, [{
    name: "resolve_capabilities",
    args: {
      outcome: "create a prospecting mission",
      limit: undefined,
      ttl_seconds: undefined,
      include_input_schemas: true
    }
  }, {
    name: "execute_capability",
    args: {
      manifest_id: manifestId,
      operation: "create_mission",
      arguments: { objective: "Find qualified prospects" }
    }
  }]);
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
