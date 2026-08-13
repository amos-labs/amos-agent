import {
  formulaReferenceParts,
  normalizeFormulaRange,
  normalizeFormulaReference,
  normalizeSpreadsheetFormula
} from "./spreadsheetFormula.js";

export const SPREADSHEET_VERSION = "1";
export const SPREADSHEET_KINDS = Object.freeze(["general", "financial_model"]);
export const SPREADSHEET_SHEET_ROLES = Object.freeze([
  "summary",
  "assumptions",
  "scenario",
  "model",
  "data",
  "checks",
  "sources",
  "other"
]);
export const SPREADSHEET_CELL_ROLES = Object.freeze([
  "title",
  "metadata",
  "period_header",
  "section_header",
  "subheader",
  "input",
  "linked",
  "formula",
  "total",
  "check",
  "note",
  "body"
]);
export const SPREADSHEET_CELL_FORMATS = Object.freeze([
  "general",
  "text",
  "integer",
  "number",
  "currency",
  "currency_precise",
  "percentage",
  "multiple",
  "date",
  "datetime"
]);
export const SPREADSHEET_UNITS = Object.freeze([
  "number",
  "text",
  "boolean",
  "count",
  "ratio",
  "percentage",
  "months",
  "years",
  "usd",
  "usd_per_month",
  "usd_per_year",
  "count_per_month",
  "count_per_year"
]);

const MAX_SHEETS = 16;
const MAX_CELLS = 6_000;
const MAX_MERGES = 100;
const MAX_CHARTS = 20;
const MAX_CHECKS = 300;
const MAX_SCENARIO_BASELINES = 100;

export function normalizeSpreadsheetSpec(input) {
  const source = object(input, "Spreadsheet must be an object");
  const version = text(source.version || SPREADSHEET_VERSION, "version", 8);
  if (version !== SPREADSHEET_VERSION) throw new Error(`Unsupported spreadsheet version: ${version}`);
  const kind = enumValue(source.kind || "general", SPREADSHEET_KINDS, "kind");
  const sheets = array(source.sheets, "sheets", MAX_SHEETS);
  if (sheets.length === 0) throw new Error("Spreadsheet must include at least one sheet");
  const normalizedSheets = sheets.map((sheet, index) => normalizeSheet(sheet, index));
  const sheetNames = new Set(normalizedSheets.map((sheet) => sheet.name));
  if (sheetNames.size !== normalizedSheets.length) throw new Error("Spreadsheet sheet names must be unique");
  let totalCells = 0;
  for (const sheet of normalizedSheets) totalCells += sheet.cells.length;
  if (totalCells > MAX_CELLS) throw new Error(`Spreadsheet exceeds ${MAX_CELLS} populated cells`);

  const checks = array(source.checks || [], "checks", MAX_CHECKS)
    .map((check, index) => normalizeCheck(check, index, sheetNames));
  const scenarioBaselines = array(
    source.scenario_baselines || source.scenarioBaselines || [],
    "scenario_baselines",
    MAX_SCENARIO_BASELINES
  ).map((baseline, index) => normalizeScenarioBaseline(baseline, index, sheetNames));
  if (kind === "financial_model") {
    const scenarioSheets = normalizedSheets.filter((sheet) => sheet.role === "scenario");
    for (const scenario of scenarioSheets) {
      if (!scenarioBaselines.some((baseline) => baseline.scenarioSheet === scenario.name)) {
        throw new Error(
          `Financial scenario ${scenario.name} must declare at least one current-state baseline invariant`
        );
      }
    }
    if (checks.length === 0 && scenarioBaselines.length === 0) {
      throw new Error("Financial models require deterministic checks or scenario baseline invariants");
    }
  }
  validateReferences(normalizedSheets, checks, scenarioBaselines, sheetNames);
  return {
    version,
    kind,
    title: text(source.title, "title", 200),
    author: optionalText(source.author, "author", 160),
    subject: optionalText(source.subject, "subject", 300),
    description: optionalText(source.description, "description", 1_000),
    sheets: normalizedSheets,
    checks,
    scenarioBaselines
  };
}

