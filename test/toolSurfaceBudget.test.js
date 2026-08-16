import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../src/runtime.js";

test("the default progressive AMOS surface stays compact", () => {
  const registry = createRegistry({
    toolSurface: {
      progressive: true,
      maxActiveTools: 64,
      maxActiveSchemaBytes: 131_072,
      maxActiveToolkits: 4
    }
  });
  const metrics = registry.surfaceMetrics(registry.openAiTools({ activeOnly: true }));
  assert.ok(metrics.toolCount <= 12, `default surface exposed ${metrics.toolCount} tools`);
  assert.ok(metrics.schemaBytes <= 5_000, `default surface used ${metrics.schemaBytes} schema bytes`);
  assert.deepEqual(metrics.toolkits, ["core"]);
});

test("personal progressive mode begins with activation rather than every local tool", () => {
  const registry = createRegistry({
    includeAmos: false,
    toolSurface: { progressive: true }
  });
  const metrics = registry.surfaceMetrics(registry.openAiTools({ activeOnly: true }));
  assert.equal(metrics.toolCount, 1);
  assert.ok(metrics.schemaBytes <= 2_000);
});
