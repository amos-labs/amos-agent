import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import {
  compileSpreadsheetFormula,
  normalizeSpreadsheetFormula
} from "../artifacts/spreadsheetFormula.js";
import { calculateSpreadsheet, renderSpreadsheetArtifact } from "../artifacts/spreadsheetRenderer.js";
import {
  SPREADSHEET_CELL_FORMATS,
  SPREADSHEET_CELL_ROLES,
  SPREADSHEET_KINDS,
  SPREADSHEET_SHEET_ROLES,
  SPREADSHEET_UNITS,
  normalizeSpreadsheetSpec
} from "../artifacts/spreadsheetSpec.js";
import { assertSafeAgentPath, resolveWorkspacePath } from "../util/pathSafety.js";
import { resolveDefaultWorkspacePath } from "../util/workspaceFocus.js";

const CALCULATION_OPERATIONS = Object.freeze([
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
  "annual_to_monthly",
  "monthly_to_annual",
  "negate",
  "abs"
]);

const FORMULA_SCHEMA = Object.freeze({
  type: "object",
  description: [
    "A deterministic typed formula AST. Use exactly one form: {value}, {ref}, {range}, or {op,args}.",
    "References use A1 notation and cross-sheet references quote the sheet, for example {'ref':\"'Assumptions'!B2\"}.",
    "For annual/monthly conversions use annual_to_monthly or monthly_to_annual; dividing or multiplying by 12 does not change the declared unit and will fail verification."
  ].join(" "),
  properties: {
    value: { description: "A literal string, number, or boolean value." },
    ref: { type: "string" },
    range: { type: "string" },
    op: { type: "string", enum: CALCULATION_OPERATIONS.concat(["if", "eq", "ne", "gt", "gte", "lt", "lte"]) },
    args: { type: "array", minItems: 1, maxItems: 64, items: { type: "object", additionalProperties: true } }
  },
  additionalProperties: false
});

export function createSpreadsheetTools({ present = null } = {}) {
  return [spreadsheetCalculatorTool(), spreadsheetArtifactTool({ present })];
}

function spreadsheetCalculatorTool() {
  return {
    name: "desktop_calculate",
    source: "local",
    description: [
      "Perform material arithmetic deterministically with explicit units. Use before stating financial, pricing, payroll, scenario, rate, annual/monthly, or other consequential numeric conclusions.",
      "Build dependent math as ordered steps. A step may reference an earlier step by key. Period conversion must use annual_to_monthly or monthly_to_annual; AMOS rejects unit mismatches."
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Unique snake_case identifier for this result." },
              label: { type: "string" },
              operation: { type: "string", enum: CALCULATION_OPERATIONS },
              operands: {
                type: "array",
                minItems: 1,
                maxItems: 64,
                items: {
                  type: "object",
                  properties: {
                    value: { type: "number" },
                    unit: { type: "string", enum: SPREADSHEET_UNITS },
                    step: { type: "string", description: "Key of an earlier calculation step." }
                  },
                  additionalProperties: false
                }
              },
              unit: { type: "string", enum: SPREADSHEET_UNITS }
            },
            required: ["key", "operation", "operands", "unit"],
            additionalProperties: false
          }
        }
      },
      required: ["steps"],
      additionalProperties: false
    },
    async handler(args) {
      return calculateSteps(args.steps);
    }
  };
}

function spreadsheetArtifactTool({ present }) {
  return {
    name: "desktop_create_spreadsheet",
    source: "local",
    description: [
      "Create a verified native Excel XLSX workbook directly in the selected workspace. Use this—not Bash, Python, CSV, or a document table—when the user asks for a spreadsheet, Excel file, financial model, forecast, budget, hiring plan, scenario model, KPI workbook, or editable workbook.",
      "The workbook supports multiple sheets, formulas, professional formatting, checks, and embedded chart snapshots. Every formula is evaluated before writing; required checks and scenario baselines must pass.",
      "For financial_model workbooks, mark scenario sheets with role=scenario and declare scenario_baselines so confirmed current-state inputs (for example current MRR) cannot silently reset to zero. Use annual_to_monthly/monthly_to_annual formula operations for period conversion."
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative output path without .xlsx, for example models/saas-plan-2027."
        },
        spreadsheet: spreadsheetSchema(),
        reason: { type: "string", description: "Brief reason the workbook is being created." }
      },
      required: ["path", "spreadsheet"],
      additionalProperties: false
    },
    async handler(args, context) {
      return createSpreadsheetArtifact(args, context, { present });
    }
  };
}

