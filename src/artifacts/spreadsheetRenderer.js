import { createCanvas } from "@napi-rs/canvas";
import ExcelJS from "exceljs";
import {
  compileSpreadsheetFormula,
  evaluateSpreadsheetFormula,
  inferSpreadsheetFormulaUnit,
  spreadsheetRangeCells
} from "./spreadsheetFormula.js";
import { normalizeSpreadsheetSpec } from "./spreadsheetSpec.js";

const COLORS = Object.freeze({
  navy: "172033",
  blue: "315FD6",
  paleBlue: "EAF0FF",
  lighterBlue: "F5F7FF",
  green: "168257",
  paleGreen: "E8F7F0",
  red: "C53E3E",
  paleRed: "FDECEC",
  amber: "9A6500",
  paleAmber: "FFF4D6",
  gray: "667085",
  paleGray: "F2F4F7",
  line: "D7DDE8",
  white: "FFFFFF",
  black: "000000"
});

const NUMBER_FORMATS = Object.freeze({
  general: "General",
  text: "@",
  integer: "#,##0;[Red](#,##0);-",
  number: "#,##0.00;[Red](#,##0.00);-",
  currency: "$#,##0;[Red]($#,##0);-",
  currency_precise: "$#,##0.00;[Red]($#,##0.00);-",
  percentage: "0.0%;[Red](0.0%);-",
  multiple: "0.0x;[Red](0.0x);-",
  date: "mmm yyyy",
  datetime: "yyyy-mm-dd hh:mm"
});

export async function renderSpreadsheetArtifact(input) {
  const spec = normalizeSpreadsheetSpec(input);
  const calculation = calculateSpreadsheet(spec);
  const requiredFailures = calculation.checks.filter((check) => check.required && !check.passed);
  if (requiredFailures.length > 0) {
    throw new Error(
      `Spreadsheet failed required checks: ${requiredFailures.map((check) => check.label).join("; ")}`
    );
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = spec.author || "AMOS Desktop";
  workbook.lastModifiedBy = "AMOS Desktop deterministic spreadsheet engine";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = spec.subject || spec.description || spec.title;
  workbook.title = spec.title;
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;

  const worksheets = new Map();
  for (const sheetSpec of spec.sheets) {
    const worksheet = workbook.addWorksheet(sheetSpec.name, {
      views: [{
        state: sheetSpec.freezeRows || sheetSpec.freezeColumns ? "frozen" : "normal",
        xSplit: sheetSpec.freezeColumns,
        ySplit: sheetSpec.freezeRows,
        showGridLines: sheetSpec.showGridLines
      }],
      properties: { defaultRowHeight: 18 },
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });
    worksheets.set(sheetSpec.name, worksheet);
  }

  for (const sheetSpec of spec.sheets) {
    const worksheet = worksheets.get(sheetSpec.name);
    for (const merge of sheetSpec.merges) worksheet.mergeCells(merge);
    for (const width of sheetSpec.columnWidths) worksheet.getColumn(width.column).width = width.width;
    for (const cellSpec of sheetSpec.cells) {
      const cell = worksheet.getCell(cellSpec.address);
      const key = cellKey(sheetSpec.name, cellSpec.address);
      const result = calculation.values.get(key);
      if (cellSpec.formula) {
        cell.value = {
          formula: compileSpreadsheetFormula(cellSpec.formula, sheetSpec.name).slice(1),
          result
        };
      } else {
        cell.value = excelCellValue(cellSpec.value, cellSpec.format);
      }
      applyCellStyle(cell, cellSpec);
      if (cellSpec.note) {
        cell.note = {
          texts: [{ font: { name: "Aptos", size: 10 }, text: cellSpec.note }],
          margins: { insetmode: "auto" },
          protection: { locked: true, lockText: false },
          editAs: "absolute"
        };
      }
    }
    applyUsefulWidths(worksheet, sheetSpec);
    for (const chart of sheetSpec.charts) {
      const snapshot = renderChartSnapshot(chart, sheetSpec.name, calculation);
      const imageId = workbook.addImage({ buffer: snapshot.buffer, extension: "png" });
      const from = decodeCell(chart.from);
      const to = decodeCell(chart.to);
      worksheet.addImage(imageId, {
        tl: { col: from.column - 1, row: from.row - 1 },
        br: { col: to.column - 1, row: to.row - 1 },
        editAs: "oneCell"
      });
    }
  }

  if (calculation.checks.length > 0 && !worksheets.has("AMOS Checks")) {
    addChecksWorksheet(workbook, calculation.checks);
  }

  const written = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(written);
  const verification = await verifySpreadsheetBuffer(buffer, spec, calculation);
  return {
    spec,
    buffer,
    verification,
    preview: spreadsheetPreview(spec, calculation)
  };
}

export function calculateSpreadsheet(input) {
  const spec = input?.version ? input : normalizeSpreadsheetSpec(input);
  const cells = new Map();
  for (const sheet of spec.sheets) {
    for (const cell of sheet.cells) cells.set(cellKey(sheet.name, cell.address), { sheet: sheet.name, ...cell });
  }
  const values = new Map();
  const units = new Map();
  const resolvingValues = new Set();
  const resolvingUnits = new Set();
  const context = {
    resolveCell(sheet, address) {
      const key = cellKey(sheet, address);
      if (values.has(key)) return values.get(key);
      const cell = cells.get(key);
      if (!cell) throw new Error(`Spreadsheet formula references empty cell ${key}`);
      if (resolvingValues.has(key)) throw new Error(`Spreadsheet contains a circular formula at ${key}`);
      resolvingValues.add(key);
      try {
        const value = cell.formula
          ? evaluateSpreadsheetFormula(cell.formula, context, sheet)
          : cell.value;
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new Error(`Spreadsheet calculation at ${key} was not finite`);
        }
        values.set(key, value);
        return value;
      } finally {
        resolvingValues.delete(key);
      }
    },
    resolveUnit(sheet, address) {
      const key = cellKey(sheet, address);
      if (units.has(key)) return units.get(key);
      const cell = cells.get(key);
      if (!cell) throw new Error(`Spreadsheet unit check references empty cell ${key}`);
      if (resolvingUnits.has(key)) throw new Error(`Spreadsheet contains a circular unit dependency at ${key}`);
      resolvingUnits.add(key);
      try {
        if (cell.formula) {
          const inferred = inferSpreadsheetFormulaUnit(cell.formula, context, sheet);
          if (inferred !== cell.unit) {
            throw new Error(
              `${key} declares ${cell.unit} but its deterministic formula produces ${inferred}. ` +
              "Use an explicit annual_to_monthly or monthly_to_annual operation for period conversions."
            );
          }
        }
        units.set(key, cell.unit);
        return cell.unit;
      } finally {
        resolvingUnits.delete(key);
      }
    }
  };

  for (const cell of cells.values()) {
    context.resolveUnit(cell.sheet, cell.address);
    context.resolveCell(cell.sheet, cell.address);
  }
  const checks = [
    ...spec.checks.map((check) => evaluateCheck(check, context)),
    ...spec.scenarioBaselines.map((baseline) => evaluateBaseline(baseline, context))
  ];
  return { spec, cells, values, units, checks, context };
}

