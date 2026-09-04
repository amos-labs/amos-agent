import test from "node:test";
import assert from "node:assert/strict";
import { measureToolSurface, sanitizeToolName, ToolRegistry } from "../src/tools/registry.js";

test("sanitizeToolName keeps API-compatible names", () => {
  assert.equal(sanitizeToolName("finance.list-invoices/v1"), "finance_list-invoices_v1");
});

test("ToolRegistry executes registered tools", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "Echo input",
    parameters: { type: "object", properties: { value: { type: "string" } } },
    handler(args) {
      return { value: args.value };
    }
  });

  assert.equal(registry.openAiTools()[0].function.name, "echo");
  assert.equal(Object.isFrozen(registry.openAiTools()[0]), true);
  assert.equal(Object.isFrozen(registry.openAiTools()[0].function.parameters), true);
  assert.deepEqual(await registry.execute("echo", { value: "hi" }, {}), { value: "hi" });
});

test("ToolRegistry rejects missing required arguments before a remote handler can run", async () => {
  const registry = new ToolRegistry();
  let calls = 0;
  registry.register({
    name: "bulk_import",
    parameters: {
      type: "object",
      properties: { contacts: { type: "array" } },
      required: ["contacts"]
    },
    handler() {
      calls += 1;
      return { ok: true };
    }
  });

  await assert.rejects(
    registry.execute("bulk_import", {}, {}),
    /bulk_import is missing required tool arguments: contacts/
  );
  assert.equal(calls, 0);
});

test("ToolRegistry makes object root union branches explicit for model runtimes", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "capture_context",
    parameters: {
      type: "object",
      required: ["source_client"],
      anyOf: [
        { required: ["objective", "outcome"] },
        { required: ["expected_revision", "consultative_state"] }
      ],
      properties: {
        source_client: { type: "string" },
        objective: { type: "string" },
        outcome: { type: "string" }
      }
    },
    handler: () => ({ ok: true })
  });

  assert.deepEqual(registry.openAiTools()[0].function.parameters.anyOf, [
    { required: ["objective", "outcome"], type: "object" },
    { required: ["expected_revision", "consultative_state"], type: "object" }
  ]);
});

test("ToolRegistry rejects ambiguous name collisions but permits exact idempotent registration", () => {
  const registry = new ToolRegistry();
  const first = {
    name: "same_name",
    source: "one",
    remoteName: "first",
    handler: () => ({ ok: true })
  };
  assert.equal(registry.register(first), true);
  assert.equal(registry.register(first), false);
  assert.throws(
    () => registry.register({ ...first, source: "two" }),
    /Tool name collision/
  );
});

test("ToolRegistry reports model-facing schema burden and active toolkits", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    source: "test",
    toolkit: "testing",
    description: "Echo input",
    handler: () => ({ ok: true })
  });
  const tools = registry.openAiTools();
  const metrics = registry.surfaceMetrics(tools);
  assert.equal(metrics.toolCount, 1);
  assert.equal(metrics.registeredToolCount, 1);
  assert.ok(metrics.schemaBytes > 0);
  assert.equal(metrics.estimatedSchemaTokens, Math.ceil(metrics.schemaBytes / 4));
  assert.deepEqual(metrics.sources, ["test"]);
  assert.deepEqual(metrics.toolkits, ["testing"]);
  assert.deepEqual(measureToolSurface([]), {
    toolCount: 0,
    schemaBytes: 2,
    estimatedSchemaTokens: 1,
    schemaSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  });
});

test("ToolRegistry progressively activates bounded specialized toolkits", () => {
  const registry = new ToolRegistry({ progressive: true, maxActiveTools: 3, maxActiveToolkits: 1 });
  registry.register({ name: "core_tool", toolkit: "core", handler: () => ({ ok: true }) });
  registry.register({ name: "sheet_tool", toolkit: "spreadsheets", handler: () => ({ ok: true }) });
  registry.register({ name: "code_tool", toolkit: "workspace", handler: () => ({ ok: true }) });

  assert.deepEqual(
    registry.openAiTools({ activeOnly: true }).map((tool) => tool.function.name),
    ["core_tool"]
  );
  assert.equal(registry.activateToolkit("spreadsheets").ok, true);
  assert.deepEqual(
    registry.openAiTools({ activeOnly: true }).map((tool) => tool.function.name),
    ["core_tool", "sheet_tool"]
  );
  assert.equal(registry.activateToolkit("workspace").ok, false);
  assert.equal(registry.activateToolkit("workspace", { mode: "replace" }).ok, true);
  assert.deepEqual(
    registry.openAiTools({ activeOnly: true }).map((tool) => tool.function.name),
    ["core_tool", "code_tool"]
  );
});

test("ToolRegistry evicts the least recently used matching toolkit when a bounded set is full", () => {
  const registry = new ToolRegistry({ progressive: true, maxActiveTools: 4, maxActiveToolkits: 2 });
  registry.register({ name: "core_tool", toolkit: "core", handler: () => ({ ok: true }) });
  registry.register({ name: "finance", toolkit: "amos-engine:finance", handler: () => ({ ok: true }) });
  registry.register({ name: "connections", toolkit: "amos-engine:connections", handler: () => ({ ok: true }) });
  registry.register({ name: "website", toolkit: "amos-engine:website", handler: () => ({ ok: true }) });

  registry.activateToolkit("amos-engine:finance", { evictPrefix: "amos-engine:" });
  registry.activateToolkit("amos-engine:connections", { evictPrefix: "amos-engine:" });
  registry.activateToolkit("amos-engine:finance", { evictPrefix: "amos-engine:" });
  const activation = registry.activateToolkit("amos-engine:website", { evictPrefix: "amos-engine:" });

  assert.equal(activation.ok, true);
  assert.deepEqual(activation.evicted_toolkits, ["amos-engine:connections"]);
  assert.deepEqual(activation.active_toolkits, ["amos-engine:finance", "amos-engine:website", "core"]);
});