export async function createSpreadsheetArtifact(args, context, { present = null } = {}) {
  const spec = normalizeSpreadsheetSpec(args.spreadsheet);
  calculateSpreadsheet(spec);
  const root = context.config.safety.workspaceRoot;
  const canonicalRoot = resolveWorkspacePath(root, ".", false);
  const relativePath = `${normalizedBasePath(args.path)}.xlsx`;
  const absolutePath = resolveDefaultWorkspacePath(
    context.config.safety,
    relativePath,
    context.config.safety.allowOutsideWorkspace
  );
  assertSafeAgentPath(absolutePath, root);

  if (
    !context.config.safety.autoApproveWrites &&
    !context.config.safety.autoApproveKinds?.includes("file-write")
  ) {
    const approved = await context.approvals.confirm(
      [
        "AMOS Desktop wants to create a verified Excel workbook:",
        "",
        `• ${relativePath}`,
        `• ${spec.sheets.length} authored sheets${spec.checks.length || spec.scenarioBaselines.length ? " plus deterministic checks" : ""}`,
        "",
        `Title: ${spec.title}`,
        args.reason ? `Reason: ${String(args.reason).slice(0, 500)}` : ""
      ].filter(Boolean).join("\n"),
      { kind: "file-write" }
    );
    if (!approved) return { ok: false, denied: true, message: "User denied spreadsheet creation." };
  }

  const rendered = await renderSpreadsheetArtifact(spec);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, rendered.buffer);
  const artifact = {
    path: relative(canonicalRoot, absolutePath).replaceAll("\\", "/"),
    format: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: rendered.buffer.length,
    sha256: createHash("sha256").update(rendered.buffer).digest("hex"),
    verified: rendered.verification.verified
  };
  let preview = null;
  if (typeof present === "function") {
    try {
      const canvas = await present({
        spreadsheet: spec,
        artifact,
        verification: rendered.verification,
        preview: rendered.preview,
        generatedAt: new Date().toISOString()
      });
      preview = { available: true, canvas_id: canvas.id, revision: canvas.revision };
    } catch (error) {
      preview = {
        available: false,
        error: String(error?.message || "Spreadsheet preview is unavailable").slice(0, 500)
      };
    }
  }
  return {
    ok: true,
    contract: `amos.spreadsheet-spec:${spec.version}`,
    title: spec.title,
    kind: spec.kind,
    artifact,
    verification: rendered.verification,
    preview
  };
}

function calculateSteps(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    throw new Error("Calculator requires between 1 and 100 steps");
  }
  const cells = [];
  const stepCells = new Map();
  let inputRow = 1;
  let outputRow = 1;
  for (let index = 0; index < input.length; index += 1) {
    const step = input[index];
    const key = String(step?.key || "").trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || stepCells.has(key)) {
      throw new Error(`Calculator step ${index + 1} needs a unique snake_case key`);
    }
    if (!CALCULATION_OPERATIONS.includes(step.operation)) {
      throw new Error(`Calculator step ${key} uses an unsupported operation`);
    }
    if (!SPREADSHEET_UNITS.includes(step.unit)) throw new Error(`Calculator step ${key} has an invalid unit`);
    if (!Array.isArray(step.operands) || step.operands.length === 0 || step.operands.length > 64) {
      throw new Error(`Calculator step ${key} needs between 1 and 64 operands`);
    }
    const args = step.operands.map((operand, operandIndex) => {
      if (operand?.step) {
        const address = stepCells.get(String(operand.step));
        if (!address) throw new Error(`Calculator step ${key} references an unavailable prior step`);
        return { ref: address };
      }
      if (typeof operand?.value !== "number" || !Number.isFinite(operand.value)) {
        throw new Error(`Calculator step ${key} operand ${operandIndex + 1} must be finite`);
      }
      if (!SPREADSHEET_UNITS.includes(operand.unit)) {
        throw new Error(`Calculator step ${key} operand ${operandIndex + 1} needs an explicit unit`);
      }
      const address = `A${inputRow++}`;
      cells.push({ address, value: operand.value, unit: operand.unit, role: "input" });
      return { ref: address };
    });
    const address = `B${outputRow++}`;
    stepCells.set(key, address);
    cells.push({
      address,
      formula: normalizeSpreadsheetFormula({ op: step.operation, args }, `steps[${index}].formula`),
      unit: step.unit,
      role: "formula"
    });
  }
  const spec = normalizeSpreadsheetSpec({
    version: "1",
    kind: "general",
    title: "Deterministic calculation",
    sheets: [{ name: "Calculation", role: "model", cells }]
  });
  const calculation = calculateSpreadsheet(spec);
  return {
    ok: true,
    steps: input.map((step) => {
      const address = stepCells.get(step.key);
      const cell = spec.sheets[0].cells.find((item) => item.address === address);
      return {
        key: step.key,
        label: String(step.label || step.key).slice(0, 200),
        value: calculation.values.get(`Calculation!${address}`),
        unit: step.unit,
        formula: compileSpreadsheetFormula(cell.formula, "Calculation")
      };
    }),
    verified: true
  };
}

