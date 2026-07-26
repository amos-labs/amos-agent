import { randomUUID } from "node:crypto";

export const CANVAS_VERSION = "1";
export const CANVAS_BLOCK_TYPES = Object.freeze([
  "metric",
  "table",
  "timeseries",
  "markdown",
  "sources",
  "decision"
]);

const MAX_BLOCKS = 24;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 200;
const MAX_SERIES = 6;
const MAX_POINTS = 300;
const MAX_SOURCES = 100;
const MAX_DECISION_DETAILS = 20;
const SOURCE_KINDS = new Set(["live", "cached", "private", "local"]);
const DECISION_KINDS = new Set(["approval", "receipt"]);
const DECISION_STATUSES = new Set([
  "pending",
  "approved",
  "denied",
  "executed",
  "failed",
  "expired",
  "attention"
]);
const CELL_FORMATS = new Set(["text", "number", "currency", "percent", "date", "datetime"]);

export function normalizeCanvasSpec(input, { now = () => new Date().toISOString() } = {}) {
  const source = object(input, "Canvas must be an object");
  const version = text(source.version || CANVAS_VERSION, "version", 8);
  if (version !== CANVAS_VERSION) {
    throw new Error(`Unsupported canvas version: ${version}`);
  }

  const blocks = array(source.blocks, "blocks", MAX_BLOCKS);
  if (blocks.length === 0) throw new Error("Canvas must include at least one block");

  return {
    version,
    title: text(source.title, "title", 160),
    subtitle: optionalText(source.subtitle, "subtitle", 500),
    generatedAt: isoDate(source.generated_at || source.generatedAt || now(), "generated_at"),
    source: normalizeSource(source.source || {}, now),
    blocks: blocks.map((block, index) => normalizeBlock(block, index))
  };
}

export class DesktopCanvasManager {
  constructor({ limit = 12, now = () => new Date().toISOString() } = {}) {
    this.limit = limit;
    this.now = now;
    this.canvases = [];
    this.activeCanvasId = null;
  }

  present(input) {
    const spec = normalizeCanvasSpec(input, { now: this.now });
    const canvas = {
      id: randomUUID(),
      ...spec,
      presentedAt: this.now()
    };
    this.canvases.unshift(canvas);
    if (this.canvases.length > this.limit) this.canvases.length = this.limit;
    this.activeCanvasId = canvas.id;
    return structuredClone(canvas);
  }

  list() {
    return structuredClone(this.canvases);
  }

  active() {
    return this.canvases.find((canvas) => canvas.id === this.activeCanvasId) || null;
  }

  remove(id) {
    const before = this.canvases.length;
    this.canvases = this.canvases.filter((canvas) => canvas.id !== id);
    if (this.activeCanvasId === id) this.activeCanvasId = this.canvases[0]?.id || null;
    return before !== this.canvases.length;
  }

  clear() {
    this.canvases = [];
    this.activeCanvasId = null;
  }

  state() {
    return {
      canvases: this.list(),
      activeCanvasId: this.activeCanvasId
    };
  }
}

