import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeToolName, ToolRegistry } from "../src/tools/registry.js";

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
  assert.deepEqual(await registry.execute("echo", { value: "hi" }, {}), { value: "hi" });
});