function spreadsheetSchema() {
  return {
    type: "object",
    properties: {
      version: { type: "string", enum: ["1"] },
      kind: { type: "string", enum: SPREADSHEET_KINDS },
      title: { type: "string" },
      author: { type: "string" },
      subject: { type: "string" },
      description: { type: "string" },
      sheets: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string", enum: SPREADSHEET_SHEET_ROLES },
            show_grid_lines: { type: "boolean" },
            freeze_rows: { type: "integer", minimum: 0, maximum: 100 },
            freeze_columns: { type: "integer", minimum: 0, maximum: 50 },
            cells: {
              type: "array",
              minItems: 1,
              maxItems: 6_000,
              items: {
                type: "object",
                properties: {
                  address: { type: "string" },
                  value: { description: "A literal string, number, boolean, or null cell value." },
                  formula: FORMULA_SCHEMA,
                  unit: { type: "string", enum: SPREADSHEET_UNITS },
                  format: { type: "string", enum: SPREADSHEET_CELL_FORMATS },
                  role: { type: "string", enum: SPREADSHEET_CELL_ROLES },
                  note: { type: "string" },
                  wrap: { type: "boolean" },
                  indent: { type: "integer", minimum: 0, maximum: 10 }
                },
                required: ["address"],
                additionalProperties: false
              }
            },
            merges: { type: "array", maxItems: 100, items: { type: "string" } },
            column_widths: {
              type: "array",
              maxItems: 1_000,
              items: {
                type: "object",
                properties: { column: { type: "string" }, width: { type: "number", minimum: 3, maximum: 80 } },
                required: ["column", "width"],
                additionalProperties: false
              }
            },
            charts: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["line", "bar"] },
                  title: { type: "string" },
                  categories: { type: "string" },
                  series: {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    items: {
                      type: "object",
                      properties: { name: { type: "string" }, values: { type: "string" }, color: { type: "string" } },
                      required: ["name", "values"],
                      additionalProperties: false
                    }
                  },
                  from: { type: "string" },
                  to: { type: "string" },
                  y_unit: { type: "string", enum: SPREADSHEET_UNITS }
                },
                required: ["title", "categories", "series"],
                additionalProperties: false
              }
            }
          },
          required: ["name", "cells"],
          additionalProperties: false
        }
      },
      checks: {
        type: "array",
        maxItems: 300,
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            actual: cellPointerSchema(),
            expected: {
              type: "object",
              properties: {
                value: { description: "The expected string, number, or boolean value." },
                unit: { type: "string", enum: SPREADSHEET_UNITS },
                ref: cellPointerSchema()
              },
              additionalProperties: false
            },
            operator: { type: "string", enum: ["equals", "gte", "lte"] },
            tolerance: { type: "number", minimum: 0 },
            note: { type: "string" },
            required: { type: "boolean" }
          },
          required: ["label", "actual", "expected"],
          additionalProperties: false
        }
      },
      scenario_baselines: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            scenario_sheet: { type: "string" },
            source: cellPointerSchema(),
            target: cellPointerSchema(false),
            tolerance: { type: "number", minimum: 0 }
          },
          required: ["label", "scenario_sheet", "source", "target"],
          additionalProperties: false
        }
      }
    },
    required: ["title", "sheets"],
    additionalProperties: false
  };
}

function cellPointerSchema(requireSheet = true) {
  return {
    type: "object",
    properties: { sheet: { type: "string" }, cell: { type: "string" } },
    required: requireSheet ? ["sheet", "cell"] : ["cell"],
    additionalProperties: false
  };
}

function normalizedBasePath(value) {
  const input = String(value || "").trim().replaceAll("\\", "/");
  if (!input) throw new Error("Spreadsheet output path is required");
  if (input.toLowerCase().endsWith(".xlsx")) throw new Error("Spreadsheet path must not include .xlsx");
  if (input.includes("\0") || input.split("/").includes("..") || input.startsWith("/")) {
    throw new Error("Spreadsheet output path must stay inside the selected workspace");
  }
  return input;
}