async function verifySpreadsheetBuffer(buffer, spec, calculation) {
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4B)) {
    throw new Error("Generated XLSX did not contain a valid ZIP package header");
  }
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  const expectedSheets = spec.sheets.length + (
    calculation.checks.length > 0 && !spec.sheets.some((sheet) => sheet.name === "AMOS Checks") ? 1 : 0
  );
  if (reopened.worksheets.length !== expectedSheets) {
    throw new Error("Generated XLSX did not reopen with the expected sheets");
  }
  let formulaCount = 0;
  for (const sheet of spec.sheets) {
    const worksheet = reopened.getWorksheet(sheet.name);
    if (!worksheet) throw new Error(`Generated XLSX lost sheet ${sheet.name}`);
    for (const cell of sheet.cells.filter((item) => item.formula)) {
      const value = worksheet.getCell(cell.address).value;
      if (!value || typeof value !== "object" || !value.formula) {
        throw new Error(`Generated XLSX lost formula ${sheet.name}!${cell.address}`);
      }
      formulaCount += 1;
    }
  }
  return {
    verified: true,
    sheetCount: reopened.worksheets.length,
    formulaCount,
    checkCount: calculation.checks.length,
    checksPassed: calculation.checks.filter((check) => check.passed).length,
    requiredChecksPassed: calculation.checks.every((check) => !check.required || check.passed)
  };
}