function normalizeSheet(input, index) {
  const source = object(input, `sheets[${index}] must be an object`);
  const name = sheetName(source.name, `sheets[${index}].name`);
  const cells = array(source.cells, `sheets[${index}].cells`, MAX_CELLS)
    .map((cell, cellIndex) => normalizeCell(cell, index, cellIndex));
  const addresses = new Set(cells.map((cell) => cell.address));
  if (addresses.size !== cells.length) throw new Error(`Sheet ${name} contains duplicate cell addresses`);
  const merges = array(source.merges || [], `sheets[${index}].merges`, MAX_MERGES)
    .map((value, mergeIndex) => {
      const merge = normalizeFormulaRange(value, `sheets[${index}].merges[${mergeIndex}]`);
      if (merge.includes("!")) throw new Error(`sheets[${index}].merges[${mergeIndex}] must stay on its declared sheet`);
      return merge;
    });
  const widths = array(
    source.column_widths || source.columnWidths || [],
    `sheets[${index}].column_widths`,
    1_000
  ).map((value, widthIndex) => {
    const width = object(value, `sheets[${index}].column_widths[${widthIndex}] must be an object`);
    const column = text(width.column, `sheets[${index}].column_widths[${widthIndex}].column`, 3).toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(column)) throw new Error(`Invalid column width target: ${column}`);
    const size = finiteNumber(width.width, `sheets[${index}].column_widths[${widthIndex}].width`);
    if (size < 3 || size > 80) throw new Error("Spreadsheet column widths must be between 3 and 80");
    return { column, width: size };
  });
  const charts = array(source.charts || [], `sheets[${index}].charts`, MAX_CHARTS)
    .map((chart, chartIndex) => normalizeChart(chart, index, chartIndex));
  return {
    name,
    role: enumValue(source.role || "other", SPREADSHEET_SHEET_ROLES, `sheets[${index}].role`),
    showGridLines: source.show_grid_lines === true || source.showGridLines === true,
    freezeRows: boundedInteger(source.freeze_rows ?? source.freezeRows ?? 0, `sheets[${index}].freeze_rows`, 0, 100),
    freezeColumns: boundedInteger(source.freeze_columns ?? source.freezeColumns ?? 0, `sheets[${index}].freeze_columns`, 0, 50),
    cells,
    merges,
    columnWidths: widths,
    charts
  };
}

