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

test("performance adapter renders cited benchmark gaps without inventing causes", () => {
  const canvas = normalized(adaptCompanyResult({
    intent: "auto",
    sourceTool: "amos_call_engine_tool",
    observedAt,
    result: {
      contract_version: 1,
      status: "ready",
      goal_signal_pattern: "performance:<operating_unit_key>:<metric_key>",
      operating_units: [{
        key: "dallas",
        name: "Dallas",
        type: "location",
        metrics: [{
          metric: {
            key: "close_rate",
            name: "Close rate",
            unit: "percent",
            value_kind: "percent",
            direction: "increase"
          },
          current: {
            value: 0.11,
            period_end: "2026-06-30",
            data_classification: "customer_provided",
            source_kind: "customer_report",
            source_name: "Quarterly business review",
            source_ref: "document:qbr:sha256:abc",
            evidence_refs: ["page:1", "cell:C9"]
          },
          previous: {
            value: 0.14,
            period_end: "2026-03-31",
            source_ref: "document:qbr:sha256:abc"
          },
          trend: {
            direction: "down",
            favorable: false
          },
          benchmarks: [{
            key: "top_quartile",
            label: "Top quartile",
            value: 0.22,
            source_kind: "customer_report",
            source_ref: "document:qbr:sha256:abc",
            gap: {
              shortfall: 0.11,
              relative_shortfall: 0.5,
              meets_or_exceeds: false
            }
          }],
          interpretation_rule: "Observed comparison; not causal proof."
        }]
      }]
    }
  }));

  assert.equal(canvas.title, "Company performance");
  assert.equal(canvas.state.kind, "ready");
  const metric = canvas.blocks.find((block) => block.type === "metric");
  assert.equal(metric.value, "11%");
  assert.equal(metric.trend, "down");
  assert.match(metric.change, /11% to Top quartile/);
  assert.match(metric.note, /not a causal claim/);
  assert.ok(metric.provenance.references.some(
    (reference) => reference.id === "document:qbr:sha256:abc"
  ));
  assert.ok(canvas.source.references.some((reference) => reference.id === "cell:C9"));
  const table = canvas.blocks.find((block) => block.type === "table");
  assert.equal(table.rows[0].current, "11%");
  assert.equal(table.rows[0].benchmark, "Top quartile: 22%");
  assert.equal(table.rows[0].classification, "Customer Provided");
});

test("performance adapter preserves the platform's honest empty state", () => {
  const canvas = normalized(adaptCompanyResult({
    intent: "performance",
    sourceTool: "amos_call_engine_tool",
    observedAt,
    result: {
      contract_version: 1,
      status: "empty",
      operating_units: [],
      goal_signal_pattern: "performance:<operating_unit_key>:<metric_key>"
    }
  }));
  assert.equal(canvas.state.kind, "empty");
  assert.equal(canvas.blocks.length, 0);
});

test("Nuvola learning results become a deterministic course review surface", () => {
  const canvas = normalized(adaptCompanyResult({
    intent: "auto",
    sourceTool: "amos_call_engine_tool",
    observedAt,
    result: {
      provider: "nuvola_learning_mcp",
      corporation_id: 14,
      resource: "course",
      item: {
        id: 42,
        title: "Closing the Follow-up Gap",
        type: "course",
        status: "draft",
        description: "A focused course generated from the observed learning deficit.",
        hours: 1.5,
        review_url: "https://learning.example/courses/42/review",
        modules: [{
          position: 1,
          title: "Diagnose the gap",
          lessons: [{ id: 1 }, { id: 2 }]
        }, {
          position: 2,
          title: "Practice the response",
          lessons: [{ id: 3 }]
        }]
      }
    }
  }));

  assert.equal(canvas.title, "Learning course");
  assert.ok(canvas.blocks.some((block) => block.type === "markdown"));
  assert.equal(
    canvas.blocks.find((block) => block.id === "learning-modules-count").value,
    2
  );
  const modules = canvas.blocks.find((block) => block.title === "Course modules");
  assert.deepEqual(modules.rows.map((row) => row.lessons), [2, 1]);
  const destination = canvas.blocks.find((block) => block.type === "link");
  assert.equal(destination.actionLabel, "Review draft");
  assert.equal(destination.url, "https://learning.example/courses/42/review");
  assert.ok(canvas.blocks.every((block) => block.provenance.tenantId === ""));
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
