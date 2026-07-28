import assert from "node:assert/strict";
import test from "node:test";
import { adaptCompanyResult } from "../src/desktop/canvasAdapters.js";
import { normalizeCanvasSpec } from "../src/desktop/canvas.js";

const observedAt = "2026-07-28T08:00:00.000Z";

function normalized(input) {
  return normalizeCanvasSpec(input, { now: () => observedAt });
}

test("company overview adapter produces bounded metrics, tables, trends, and provenance", () => {
  const canvas = normalized(adaptCompanyResult({
    intent: "company_overview",
    sourceTool: "amos_company_overview",
    observedAt,
    result: {
      text: JSON.stringify({
        tenant_id: "tenant-1",
        revenue: 125000,
        active_customers: 42,
        history: [
          { date: "2026-07-26", revenue: 120000, active_customers: 40 },
          { date: "2026-07-27", revenue: 125000, active_customers: 42 }
        ]
      })
    }
  }));

  assert.equal(canvas.state.kind, "ready");
  assert.ok(canvas.blocks.some((block) => block.type === "metric"));
  assert.ok(canvas.blocks.some((block) => block.type === "table"));
  assert.ok(canvas.blocks.some((block) => block.type === "timeseries"));
  assert.ok(canvas.blocks.every((block) => block.provenance.tenantId === "tenant-1"));
});

test("funnel adapter computes stage display without inventing missing values", () => {
  const canvas = normalized(adaptCompanyResult({
    intent: "funnel",
    sourceTool: "amos_marketing_campaign_funnel",
    observedAt,
    result: {
      stages: [
        { stage: "Visited", count: 100 },
        { stage: "Started demo", count: 25 },
        { stage: "Created account", count: 5 }
      ]
    }
  }));

  const metrics = canvas.blocks.filter((block) => block.type === "metric");
  assert.deepEqual(metrics.map((block) => block.value), [100, 25, 5]);
  assert.equal(metrics[1].change, "25.0% from prior stage");
});

test("approval and receipt adapters preserve governed IDs and status", () => {
  const approvalCanvas = normalized(adaptCompanyResult({
    intent: "approvals",
    sourceTool: "amos_governance_list_pending_operations",
    observedAt,
    result: {
      pending_operations: [{
        id: "pending-1",
        status: "pending",
        review_summary: "Publish the campaign",
        requested_at: observedAt
      }]
    }
  }));
  const approval = approvalCanvas.blocks[0];
  assert.equal(approval.kind, "approval");
  assert.equal(approval.pendingId, "pending-1");
  assert.equal(approval.provenance.approvalId, "pending-1");

  const receiptCanvas = normalized(adaptCompanyResult({
    intent: "receipts",
    sourceTool: "amos_governance_list_receipts",
    observedAt,
    result: {
      receipts: [{
        receipt_id: "receipt-1",
        status: "completed",
        summary: "Campaign published"
      }]
    }
  }));
  const receipt = receiptCanvas.blocks[0];
  assert.equal(receipt.kind, "receipt");
  assert.equal(receipt.status, "executed");
  assert.equal(receipt.receiptId, "receipt-1");
});

test("adapter emits honest empty, restricted, partial, and error states", () => {
  const cases = [
    [{}, "empty"],
    [{ missing_scope: "finance:read" }, "restricted"],
    [{ partial: true, total: 3 }, "partial"],
    [{ error: "upstream unavailable" }, "error"]
  ];
  for (const [result, expected] of cases) {
    const canvas = normalized(adaptCompanyResult({
      intent: "auto",
      sourceTool: "amos_company_overview",
      observedAt,
      result
    }));
    assert.equal(canvas.state.kind, expected);
    if (["empty", "restricted", "error"].includes(expected)) {
      assert.equal(canvas.blocks.length, 0);
    }
  }
});
