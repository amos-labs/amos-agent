import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createSpreadsheetTools } from "../src/tools/spreadsheets.js";
import { renderSpreadsheetArtifact } from "../src/artifacts/spreadsheetRenderer.js";
const calculate = createSpreadsheetTools().find(tool => tool.name === "desktop_calculate");

for (const currency of ["usd", "eur"]) test(`${currency} runway calculation verifies before and after hiring`, async () => {
  const rate = `${currency}_per_month`;
  const result = await calculate.handler({ steps: [
    { key: "burn", operation: "subtract", operands: [{ value: 80000, unit: rate }, { value: 60000, unit: rate }], unit: rate },
    { key: "runway", operation: "divide", operands: [{ value: 120000, unit: currency }, { step: "burn" }], unit: "months" },
    { key: "new_burn", operation: "add", operands: [{ step: "burn" }, { value: 8000, unit: rate }], unit: rate },
    { key: "new_runway", operation: "divide", operands: [{ value: 120000, unit: currency }, { step: "new_burn" }], unit: "months" }
  ] });
  assert.equal(result.verified, true);
  assert.deepEqual(result.steps.slice(0, 3).map(step => step.value), [20000, 6, 28000]);
  assert.ok(Math.abs(result.steps[3].value - 30 / 7) < 1e-12);
  assert.equal(result.steps[3].unit, "months");
});

test("euro annual conversions and same-denomination ratios retain correct units", async () => {
  const result = await calculate.handler({ steps: [
    { key: "monthly", operation: "annual_to_monthly", operands: [{ value: 240000, unit: "eur_per_year" }], unit: "eur_per_month" },
    { key: "annual", operation: "monthly_to_annual", operands: [{ step: "monthly" }], unit: "eur_per_year" },
    { key: "years", operation: "divide", operands: [{ value: 120000, unit: "eur" }, { step: "annual" }], unit: "years" },
    { key: "fraction", operation: "divide", operands: [{ value: 120000, unit: "eur" }, { value: 240000, unit: "eur" }], unit: "ratio" }
  ] });
  assert.deepEqual(result.steps.map(s => s.value), [20000, 240000, 0.5, 0.5]);
});

test("mixed currencies and mismatched periods cannot produce verified answers", async () => {
  for (const step of [
    { operation: "add", operands: [{ value: 100, unit: "eur" }, { value: 100, unit: "usd" }], unit: "eur" },
    { operation: "divide", operands: [{ value: 120000, unit: "eur" }, { value: 20000, unit: "usd_per_month" }], unit: "months" },
    { operation: "divide", operands: [{ value: 120000, unit: "eur" }, { value: 240000, unit: "eur_per_year" }], unit: "months" },
    { operation: "divide", operands: [{ value: 240000, unit: "eur_per_year" }, { value: 12, unit: "number" }], unit: "eur_per_month" },
    { operation: "divide", operands: [{ value: 120000, unit: "eur" }, { value: 0, unit: "eur_per_month" }], unit: "months" }
  ]) await assert.rejects(calculate.handler({ steps: [{ key: "invalid", ...step }] }));
});

test("operand arity remains enforced and the published schema advertises euros", async () => {
  assert.match(calculate.description, /exactly two operands/);
  const units = calculate.parameters.properties.steps.items.properties.unit.enum;
  for (const value of ["eur", "eur_per_month", "eur_per_year"]) assert.ok(units.includes(value));
  await assert.rejects(calculate.handler({ steps: [{ key: "invalid", operation: "subtract", unit: "eur",
    operands: [1, 2, 3].map(value => ({ value, unit: "eur" })) }] }), /requires between 2 and 2 arguments/);
});

test("euro workbook cells keep euro formatting and dollar cells keep dollar formatting", async () => {
  const rendered = await renderSpreadsheetArtifact({ version: "1", title: "Currencies", sheets: [{ name: "Amounts", cells: [
    { address: "A1", value: 123.45, unit: "eur", format: "currency_precise" },
    { address: "A2", value: -200, unit: "eur_per_month" },
    { address: "A3", value: 123.45, unit: "usd", format: "currency_precise" }
  ] }] });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(rendered.buffer);
  const sheet = workbook.getWorksheet("Amounts");
  assert.equal(sheet.getCell("A1").numFmt, "€#,##0.00;[Red](€#,##0.00);-");
  assert.equal(sheet.getCell("A2").numFmt, "€#,##0;[Red](€#,##0);-");
  assert.match(sheet.getCell("A3").numFmt, /\$/);
  assert.equal(sheet.getCell("A1").value, 123.45);
  assert.equal(rendered.verification.verified, true);
});


test("workbook comparisons cannot silently treat USD and EUR as equivalent", async () => {
  for (const op of ["eq", "ne", "gt", "gte", "lt", "lte"]) {
    await assert.rejects(renderSpreadsheetArtifact({version:"1",title:"Invalid currency comparison",sheets:[{name:"Amounts",cells:[
      {address:"A1",value:100,unit:"usd"}, {address:"A2",value:100,unit:"eur"},
      {address:"A3",formula:{op,args:[{ref:"A1"},{ref:"A2"}]},unit:"boolean"}
    ]}]}), /declares boolean.*produces mixed/);
  }
});