function normalizeCell(input, sheetIndex, cellIndex) {
  const path = `sheets[${sheetIndex}].cells[${cellIndex}]`;
  const source = object(input, `${path} must be an object`);
  const address = normalizeFormulaReference(source.address, `${path}.address`);
  if (address.includes("!")) throw new Error(`${path}.address must stay on its declared sheet`);
  const hasValue = Object.hasOwn(source, "value");
  const hasFormula = Object.hasOwn(source, "formula");
  if (hasValue === hasFormula) throw new Error(`${path} must include exactly one of value or formula`);
  let value;
  let formula;
  if (hasValue) {
    value = source.value;
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`${path}.value must be text, a number, a boolean, or null`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${path}.value must be finite`);
    if (typeof value === "string" && value.length > 20_000) throw new Error(`${path}.value is too long`);
  } else {
    formula = normalizeSpreadsheetFormula(source.formula, `${path}.formula`);
  }
  const unit = enumValue(
    source.unit || defaultUnit(value),
    SPREADSHEET_UNITS,
    `${path}.unit`
  );
  return {
    address,
    ...(hasValue ? { value } : { formula }),
    unit,
    format: enumValue(
      source.format || defaultFormat(unit),
      SPREADSHEET_CELL_FORMATS,
      `${path}.format`
    ),
    role: enumValue(
      source.role || (hasFormula ? "formula" : "body"),
      SPREADSHEET_CELL_ROLES,
      `${path}.role`
    ),
    note: optionalText(source.note, `${path}.note`, 2_000),
    wrap: source.wrap === true,
    indent: boundedInteger(source.indent || 0, `${path}.indent`, 0, 10)
  };
}

function normalizeChart(input, sheetIndex, chartIndex) {
  const path = `sheets[${sheetIndex}].charts[${chartIndex}]`;
  const source = object(input, `${path} must be an object`);
  const series = array(source.series, `${path}.series`, 6).map((item, index) => {
    const value = object(item, `${path}.series[${index}] must be an object`);
    return {
      name: text(value.name, `${path}.series[${index}].name`, 100),
      values: normalizeFormulaRange(value.values, `${path}.series[${index}].values`),
      color: normalizeColor(value.color || "315FD6", `${path}.series[${index}].color`)
    };
  });
  if (series.length === 0) throw new Error(`${path}.series cannot be empty`);
  const from = normalizeFormulaReference(source.from || "H2", `${path}.from`);
  const to = normalizeFormulaReference(source.to || "P18", `${path}.to`);
  if (from.includes("!") || to.includes("!")) throw new Error(`${path} positions must stay on the chart sheet`);
  return {
    type: enumValue(source.type || "line", ["line", "bar"], `${path}.type`),
    title: text(source.title, `${path}.title`, 160),
    categories: normalizeFormulaRange(source.categories, `${path}.categories`),
    series,
    from,
    to,
    yUnit: enumValue(source.y_unit || source.yUnit || "number", SPREADSHEET_UNITS, `${path}.y_unit`)
  };
}

function normalizeCheck(input, index, sheetNames) {
  const path = `checks[${index}]`;
  const source = object(input, `${path} must be an object`);
  return {
    label: text(source.label, `${path}.label`, 200),
    actual: normalizeCellPointer(source.actual, `${path}.actual`, sheetNames),
    expected: normalizeCheckExpected(source.expected, `${path}.expected`, sheetNames),
    operator: enumValue(source.operator || "equals", ["equals", "gte", "lte"], `${path}.operator`),
    tolerance: boundedNumber(source.tolerance ?? 0, `${path}.tolerance`, 0, Number.MAX_SAFE_INTEGER),
    note: optionalText(source.note, `${path}.note`, 1_000),
    required: source.required !== false
  };
}

function normalizeScenarioBaseline(input, index, sheetNames) {
  const path = `scenario_baselines[${index}]`;
  const source = object(input, `${path} must be an object`);
  const scenarioSheet = sheetName(source.scenario_sheet || source.scenarioSheet, `${path}.scenario_sheet`);
  if (!sheetNames.has(scenarioSheet)) throw new Error(`${path} references an unknown scenario sheet`);
  const target = normalizeCellPointer(
    source.target?.sheet ? source.target : { ...source.target, sheet: scenarioSheet },
    `${path}.target`,
    sheetNames
  );
  if (target.sheet !== scenarioSheet) {
    throw new Error(`${path}.target must be on its declared scenario sheet`);
  }
  return {
    label: text(source.label, `${path}.label`, 200),
    scenarioSheet,
    source: normalizeCellPointer(source.source, `${path}.source`, sheetNames),
    target,
    tolerance: boundedNumber(source.tolerance ?? 0, `${path}.tolerance`, 0, Number.MAX_SAFE_INTEGER)
  };
}

function normalizeCheckExpected(input, path, sheetNames) {
  const source = object(input, `${path} must be an object`);
  if (source.ref) return { ref: normalizeCellPointer(source.ref, `${path}.ref`, sheetNames) };
  if (!Object.hasOwn(source, "value")) throw new Error(`${path} requires value or ref`);
  if (!["string", "number", "boolean"].includes(typeof source.value)) {
    throw new Error(`${path}.value must be text, a number, or a boolean`);
  }
  return {
    value: source.value,
    unit: enumValue(source.unit || defaultUnit(source.value), SPREADSHEET_UNITS, `${path}.unit`)
  };
}

function normalizeCellPointer(input, path, sheetNames) {
  const source = object(input, `${path} must be an object`);
  const sheet = sheetName(source.sheet, `${path}.sheet`);
  if (!sheetNames.has(sheet)) throw new Error(`${path} references an unknown sheet`);
  const cell = normalizeFormulaReference(source.cell, `${path}.cell`);
  if (cell.includes("!")) throw new Error(`${path}.cell must not repeat the sheet name`);
  return { sheet, cell };
}

function validateReferences(sheets, checks, baselines, sheetNames) {
  const cells = new Set(sheets.flatMap((sheet) => sheet.cells.map((cell) => `${sheet.name}!${cell.address}`)));
  const requireCell = (pointer, path) => {
    if (!cells.has(`${pointer.sheet}!${pointer.cell}`)) throw new Error(`${path} references an empty cell`);
  };
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!cell.formula) continue;
      visitFormulaReferences(cell.formula, sheet.name, (reference) => {
        if (!sheetNames.has(reference.sheet)) throw new Error(`${sheet.name}!${cell.address} references an unknown sheet`);
        if (reference.kind === "cell" && !cells.has(`${reference.sheet}!${reference.start}`)) {
          throw new Error(`${sheet.name}!${cell.address} references an empty cell ${reference.sheet}!${reference.start}`);
        }
      });
    }
    for (const chart of sheet.charts) {
      for (const value of [chart.categories, ...chart.series.map((series) => series.values)]) {
        const parts = formulaReferenceParts(value, sheet.name, { range: true });
        if (!sheetNames.has(parts.sheet)) throw new Error(`${chart.title} references an unknown sheet`);
      }
    }
  }
  checks.forEach((check, index) => {
    requireCell(check.actual, `checks[${index}].actual`);
    if (check.expected.ref) requireCell(check.expected.ref, `checks[${index}].expected.ref`);
  });
  baselines.forEach((baseline, index) => {
    requireCell(baseline.source, `scenario_baselines[${index}].source`);
    requireCell(baseline.target, `scenario_baselines[${index}].target`);
  });
}

function visitFormulaReferences(node, currentSheet, callback) {
  if (node.ref) {
    const parts = formulaReferenceParts(node.ref, currentSheet);
    callback({ ...parts, kind: "cell" });
    return;
  }
  if (node.range) {
    const parts = formulaReferenceParts(node.range, currentSheet, { range: true });
    callback({ ...parts, kind: "range" });
    return;
  }
  for (const arg of node.args || []) visitFormulaReferences(arg, currentSheet, callback);
}

function defaultUnit(value) {
  if (typeof value === "string" || value === null) return "text";
  if (typeof value === "boolean") return "boolean";
  return "number";
}

function defaultFormat(unit) {
  if (["usd", "usd_per_month", "usd_per_year"].includes(unit)) return "currency";
  if (unit === "percentage") return "percentage";
  if (unit === "ratio") return "number";
  if (["count", "months", "years", "count_per_month", "count_per_year"].includes(unit)) return "integer";
  if (unit === "text") return "text";
  return "general";
}

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function array(value, path, maximum) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > maximum) throw new Error(`${path} exceeds ${maximum} items`);
  return value;
}

function text(value, path, maximum) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${path} is required`);
  if (result.length > maximum) throw new Error(`${path} exceeds ${maximum} characters`);
  return result;
}

function optionalText(value, path, maximum) {
  if (value === undefined || value === null || value === "") return "";
  return text(value, path, maximum);
}

function enumValue(value, allowed, path) {
  if (!allowed.includes(value)) throw new Error(`${path} must be one of: ${allowed.join(", ")}`);
  return value;
}

function sheetName(value, path) {
  const result = text(value, path, 31);
  if (/[\\/?*:[\]]/.test(result)) throw new Error(`${path} contains an invalid Excel sheet character`);
  return result;
}

function finiteNumber(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${path} must be a finite number`);
  return number;
}

function boundedNumber(value, path, minimum, maximum) {
  const number = finiteNumber(value, path);
  if (number < minimum || number > maximum) throw new Error(`${path} is outside its allowed range`);
  return number;
}

function boundedInteger(value, path, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${path} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}

function normalizeColor(value, path) {
  const color = String(value || "").replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(color)) throw new Error(`${path} must be a six-digit RGB color`);
  return color;
}