function normalizeBlock(input, index) {
  const block = object(input, `blocks[${index}] must be an object`);
  const type = text(block.type, `blocks[${index}].type`, 32);
  if (!CANVAS_BLOCK_TYPES.includes(type)) {
    throw new Error(`Unsupported canvas block type: ${type}`);
  }

  const common = {
    id: optionalText(block.id, `blocks[${index}].id`, 80) || `block-${index + 1}`,
    type,
    title: optionalText(block.title, `blocks[${index}].title`, 160)
  };

  if (type === "metric") {
    return {
      ...common,
      label: text(block.label, `blocks[${index}].label`, 120),
      value: primitive(block.value, `blocks[${index}].value`),
      unit: optionalText(block.unit, `blocks[${index}].unit`, 40),
      change: optionalText(block.change, `blocks[${index}].change`, 80),
      trend: enumValue(block.trend || "neutral", ["up", "down", "neutral"], `blocks[${index}].trend`),
      note: optionalText(block.note, `blocks[${index}].note`, 300)
    };
  }

  if (type === "table") {
    const columns = array(block.columns, `blocks[${index}].columns`, MAX_TABLE_COLUMNS);
    if (columns.length === 0) throw new Error(`blocks[${index}].columns cannot be empty`);
    const normalizedColumns = columns.map((column, columnIndex) => {
      const value = object(column, `blocks[${index}].columns[${columnIndex}] must be an object`);
      return {
        key: text(value.key, `blocks[${index}].columns[${columnIndex}].key`, 80),
        label: text(value.label, `blocks[${index}].columns[${columnIndex}].label`, 120),
        format: enumValue(
          value.format || "text",
          [...CELL_FORMATS],
          `blocks[${index}].columns[${columnIndex}].format`
        )
      };
    });
    const unique = new Set(normalizedColumns.map((column) => column.key));
    if (unique.size !== normalizedColumns.length) {
      throw new Error(`blocks[${index}].columns keys must be unique`);
    }
    const rows = array(block.rows || [], `blocks[${index}].rows`, MAX_TABLE_ROWS);
    return {
      ...common,
      searchable: block.searchable !== false,
      columns: normalizedColumns,
      rows: rows.map((row, rowIndex) => {
        const value = object(row, `blocks[${index}].rows[${rowIndex}] must be an object`);
        return Object.fromEntries(
          normalizedColumns.map((column) => [
            column.key,
            primitive(value[column.key], `blocks[${index}].rows[${rowIndex}].${column.key}`, true)
          ])
        );
      })
    };
  }

  if (type === "timeseries") {
    const series = array(block.series, `blocks[${index}].series`, MAX_SERIES);
    if (series.length === 0) throw new Error(`blocks[${index}].series cannot be empty`);
    return {
      ...common,
      xLabel: optionalText(block.x_label || block.xLabel, `blocks[${index}].x_label`, 80),
      yLabel: optionalText(block.y_label || block.yLabel, `blocks[${index}].y_label`, 80),
      series: series.map((item, seriesIndex) => {
        const value = object(item, `blocks[${index}].series[${seriesIndex}] must be an object`);
        const points = array(
          value.points,
          `blocks[${index}].series[${seriesIndex}].points`,
          MAX_POINTS
        );
        if (points.length === 0) {
          throw new Error(`blocks[${index}].series[${seriesIndex}].points cannot be empty`);
        }
        return {
          name: text(value.name, `blocks[${index}].series[${seriesIndex}].name`, 100),
          points: points.map((point, pointIndex) => {
            const normalized = object(
              point,
              `blocks[${index}].series[${seriesIndex}].points[${pointIndex}] must be an object`
            );
            const numeric = Number(normalized.y);
            if (!Number.isFinite(numeric)) {
              throw new Error(
                `blocks[${index}].series[${seriesIndex}].points[${pointIndex}].y must be finite`
              );
            }
            return {
              x: text(
                normalized.x,
                `blocks[${index}].series[${seriesIndex}].points[${pointIndex}].x`,
                100
              ),
              y: numeric
            };
          })
        };
      })
    };
  }

  if (type === "markdown") {
    return {
      ...common,
      content: text(block.content, `blocks[${index}].content`, 20_000)
    };
  }

  if (type === "sources") {
    const items = array(block.items || block.sources || [], `blocks[${index}].items`, MAX_SOURCES);
    return {
      ...common,
      items: items.map((item, itemIndex) => normalizeReference(
        item,
        `blocks[${index}].items[${itemIndex}]`
      ))
    };
  }

  const details = array(block.details || [], `blocks[${index}].details`, MAX_DECISION_DETAILS);
  return {
    ...common,
    kind: enumValue(block.kind, [...DECISION_KINDS], `blocks[${index}].kind`),
    status: enumValue(
      block.status || "pending",
      [...DECISION_STATUSES],
      `blocks[${index}].status`
    ),
    summary: text(block.summary, `blocks[${index}].summary`, 1_000),
    pendingId: optionalText(block.pending_id || block.pendingId, `blocks[${index}].pending_id`, 120),
    receiptId: optionalText(block.receipt_id || block.receiptId, `blocks[${index}].receipt_id`, 120),
    details: details.map((detail, detailIndex) => {
      const value = object(detail, `blocks[${index}].details[${detailIndex}] must be an object`);
      return {
        label: text(value.label, `blocks[${index}].details[${detailIndex}].label`, 120),
        value: primitive(value.value, `blocks[${index}].details[${detailIndex}].value`)
      };
    })
  };
}

function normalizeSource(input, now) {
  const source = object(input, "source must be an object");
  const references = array(source.references || [], "source.references", MAX_SOURCES);
  return {
    kind: enumValue(source.kind || "live", [...SOURCE_KINDS], "source.kind"),
    label: optionalText(source.label, "source.label", 160) || "AMOS company data",
    refreshedAt: isoDate(source.refreshed_at || source.refreshedAt || now(), "source.refreshed_at"),
    staleAfter: optionalIsoDate(source.stale_after || source.staleAfter, "source.stale_after"),
    refreshPrompt: optionalText(source.refresh_prompt || source.refreshPrompt, "source.refresh_prompt", 500),
    references: references.map((reference, index) =>
      normalizeReference(reference, `source.references[${index}]`)
    )
  };
}

function normalizeReference(input, path) {
  const reference = object(input, `${path} must be an object`);
  return {
    type: text(reference.type || "record", `${path}.type`, 80),
    id: optionalText(reference.id, `${path}.id`, 160),
    label: text(reference.label, `${path}.label`, 240),
    observedAt: optionalIsoDate(reference.observed_at || reference.observedAt, `${path}.observed_at`)
  };
}

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function array(value, path, limit) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > limit) throw new Error(`${path} exceeds the limit of ${limit}`);
  return value;
}

function text(value, path, limit) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${path} must be text`);
  }
  const normalized = String(value).trim();
  if (!normalized) throw new Error(`${path} cannot be empty`);
  if (normalized.length > limit) throw new Error(`${path} exceeds the limit of ${limit} characters`);
  return normalized;
}

function optionalText(value, path, limit) {
  if (value === undefined || value === null || value === "") return "";
  return text(value, path, limit);
}

function primitive(value, path, nullable = false) {
  if (nullable && (value === undefined || value === null)) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must be finite`);
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value === null) return null;
  throw new Error(`${path} must be a string, number, boolean, or null`);
}

function enumValue(value, values, path) {
  if (!values.includes(value)) throw new Error(`${path} must be one of: ${values.join(", ")}`);
  return value;
}

function isoDate(value, path) {
  const normalized = text(value, path, 80);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${path} must be an ISO timestamp`);
  return new Date(normalized).toISOString();
}

function optionalIsoDate(value, path) {
  if (value === undefined || value === null || value === "") return "";
  return isoDate(value, path);
}