function spreadsheetPreview(spec, calculation) {
  const preferred = spec.sheets.find((sheet) => sheet.role === "summary") ||
    spec.sheets.find((sheet) => sheet.role === "scenario") ||
    spec.sheets[0];
  const table = previewTable(preferred, calculation);
  const charts = [];
  for (const sheet of spec.sheets) {
    for (const chart of sheet.charts.slice(0, 4 - charts.length)) {
      charts.push(chartPreview(chart, sheet.name, calculation));
    }
    if (charts.length >= 4) break;
  }
  return {
    title: spec.title,
    kind: spec.kind,
    sheetNames: spec.sheets.map((sheet) => sheet.name),
    table,
    charts,
    checks: calculation.checks
  };
}

function previewTable(sheet, calculation) {
  const populated = sheet.cells.map((cell) => ({ ...decodeCell(cell.address), cell }));
  const maxRow = Math.min(25, Math.max(...populated.map((item) => item.row), 1));
  const maxColumn = Math.min(8, Math.max(...populated.map((item) => item.column), 1));
  const rows = [];
  for (let row = 1; row <= maxRow; row += 1) {
    const values = [];
    for (let column = 1; column <= maxColumn; column += 1) {
      const address = `${encodeColumn(column)}${row}`;
      values.push(calculation.values.get(cellKey(sheet.name, address)) ?? null);
    }
    if (values.some((value) => value !== null && value !== "")) rows.push(values);
  }
  const width = Math.max(...rows.map((row) => row.length), 1);
  const letterHeaders = Array.from({ length: width }, (_, index) => encodeColumn(index + 1));
  const firstRow = rows[0] || [];
  const semanticHeader = firstRow.filter((value) => value !== null && value !== "").length >= 2 &&
    firstRow.every((value) => value === null || value === "" || typeof value === "string");
  return {
    sheet: sheet.name,
    headers: semanticHeader
      ? letterHeaders.map((letter, index) => String(firstRow[index] || letter))
      : letterHeaders,
    rows: semanticHeader ? rows.slice(1) : rows
  };
}

function chartPreview(chart, currentSheet, calculation) {
  const categoryRange = spreadsheetRangeCells(chart.categories, currentSheet);
  const categories = categoryRange.addresses.map((address) =>
    String(calculation.context.resolveCell(categoryRange.sheet, address) ?? "")
  );
  return {
    type: chart.type,
    title: chart.title,
    yUnit: chart.yUnit,
    categories,
    series: chart.series.map((series) => {
      const valueRange = spreadsheetRangeCells(series.values, currentSheet);
      return {
        name: series.name,
        color: series.color,
        values: valueRange.addresses.map((address) =>
          numericValue(calculation.context.resolveCell(valueRange.sheet, address), chart.title)
        )
      };
    })
  };
}

