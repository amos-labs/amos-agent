import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { createSpreadsheetArtifact, createSpreadsheetTools } from "../src/tools/spreadsheets.js";

test("deterministic calculator verifies payroll period conversion", async () => {
  const calculator = createSpreadsheetTools().find((tool) => tool.name === "desktop_calculate");
  const result = await calculator.handler({
    steps: [
      {
        key: "loaded_annual_payroll",
        operation: "multiply",
        operands: [
          { value: 120_000, unit: "usd_per_year" },
          { value: 1.35, unit: "ratio" }
        ],
        unit: "usd_per_year"
      },
      {
        key: "loaded_monthly_payroll",
        operation: "annual_to_monthly",
        operands: [{ step: "loaded_annual_payroll" }],
        unit: "usd_per_month"
      }
    ]
  });

  assert.equal(result.steps[0].value, 162_000);
  assert.equal(result.steps[1].value, 13_500);
  assert.match(result.steps[1].formula, /\/12/);

  await assert.rejects(
    calculator.handler({
      steps: [
        {
          key: "annual_payroll",
          operation: "multiply",
          operands: [
            { value: 120_000, unit: "usd_per_year" },
            { value: 1.35, unit: "ratio" }
          ],
          unit: "usd_per_year"
        },
        {
          key: "wrong_monthly_payroll",
          operation: "divide",
          operands: [
            { step: "annual_payroll" },
            { value: 12, unit: "number" }
          ],
          unit: "usd_per_month"
        }
      ]
    }),
    /declares usd_per_month.*produces usd_per_year/
  );
});

test("financial workbook keeps current MRR in every scenario and presents the verified XLSX", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-spreadsheet-"));
  const presented = [];
  const result = await createSpreadsheetArtifact(
    { path: "models/amos-financial-model", spreadsheet: financialModelSpec(2_200) },
    spreadsheetContext(root),
    { present: async (input) => { presented.push(input); return { id: "canvas-1", revision: 1 }; } }
  );

  assert.equal(result.ok, true);
  assert.equal(result.artifact.path, "models/amos-financial-model.xlsx");
  assert.equal(result.artifact.verified, true);
  assert.equal(result.verification.requiredChecksPassed, true);
  assert.equal(result.preview.canvas_id, "canvas-1");
  assert.equal(presented.length, 1);
  assert.equal(presented[0].preview.checks.every((check) => check.passed), true);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(root, result.artifact.path));
  assert.equal(workbook.getWorksheet("Assumptions").getCell("B2").value, 2_200);
  assert.equal(workbook.getWorksheet("Assumptions").getCell("B5").value.result, 13_500);
  assert.match(workbook.getWorksheet("Assumptions").getCell("B5").value.formula, /\/12/);
  for (const sheet of ["Base Case", "Miss Case", "Bull Case", "Stretch Case"]) {
    assert.equal(workbook.getWorksheet(sheet).getCell("B2").value.result, 2_200);
    assert.match(workbook.getWorksheet(sheet).getCell("B2").value.formula, /Assumptions.*B2/);
  }
  assert.ok(workbook.getWorksheet("AMOS Checks"));
});

test("financial workbook fails closed before writing when a scenario drops the confirmed baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-spreadsheet-failure-"));
  const spec = financialModelSpec(2_200);
  const brokenBaseline = spec.sheets.find((sheet) => sheet.name === "Miss Case").cells
    .find((cell) => cell.address === "B2");
  delete brokenBaseline.formula;
  brokenBaseline.value = 0;

  await assert.rejects(
    createSpreadsheetArtifact(
      { path: "models/invalid-model", spreadsheet: spec },
      spreadsheetContext(root)
    ),
    /failed required checks.*Miss Case/
  );
  await assert.rejects(access(join(root, "models/invalid-model.xlsx")));
});

function financialModelSpec(currentMrr) {
  const scenarios = ["Base Case", "Miss Case", "Bull Case", "Stretch Case"];
  return {
    version: "1",
    kind: "financial_model",
    title: "AMOS Financial Model",
    author: "AMOS Desktop",
    sheets: [
      {
        name: "Assumptions",
        role: "assumptions",
        freeze_rows: 1,
        merges: ["A1:B1"],
        column_widths: [{ column: "A", width: 32 }, { column: "B", width: 18 }],
        cells: [
          { address: "A1", value: "Core assumptions", unit: "text", role: "title", wrap: true },
          { address: "A2", value: "Current MRR", unit: "text", role: "body" },
          { address: "B2", value: currentMrr, unit: "usd_per_month", role: "input" },
          { address: "A3", value: "Annual salary", unit: "text", role: "body" },
          { address: "B3", value: 120_000, unit: "usd_per_year", role: "input" },
          { address: "A4", value: "Fully loaded multiplier", unit: "text", role: "body" },
          { address: "B4", value: 1.35, unit: "ratio", role: "input" },
          { address: "A5", value: "Loaded monthly payroll", unit: "text", role: "total" },
          {
            address: "B5",
            formula: {
              op: "annual_to_monthly",
              args: [{ op: "multiply", args: [{ ref: "B3" }, { ref: "B4" }] }]
            },
            unit: "usd_per_month",
            role: "total"
          }
        ]
      },
      {
        name: "Scenario Comparison",
        role: "summary",
        freeze_rows: 1,
        cells: [
          { address: "A1", value: "Scenario", unit: "text", role: "section_header" },
          { address: "B1", value: "Starting MRR", unit: "text", role: "section_header" },
          ...scenarios.flatMap((name, index) => [
            { address: `A${index + 2}`, value: name, unit: "text", role: "body" },
            {
              address: `B${index + 2}`,
              formula: { ref: `'${name}'!B2` },
              unit: "usd_per_month",
              role: "linked"
            }
          ])
        ],
        charts: [{
          type: "bar",
          title: "Starting MRR by scenario",
          categories: "A2:A5",
          series: [{ name: "Starting MRR", values: "B2:B5", color: "315FD6" }],
          from: "D2",
          to: "L18",
          y_unit: "usd_per_month"
        }]
      },
      ...scenarios.map((name) => ({
        name,
        role: "scenario",
        merges: ["A1:B1"],
        cells: [
          { address: "A1", value: name, unit: "text", role: "title" },
          { address: "A2", value: "Starting MRR", unit: "text", role: "body" },
          {
            address: "B2",
            formula: { ref: "'Assumptions'!B2" },
            unit: "usd_per_month",
            role: "linked"
          }
        ]
      }))
    ],
    checks: [{
      label: "Loaded monthly payroll",
      actual: { sheet: "Assumptions", cell: "B5" },
      expected: { value: 13_500, unit: "usd_per_month" },
      operator: "equals",
      tolerance: 0,
      required: true
    }],
    scenario_baselines: scenarios.map((name) => ({
      label: "Starting MRR carries forward",
      scenario_sheet: name,
      source: { sheet: "Assumptions", cell: "B2" },
      target: { cell: "B2" },
      tolerance: 0
    }))
  };
}

function spreadsheetContext(root) {
  return {
    config: {
      safety: {
        workspaceRoot: root,
        allowOutsideWorkspace: false,
        autoApproveWrites: true,
        autoApproveKinds: []
      }
    },
    approvals: { confirm: async () => true }
  };
}
