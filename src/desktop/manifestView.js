// Surface manifests: platform-authored descriptions of a client surface
// (amos.surface_manifest.v1). The platform names the read that lists rows, the
// columns and how to format them, the detail sections, the actions it offers
// with their argument bindings, and the empty state. Desktop draws any manifest
// with one generic view; chat clients render the same columns as a table.
//
// Everything here is pure and DOM-free so it can be tested directly. The
// interpreter is deliberately as small as the contract: dotted field paths, a
// fixed set of formats, one `when: { field, in }` condition, `{ field }` or
// scalar argument bindings. No expressions, no templates, no eval.

export const SURFACE_MANIFEST_SCHEMA = "amos.surface_manifest.v1";
export const MANIFEST_FORMATS = Object.freeze(["text", "number", "currency", "percent", "date", "datetime"]);
export const MANIFEST_RENDERS = Object.freeze(["status_pill"]);
export const MANIFEST_BLOCKS = Object.freeze(["metric", "table", "markdown", "sources", "decision"]);

const MAX_ROWS = 200;
const MAX_COLUMNS = 12;
const MAX_ACTIONS = 8;
const MAX_SECTIONS = 8;
const PATH_PATTERN = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

const OK_STATUSES = new Set(["active", "connected", "completed", "succeeded", "ready", "available", "executed", "done"]);
const WARN_STATUSES = new Set(["paused", "pending", "queued", "running", "draft", "parked", "resumable"]);
const BAD_STATUSES = new Set(["failed", "error", "expired", "revoked", "denied", "blocked", "archived"]);

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function fieldPath(value) {
  const path = text(value, 120);
  return PATH_PATTERN.test(path) ? path : "";
}

// A column outside the contract (unknown key, format, or render) is dropped
// whole, mirroring the platform validator, rather than half-drawn.
function normalizeColumn(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !["field", "label", "format", "render"].includes(key))) return null;
  const field = fieldPath(value.field);
  const label = text(value.label, 60);
  if (!field || !label) return null;
  const column = { field, label };
  if (value.format !== undefined) {
    const format = text(value.format, 20);
    if (!MANIFEST_FORMATS.includes(format)) return null;
    column.format = format;
  }
  if (value.render !== undefined) {
    const render = text(value.render, 20);
    if (!MANIFEST_RENDERS.includes(render)) return null;
    column.render = render;
  }
  return column;
}

function normalizeColumns(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeColumn)
    .filter(Boolean)
    .slice(0, MAX_COLUMNS);
}

function normalizeWhen(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = fieldPath(value.field);
  if (!field || !Array.isArray(value.in) || value.in.length === 0) return null;
  const values = value.in
    .filter((entry) => ["string", "number", "boolean"].includes(typeof entry))
    .slice(0, 20);
  return values.length ? { field, in: values } : null;
}

function normalizeArgs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const args = {};
  for (const [name, binding] of Object.entries(value).slice(0, 12)) {
    const key = text(name, 60);
    if (!key) continue;
    if (binding && typeof binding === "object" && !Array.isArray(binding)) {
      const field = fieldPath(binding.field);
      if (field && Object.keys(binding).length === 1) args[key] = { field };
    } else if (["string", "number", "boolean"].includes(typeof binding)) {
      args[key] = typeof binding === "string" ? binding.slice(0, 500) : binding;
    }
  }
  return args;
}

function normalizeAction(value) {
  if (!value || typeof value !== "object") return null;
  const label = text(value.label, 40);
  const capability = text(value.capability, 120);
  const consequence = text(value.consequence, 10);
  if (!label || !capability || !["read", "write"].includes(consequence)) return null;
  const action = { label, capability, consequence, args: normalizeArgs(value.args), confirm: value.confirm === true };
  const when = normalizeWhen(value.when);
  if (when) action.when = when;
  return action;
}

function normalizeSection(value) {
  if (!value || typeof value !== "object") return null;
  const block = text(value.block, 40);
  if (!MANIFEST_BLOCKS.includes(block)) return null;
  const section = { block };
  const label = text(value.label, 60);
  if (label) section.label = label;
  if (block === "metric") {
    section.fields = (Array.isArray(value.fields) ? value.fields : []).map(fieldPath).filter(Boolean).slice(0, 8);
    if (section.fields.length === 0) return null;
    return section;
  }
  section.field = fieldPath(value.field);
  if (!section.field) return null;
  if (block === "table") {
    section.columns = normalizeColumns(value.columns);
    if (section.columns.length === 0) return null;
  }
  return section;
}

function normalizeRelated(value) {
  if (!value || typeof value !== "object") return null;
  const label = text(value.label, 40);
  const capability = text(value.capability, 120);
  if (!label || !capability) return null;
  return { label, capability, args: normalizeArgs(value.args) };
}

/**
 * Normalize one platform manifest to exactly the contract shape, dropping
 * anything the contract does not name. Returns null when the manifest has no
 * usable key, list capability, or columns.
 */