function renderChartSnapshot(chart, currentSheet, calculation) {
  const preview = chartPreview(chart, currentSheet, calculation);
  const width = 960;
  const height = 520;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#172033";
  context.font = "bold 24px Arial";
  context.fillText(preview.title, 54, 48);
  context.fillStyle = "#667085";
  context.font = "14px Arial";
  context.fillText("Verified snapshot at generation · source cells remain editable", 54, 72);
  const plot = { left: 82, top: 104, width: 816, height: 330 };
  const allValues = preview.series.flatMap((series) => series.values);
  const minimum = Math.min(0, ...allValues);
  const maximum = Math.max(1, ...allValues);
  const spread = maximum - minimum || 1;
  context.strokeStyle = "#D7DDE8";
  context.lineWidth = 1;
  for (let index = 0; index < 5; index += 1) {
    const y = plot.top + (plot.height * index) / 4;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.left + plot.width, y);
    context.stroke();
  }
  preview.series.forEach((series, seriesIndex) => {
    context.strokeStyle = `#${series.color}`;
    context.fillStyle = `#${series.color}`;
    context.lineWidth = 4;
    if (preview.type === "bar") {
      const groupWidth = plot.width / Math.max(1, preview.categories.length);
      const barWidth = Math.max(4, (groupWidth * 0.7) / preview.series.length);
      series.values.forEach((value, index) => {
        const normalized = (value - minimum) / spread;
        const barHeight = normalized * plot.height;
        const x = plot.left + groupWidth * index + groupWidth * 0.15 + seriesIndex * barWidth;
        context.fillRect(x, plot.top + plot.height - barHeight, barWidth - 2, barHeight);
      });
    } else {
      context.beginPath();
      series.values.forEach((value, index) => {
        const x = plot.left + (plot.width * index) / Math.max(1, series.values.length - 1);
        const y = plot.top + plot.height - ((value - minimum) / spread) * plot.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
  });
  context.font = "12px Arial";
  context.fillStyle = "#667085";
  const labelEvery = Math.max(1, Math.ceil(preview.categories.length / 8));
  preview.categories.forEach((category, index) => {
    if (index % labelEvery !== 0 && index !== preview.categories.length - 1) return;
    const x = plot.left + (plot.width * index) / Math.max(1, preview.categories.length - 1);
    context.fillText(String(category).slice(0, 12), Math.max(plot.left, x - 20), plot.top + plot.height + 24);
  });
  let legendX = 54;
  for (const series of preview.series) {
    context.fillStyle = `#${series.color}`;
    context.fillRect(legendX, 476, 18, 5);
    context.fillStyle = "#172033";
    context.fillText(series.name, legendX + 25, 483);
    legendX += Math.min(260, 45 + series.name.length * 8);
  }
  return { buffer: canvas.toBuffer("image/png"), preview };
}

function addChecksWorksheet(workbook, checks) {
  const worksheet = workbook.addWorksheet("AMOS Checks", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }]
  });
  worksheet.columns = [
    { header: "Check", key: "label", width: 34 },
    { header: "Actual", key: "actual", width: 18 },
    { header: "Expected", key: "expected", width: 18 },
    { header: "Difference", key: "difference", width: 16 },
    { header: "Tolerance", key: "tolerance", width: 14 },
    { header: "Status", key: "status", width: 12 },
    { header: "Notes", key: "note", width: 48 }
  ];
  worksheet.getRow(1).eachCell((cell) => {
    cell.fill = solid(COLORS.blue);
    cell.font = { bold: true, color: { argb: `FF${COLORS.white}` } };
    cell.alignment = { vertical: "middle" };
  });
  for (const check of checks) {
    const row = worksheet.addRow({
      label: check.label,
      actual: check.actual,
      expected: check.expected,
      difference: check.difference,
      tolerance: check.tolerance,
      status: check.passed ? "OK" : "FAIL",
      note: check.note || (check.required ? "Required deterministic check" : "")
    });
    row.getCell(6).fill = solid(check.passed ? COLORS.paleGreen : COLORS.paleRed);
    row.getCell(6).font = { bold: true, color: { argb: `FF${check.passed ? COLORS.green : COLORS.red}` } };
  }
  worksheet.autoFilter = { from: "A1", to: `G${checks.length + 1}` };
}

function evaluateCheck(check, context) {
  const actual = context.resolveCell(check.actual.sheet, check.actual.cell);
  const actualUnit = context.resolveUnit(check.actual.sheet, check.actual.cell);
  const expected = check.expected.ref
    ? context.resolveCell(check.expected.ref.sheet, check.expected.ref.cell)
    : check.expected.value;
  const expectedUnit = check.expected.ref
    ? context.resolveUnit(check.expected.ref.sheet, check.expected.ref.cell)
    : check.expected.unit;
  if (actualUnit !== expectedUnit) {
    return {
      ...check,
      actual,
      expected,
      difference: null,
      passed: false,
      note: `${check.note ? `${check.note} · ` : ""}Unit mismatch: ${actualUnit} vs ${expectedUnit}`
    };
  }
  return checkResult(check, actual, expected);
}

function evaluateBaseline(baseline, context) {
  const actual = context.resolveCell(baseline.target.sheet, baseline.target.cell);
  const expected = context.resolveCell(baseline.source.sheet, baseline.source.cell);
  const actualUnit = context.resolveUnit(baseline.target.sheet, baseline.target.cell);
  const expectedUnit = context.resolveUnit(baseline.source.sheet, baseline.source.cell);
  const check = {
    label: `${baseline.scenarioSheet}: ${baseline.label}`,
    operator: "equals",
    tolerance: baseline.tolerance,
    required: true,
    note: `Current-state baseline must tie to ${baseline.source.sheet}!${baseline.source.cell}`
  };
  if (actualUnit !== expectedUnit) {
    return { ...check, actual, expected, difference: null, passed: false, note: `${check.note} · Unit mismatch` };
  }
  return checkResult(check, actual, expected);
}

