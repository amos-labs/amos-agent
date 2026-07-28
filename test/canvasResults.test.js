import assert from "node:assert/strict";
import test from "node:test";
import { DesktopCanvasResultStore } from "../src/desktop/canvasResults.js";

test("canvas result store captures only successful AMOS results and remains bounded", () => {
  const store = new DesktopCanvasResultStore({
    limit: 2,
    now: () => "2026-07-28T08:00:00.000Z"
  });

  assert.equal(store.capture({ name: "read_file", result: { ok: true } }), null);
  assert.equal(store.capture({ name: "amos_company_overview", failed: true, result: {} }), null);
  const first = store.capture({
    name: "amos_company_overview",
    result: { tenant_id: "tenant-1", revenue: 12 }
  });
  store.capture({ name: "amos_company_list_records", result: { records: [{ id: "1" }] } });
  store.capture({ name: "amos_company_list_records", result: { records: [{ id: "2" }] } });

  assert.equal(store.get(first.result_ref), null);
  const latest = store.results[0];
  assert.equal(store.get(latest.id).result.records[0].id, "2");
  store.clear();
  assert.equal(store.results.length, 0);
});