export function normalizeSurfaceManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = text(value.key, 80);
  const list = value.list && typeof value.list === "object" ? value.list : {};
  const capability = text(list.capability, 120);
  const columns = normalizeColumns(list.columns);
  if (!key || !capability || columns.length === 0) return null;
  const filters = (Array.isArray(list.filters) ? list.filters : [])
    .map((filter) => {
      const field = fieldPath(filter?.field);
      if (!field) return null;
      const values = Array.isArray(filter.values)
        ? filter.values.filter((entry) => ["string", "number", "boolean"].includes(typeof entry)).slice(0, 20)
        : [];
      return { field, values };
    })
    .filter(Boolean)
    .slice(0, 6);
  const attention = list.attention && typeof list.attention === "object" && fieldPath(list.attention.field)
    ? {
        field: fieldPath(list.attention.field),
        values: (Array.isArray(list.attention.values) ? list.attention.values : [])
          .filter((entry) => ["string", "number", "boolean"].includes(typeof entry))
          .slice(0, 20)
      }
    : null;
  const detail = value.detail && typeof value.detail === "object" ? value.detail : {};
  const locked = value.locked && typeof value.locked === "object"
    ? { reason: text(value.locked.reason, 64), detail: text(value.locked.detail, 160) }
    : null;
  return {
    key,
    title: text(value.title, 80) || key,
    nav: {
      group: text(value.nav?.group, 40),
      order: Number.isFinite(Number(value.nav?.order)) ? Math.max(0, Math.trunc(Number(value.nav.order))) : 0
    },
    list: {
      capability,
      items: text(list.items, 60) || "items",
      columns,
      filters,
      statusField: fieldPath(list.status_field ?? list.statusField),
      attention
    },
    detail: {
      sections: (Array.isArray(detail.sections) ? detail.sections : []).map(normalizeSection).filter(Boolean).slice(0, MAX_SECTIONS)
    },
    actions: (Array.isArray(value.actions) ? value.actions : []).map(normalizeAction).filter(Boolean).slice(0, MAX_ACTIONS),
    related: (Array.isArray(value.related) ? value.related : []).map(normalizeRelated).filter(Boolean).slice(0, 6),
    empty: {
      title: text(value.empty?.title, 80),
      body: text(value.empty?.body, 500)
    },
    available: value.available !== false,
    locked
  };
}

/** Read a dotted path from a row; undefined when any hop is missing. */
export function resolvePath(row, path) {
  if (!row || typeof row !== "object") return undefined;
  const parts = String(path || "").split(".").filter(Boolean);
  let current = row;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

/** The tone a status value should be drawn in: ok | warn | bad | neutral. */
export function statusTone(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (!status) return "neutral";
  if (OK_STATUSES.has(status)) return "ok";
  if (WARN_STATUSES.has(status)) return "warn";
  if (BAD_STATUSES.has(status)) return "bad";
  if (value === false) return "bad";
  if (value === true) return "ok";
  return "neutral";
}

function formatDate(value, withTime) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat(undefined, withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

/**
 * Format one cell. Returns a string for every format, or `{ label, tone }`
 * when the column renders a status pill (the label is what a text table shows).
 */
export function formatCell(value, column = {}, row = null) {
  if (column.render === "status_pill") {
    const label = value === undefined || value === null ? "—" : String(value);
    return { label, tone: statusTone(value) };
  }
  if (value === undefined || value === null || value === "") return "—";
  switch (column.format) {
    case "number": {
      const number = Number(value);
      return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : String(value);
    }
    case "currency": {
      const number = Number(value);
      if (!Number.isFinite(number)) return String(value);
      const currency = typeof row?.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : "USD";
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(number);
    }
    case "percent": {
      const number = Number(value);
      return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : String(value);
    }
    case "date":
      return formatDate(value, false);
    case "datetime":
      return formatDate(value, true);
    default:
      if (typeof value === "object") return Array.isArray(value) ? `${value.length} items` : "…";
      return String(value);
  }
}

/** Whether a row satisfies an action's `when` (absent `when` always matches). */
export function matchesWhen(when, row) {
  if (!when) return true;
  const value = resolvePath(row, when.field);
  return when.in.some((candidate) => candidate === value || String(candidate) === String(value));
}

/** The actions a manifest offers for one row, in manifest order, with their index. */
export function visibleActions(manifest, row) {
  return (manifest?.actions || [])
    .map((action, index) => ({ ...action, index }))
    .filter((action) => matchesWhen(action.when, row));
}

/** Bind an action's argument declarations against a row. */
export function bindArgs(action, row) {
  const args = {};
  for (const [name, binding] of Object.entries(action?.args || {})) {
    if (binding && typeof binding === "object" && "field" in binding) {
      const value = resolvePath(row, binding.field);
      if (value !== undefined) args[name] = value;
    } else {
      args[name] = binding;
    }
  }
  return args;
}

/**
 * The rows a manifest lists, taken from the raw section data
 * (`{ [verb]: result }`) at the manifest's list capability and `items` key.
 */
export function listRows(sectionData, manifest) {
  const result = sectionData && typeof sectionData === "object"
    ? sectionData[manifest?.list?.capability]
    : null;
  const items = result && typeof result === "object" ? result[manifest?.list?.items] : null;
  return (Array.isArray(items) ? items : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .slice(0, MAX_ROWS);
}

/** Rows whose attention field holds one of the attention values. */
export function attentionCount(rows, manifest) {
  const attention = manifest?.list?.attention;
  if (!attention) return 0;
  return rows.filter((row) => {
    const value = resolvePath(row, attention.field);
    return attention.values.some((candidate) => candidate === value || String(candidate) === String(value));
  }).length;
}

/** Rows matching the selected filter values (`{ field: value }`); empty filter keeps all. */
export function filterRows(rows, selection = {}) {
  const entries = Object.entries(selection).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([field, wanted]) => String(resolvePath(row, field) ?? "") === String(wanted))
  );
}