function checkResult(check, actual, expected) {
  const numeric = typeof actual === "number" && typeof expected === "number";
  const difference = numeric ? actual - expected : actual === expected ? 0 : null;
  const passed = check.operator === "equals"
    ? numeric
      ? Math.abs(difference) <= check.tolerance
      : actual === expected
    : check.operator === "gte"
      ? numeric && actual + check.tolerance >= expected
      : numeric && actual - check.tolerance <= expected;
  return { ...check, actual, expected, difference, passed };
}

function applyCellStyle(cell, spec) {
  const style = roleStyle(spec.role);
  cell.font = style.font;
  cell.fill = style.fill;
  cell.border = style.border;
  cell.alignment = {
    horizontal: typeof cell.value === "number" || spec.unit !== "text" ? "right" : "left",
    vertical: "middle",
    wrapText: spec.wrap,
    indent: spec.indent
  };
  cell.numFmt = NUMBER_FORMATS[spec.format];
  if (spec.role === "input") cell.protection = { locked: false };
}

function roleStyle(role) {
  const base = {
    font: { name: "Aptos", size: 10, color: { argb: `FF${COLORS.black}` } },
    fill: solid(COLORS.white),
    border: {}
  };
  if (role === "title") return {
    ...base,
    font: { name: "Aptos Display", size: 18, bold: true, color: { argb: `FF${COLORS.white}` } },
    fill: solid(COLORS.navy)
  };
  if (role === "section_header") return {
    ...base,
    font: { name: "Aptos", size: 10, bold: true, color: { argb: `FF${COLORS.white}` } },
    fill: solid(COLORS.blue)
  };
  if (["period_header", "subheader"].includes(role)) return {
    ...base,
    font: { name: "Aptos", size: 10, bold: true, color: { argb: `FF${COLORS.navy}` } },
    fill: solid(COLORS.paleBlue),
    border: { bottom: { style: "thin", color: { argb: `FF${COLORS.line}` } } }
  };
  if (role === "input") return {
    ...base,
    font: { name: "Aptos", size: 10, color: { argb: "FF0000FF" } },
    fill: solid(COLORS.paleAmber)
  };
  if (role === "linked") return {
    ...base,
    font: { name: "Aptos", size: 10, color: { argb: "FF008000" } }
  };
  if (role === "total") return {
    ...base,
    font: { name: "Aptos", size: 10, bold: true, color: { argb: `FF${COLORS.navy}` } },
    border: { top: { style: "thin", color: { argb: `FF${COLORS.navy}` } }, bottom: { style: "double", color: { argb: `FF${COLORS.navy}` } } }
  };
  if (role === "check") return { ...base, fill: solid(COLORS.paleGreen) };
  if (role === "metadata" || role === "note") return {
    ...base,
    font: { name: "Aptos", size: 9, italic: true, color: { argb: `FF${COLORS.gray}` } }
  };
  return base;
}

function applyUsefulWidths(worksheet, sheetSpec) {
  const explicit = new Set(sheetSpec.columnWidths.map((item) => item.column));
  const sourceByAddress = new Map(sheetSpec.cells.map((cell) => [cell.address, cell]));
  for (let index = 1; index <= worksheet.columnCount; index += 1) {
    const column = worksheet.getColumn(index);
    if (explicit.has(column.letter)) continue;
    let width = 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const value = displayValue(cell.value);
      const source = sourceByAddress.get(cell.address);
      const multiplier = source?.role === "title" ? 1.55 :
        ["section_header", "period_header", "subheader"].includes(source?.role) ? 1.15 : 1;
      width = Math.max(width, Math.min(42, value.length * multiplier + 3));
    });
    column.width = width;
  }
}

function excelCellValue(value, format) {
  if (value === null) return null;
  if (["date", "datetime"].includes(format)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Spreadsheet date value is invalid: ${value}`);
    return parsed;
  }
  return value;
}

function displayValue(value) {
  if (value && typeof value === "object" && value.formula) return String(value.result ?? value.formula);
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function cellKey(sheet, address) {
  return `${sheet}!${address}`;
}

function solid(color) {
  return { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
}

function decodeCell(address) {
  const match = String(address).match(/^([A-Z]+)(\d+)$/);
  let column = 0;
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}

function encodeColumn(value) {
  let column = value;
  let result = "";
  while (column > 0) {
    column -= 1;
    result = String.fromCharCode(65 + (column % 26)) + result;
    column = Math.floor(column / 26);
  }
  return result;
}

function numericValue(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} chart source must contain finite numbers`);
  }
  return value;
}
