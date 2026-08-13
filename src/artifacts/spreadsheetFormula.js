const FORMULA_OPERATIONS = new Set([
  "add",
  "subtract",
  "multiply",
  "divide",
  "power",
  "sum",
  "average",
  "min",
  "max",
  "round",
  "if",
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "annual_to_monthly",
  "monthly_to_annual",
  "negate",
  "abs"
]);

const DIMENSIONLESS_UNITS = new Set([
  "number",
  "count",
  "ratio",
  "percentage",
  "months",
  "years"
]);

const OP_ARITY = Object.freeze({
  subtract: [2, 2],
  divide: [2, 2],
  power: [2, 2],
  round: [1, 2],
  if: [3, 3],
  eq: [2, 2],
  ne: [2, 2],
  gt: [2, 2],
  gte: [2, 2],
  lt: [2, 2],
  lte: [2, 2],
  annual_to_monthly: [1, 1],
  monthly_to_annual: [1, 1],
  negate: [1, 1],
  abs: [1, 1],
  add: [2, 64],
  multiply: [2, 64],
  sum: [1, 64],
  average: [1, 64],
  min: [1, 64],
  max: [1, 64]
});

export function normalizeSpreadsheetFormula(value, path = "formula", depth = 0) {
  if (depth > 16) throw new Error(`${path} exceeds the maximum formula depth`);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be a typed formula object`);
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (Object.hasOwn(value, "value")) {
    if (keys.some((key) => key !== "value")) {
      throw new Error(`${path}.value cannot be combined with another formula form`);
    }
    if (!["string", "number", "boolean"].includes(typeof value.value)) {
      throw new Error(`${path}.value must be text, a number, or a boolean`);
    }
    if (typeof value.value === "number" && !Number.isFinite(value.value)) {
      throw new Error(`${path}.value must be finite`);
    }
    return { value: value.value };
  }
  if (Object.hasOwn(value, "ref")) {
    if (keys.some((key) => key !== "ref")) {
      throw new Error(`${path}.ref cannot be combined with another formula form`);
    }
    return { ref: normalizeFormulaReference(value.ref, `${path}.ref`) };
  }
  if (Object.hasOwn(value, "range")) {
    if (keys.some((key) => key !== "range")) {
      throw new Error(`${path}.range cannot be combined with another formula form`);
    }
    return { range: normalizeFormulaRange(value.range, `${path}.range`) };
  }
  const op = String(value.op || "").trim().toLowerCase();
  if (!FORMULA_OPERATIONS.has(op)) throw new Error(`${path}.op is not supported`);
  const args = Array.isArray(value.args) ? value.args : [];
  const [minimum, maximum] = OP_ARITY[op];
  if (args.length < minimum || args.length > maximum) {
    throw new Error(`${path}.${op} requires between ${minimum} and ${maximum} arguments`);
  }
  return {
    op,
    args: args.map((arg, index) => normalizeSpreadsheetFormula(
      arg,
      `${path}.args[${index}]`,
      depth + 1
    ))
  };
}

export function compileSpreadsheetFormula(node, currentSheet) {
  const expression = compileNode(node, currentSheet);
  return `=${expression}`;
}

export function evaluateSpreadsheetFormula(node, context, currentSheet) {
  return evaluateNode(node, context, currentSheet);
}

export function inferSpreadsheetFormulaUnit(node, context, currentSheet) {
  return inferNodeUnit(node, context, currentSheet);
}

export function normalizeFormulaReference(value, path = "reference") {
  const parsed = parseReference(value, path, false);
  return parsed.sheet ? `${quoteSheet(parsed.sheet)}!${parsed.start}` : parsed.start;
}

export function normalizeFormulaRange(value, path = "range") {
  const parsed = parseReference(value, path, true);
  const address = `${parsed.start}:${parsed.end}`;
  return parsed.sheet ? `${quoteSheet(parsed.sheet)}!${address}` : address;
}

export function formulaReferenceParts(value, currentSheet, { range = false } = {}) {
  const parsed = parseReference(value, "formula reference", range);
  return {
    sheet: parsed.sheet || currentSheet,
    start: parsed.start,
    end: parsed.end || parsed.start
  };
}

export function spreadsheetRangeCells(value, currentSheet) {
  const { sheet, start, end } = formulaReferenceParts(value, currentSheet, { range: true });
  return { sheet, addresses: expandRange(start, end) };
}

function compileNode(node, currentSheet) {
  if (Object.hasOwn(node, "value")) return excelLiteral(node.value);
  if (node.ref) return compileReference(node.ref, currentSheet, false);
  if (node.range) return compileReference(node.range, currentSheet, true);
  const args = node.args.map((arg) => compileNode(arg, currentSheet));
  if (node.op === "add") return parenthesized(args.join("+"));
  if (node.op === "subtract") return parenthesized(`${args[0]}-${args[1]}`);
  if (node.op === "multiply") return parenthesized(args.join("*"));
  if (node.op === "divide") return parenthesized(`${args[0]}/${args[1]}`);
  if (node.op === "power") return parenthesized(`${args[0]}^${args[1]}`);
  if (node.op === "negate") return parenthesized(`-${args[0]}`);
  if (node.op === "annual_to_monthly") return parenthesized(`${args[0]}/12`);
  if (node.op === "monthly_to_annual") return parenthesized(`${args[0]}*12`);
  if (["eq", "ne", "gt", "gte", "lt", "lte"].includes(node.op)) {
    const operator = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[node.op];
    return parenthesized(`${args[0]}${operator}${args[1]}`);
  }
  const functionName = {
    sum: "SUM",
    average: "AVERAGE",
    min: "MIN",
    max: "MAX",
    round: "ROUND",
    if: "IF",
    abs: "ABS"
  }[node.op];
  return `${functionName}(${args.join(",")})`;
}

function evaluateNode(node, context, currentSheet) {
  if (Object.hasOwn(node, "value")) return node.value;
  if (node.ref) return context.resolveCell(...referenceCell(node.ref, currentSheet));
  if (node.range) {
    const { sheet, start, end } = formulaReferenceParts(node.range, currentSheet, { range: true });
    return expandRange(start, end).map((address) => context.resolveCell(sheet, address));
  }
  const values = node.args.map((arg) => evaluateNode(arg, context, currentSheet));
  const flat = () => values.flat(Infinity);
  if (node.op === "add") return numeric(values, node.op).reduce((sum, item) => sum + item, 0);
  if (node.op === "subtract") return number(values[0], node.op) - number(values[1], node.op);
  if (node.op === "multiply") return numeric(values, node.op).reduce((product, item) => product * item, 1);
  if (node.op === "divide") {
    const divisor = number(values[1], node.op);
    if (divisor === 0) throw new Error("Spreadsheet formula attempted to divide by zero");
    return number(values[0], node.op) / divisor;
  }
  if (node.op === "power") return number(values[0], node.op) ** number(values[1], node.op);
  if (node.op === "negate") return -number(values[0], node.op);
  if (node.op === "abs") return Math.abs(number(values[0], node.op));
  if (node.op === "annual_to_monthly") return number(values[0], node.op) / 12;
  if (node.op === "monthly_to_annual") return number(values[0], node.op) * 12;
  if (node.op === "sum") return numeric(flat(), node.op).reduce((sum, item) => sum + item, 0);
  if (node.op === "average") {
    const items = numeric(flat(), node.op);
    return items.reduce((sum, item) => sum + item, 0) / items.length;
  }
  if (node.op === "min") return Math.min(...numeric(flat(), node.op));
  if (node.op === "max") return Math.max(...numeric(flat(), node.op));
  if (node.op === "round") {
    const digits = values.length > 1 ? Math.trunc(number(values[1], node.op)) : 0;
    const factor = 10 ** digits;
    return Math.round((number(values[0], node.op) + Number.EPSILON) * factor) / factor;
  }
  if (node.op === "if") return values[0] ? values[1] : values[2];
  if (node.op === "eq") return values[0] === values[1];
  if (node.op === "ne") return values[0] !== values[1];
  if (node.op === "gt") return values[0] > values[1];
  if (node.op === "gte") return values[0] >= values[1];
  if (node.op === "lt") return values[0] < values[1];
  if (node.op === "lte") return values[0] <= values[1];
  throw new Error(`Unsupported spreadsheet operation: ${node.op}`);
}

function inferNodeUnit(node, context, currentSheet) {
  if (Object.hasOwn(node, "value")) return valueUnit(node.value);
  if (node.ref) return context.resolveUnit(...referenceCell(node.ref, currentSheet));
  if (node.range) {
    const { sheet, start, end } = formulaReferenceParts(node.range, currentSheet, { range: true });
    return commonUnit(expandRange(start, end).map((address) => context.resolveUnit(sheet, address)));
  }
  const units = node.args.map((arg) => inferNodeUnit(arg, context, currentSheet));
  if (["eq", "ne", "gt", "gte", "lt", "lte"].includes(node.op)) return "boolean";
  if (node.op === "if") return commonUnit([units[1], units[2]]);
  if (["add", "subtract", "sum", "average", "min", "max"].includes(node.op)) {
    return commonUnit(units);
  }
  if (["round", "negate", "abs"].includes(node.op)) return units[0];
  if (node.op === "annual_to_monthly") return periodUnit(units[0], "year", "month");
  if (node.op === "monthly_to_annual") return periodUnit(units[0], "month", "year");
  if (node.op === "multiply") {
    const material = units.filter((unit) => !DIMENSIONLESS_UNITS.has(unit));
    if (material.length === 1) return material[0];
    if (material.length > 1) return "mixed";
    return units.includes("count") ? "count" : "number";
  }
  if (node.op === "divide") {
    if (DIMENSIONLESS_UNITS.has(units[1])) return units[0];
    if (units[0] === units[1]) return "ratio";
    return "mixed";
  }
  if (node.op === "power") return units[1] === "number" ? units[0] : "mixed";
  return "mixed";
}

function referenceCell(value, currentSheet) {
  const parts = formulaReferenceParts(value, currentSheet);
  return [parts.sheet, parts.start];
}

function compileReference(value, currentSheet, range) {
  const parts = formulaReferenceParts(value, currentSheet, { range });
  const address = range ? `${parts.start}:${parts.end}` : parts.start;
  return parts.sheet === currentSheet ? address : `${quoteSheet(parts.sheet)}!${address}`;
}

function parseReference(value, path, range) {
  const input = String(value || "").trim();
  const separator = input.lastIndexOf("!");
  const sheetPart = separator >= 0 ? input.slice(0, separator) : "";
  const addressPart = separator >= 0 ? input.slice(separator + 1) : input;
  const sheet = sheetPart
    ? sheetPart.startsWith("'") && sheetPart.endsWith("'")
      ? sheetPart.slice(1, -1).replaceAll("''", "'")
      : sheetPart
    : "";
  if (sheet && (!sheet.trim() || sheet.length > 31)) throw new Error(`${path} has an invalid sheet name`);
  const match = range
    ? addressPart.match(/^([A-Z]{1,3}[1-9]\d{0,5}):([A-Z]{1,3}[1-9]\d{0,5})$/i)
    : addressPart.match(/^([A-Z]{1,3}[1-9]\d{0,5})$/i);
  if (!match) throw new Error(`${path} must use ${range ? "an A1 range" : "an A1 cell reference"}`);
  const start = match[1].toUpperCase();
  const end = range ? match[2].toUpperCase() : start;
  validateCellBounds(start, path);
  validateCellBounds(end, path);
  return { sheet, start, end };
}

function expandRange(start, end) {
  const first = decodeCell(start);
  const last = decodeCell(end);
  if (last.row < first.row || last.column < first.column) {
    throw new Error("Spreadsheet formula range must run from top-left to bottom-right");
  }
  if ((last.row - first.row + 1) * (last.column - first.column + 1) > 10_000) {
    throw new Error("Spreadsheet formula range exceeds 10,000 cells");
  }
  const addresses = [];
  for (let row = first.row; row <= last.row; row += 1) {
    for (let column = first.column; column <= last.column; column += 1) {
      addresses.push(`${encodeColumn(column)}${row}`);
    }
  }
  return addresses;
}

function decodeCell(address) {
  const match = address.match(/^([A-Z]+)(\d+)$/);
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

function validateCellBounds(address, path) {
  const { row, column } = decodeCell(address);
  if (row > 100_000 || column > 1_000) throw new Error(`${path} exceeds AMOS spreadsheet bounds`);
}

function quoteSheet(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function excelLiteral(value) {
  if (typeof value === "string") return `"${value.replaceAll('"', '""')}"`;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function parenthesized(value) {
  return `(${value})`;
}

function numeric(values, operation) {
  if (values.length === 0) throw new Error(`${operation} requires numeric values`);
  return values.map((value) => number(value, operation));
}

function number(value, operation) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${operation} requires finite numeric values`);
  }
  return value;
}

function valueUnit(value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "text";
  return "number";
}

function commonUnit(units) {
  const meaningful = units.filter(Boolean);
  if (meaningful.length === 0) return "number";
  const first = meaningful[0];
  if (meaningful.every((unit) => unit === first)) return first;
  return "mixed";
}

function periodUnit(unit, from, to) {
  const suffix = `_per_${from}`;
  if (!String(unit).endsWith(suffix)) {
    throw new Error(`Spreadsheet unit conversion expected a value measured per ${from}`);
  }
  return `${String(unit).slice(0, -suffix.length)}_per_${to}`;
}
