import { randomUUID } from "node:crypto";
import { normalizeDocumentSpec } from "../artifacts/documentSpec.js";

export const CANVAS_VERSION = "1";
export const LOCAL_PREVIEW_ATTESTATION = Symbol("amos.local-preview-attestation");
export const CANVAS_BLOCK_TYPES = Object.freeze([
  "metric",
  "table",
  "timeseries",
  "markdown",
  "code",
  "document",
  "spreadsheet",
  "browser",
  "link",
  "sources",
  "decision"
]);
export const CANVAS_STATE_KINDS = Object.freeze([
  "loading",
  "ready",
  "empty",
  "partial",
  "stale",
  "error",
  "restricted"
]);

const MAX_BLOCKS = 24;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 200;
const MAX_SERIES = 6;
const MAX_POINTS = 300;
const MAX_SOURCES = 100;
const MAX_DECISION_DETAILS = 20;
const MAX_DOCUMENT_ARTIFACTS = 2;
const MAX_DOCUMENT_DIAGNOSTICS = 20;
const MAX_DOCUMENT_PREVIEW_PAGES = 12;
const MAX_SPREADSHEET_SHEETS = 32;
const MAX_SPREADSHEET_CHECKS = 300;
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

  const normalizedSource = normalizeSource(source.source || {}, now);
  const state = normalizeCanvasState(source.state || "ready");
  const blocks = array(source.blocks, "blocks", MAX_BLOCKS);
  if (blocks.length === 0 && state.kind === "ready") {
    throw new Error("A ready canvas must include at least one block");
  }

  return {
    version,
    title: text(source.title, "title", 160),
    subtitle: optionalText(source.subtitle, "subtitle", 500),
    generatedAt: isoDate(source.generated_at || source.generatedAt || now(), "generated_at"),
    state,
    source: normalizedSource,
    blocks: blocks.map((block, index) => normalizeBlock(block, index, normalizedSource))
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
      revision: 1,
      presentedAt: this.now(),
      updatedAt: this.now()
    };
    this.canvases.unshift(canvas);
    if (this.canvases.length > this.limit) this.canvases.length = this.limit;
    this.activeCanvasId = canvas.id;
    return structuredClone(canvas);
  }

  update(id, input = {}) {
    const index = this.canvases.findIndex((canvas) => canvas.id === id);
    if (index < 0) throw new Error("That canvas is no longer available");
    const current = this.canvases[index];
    const incoming = array(
      input.blocks || input.upsert_blocks || input.upsertBlocks || [],
      "blocks",
      MAX_BLOCKS
    );
    const removeIds = new Set(
      array(
        input.remove_block_ids || input.removeBlockIds || [],
        "remove_block_ids",
        MAX_BLOCKS
      ).map((blockId, blockIndex) => text(blockId, `remove_block_ids[${blockIndex}]`, 80))
    );
    const merged = new Map(
      current.blocks
        .filter((block) => !removeIds.has(block.id))
        .map((block) => [block.id, block])
    );
    for (let blockIndex = 0; blockIndex < incoming.length; blockIndex += 1) {
      const block = object(incoming[blockIndex], `blocks[${blockIndex}] must be an object`);
      const blockId = text(block.id, `blocks[${blockIndex}].id`, 80);
      merged.set(blockId, block);
    }

    const spec = normalizeCanvasSpec({
      version: current.version,
      title: input.title || current.title,
      subtitle: input.subtitle === undefined ? current.subtitle : input.subtitle,
      generated_at: input.generated_at || input.generatedAt || this.now(),
      state: input.state || current.state,
      source: input.source ? { ...current.source, ...input.source } : current.source,
      blocks: [...merged.values()]
    }, { now: this.now });
    const updated = {
      ...current,
      ...spec,
      revision: current.revision + 1,
      updatedAt: this.now()
    };
    this.canvases[index] = updated;
    this.activeCanvasId = updated.id;
    return structuredClone(updated);
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

  restore(input = {}) {
    const values = Array.isArray(input?.canvases) ? input.canvases : [];
    const canvases = values.slice(0, this.limit).map((value, index) => {
      const source = object(value, `canvases[${index}] must be an object`);
      const spec = normalizeCanvasSpec(source, { now: this.now });
      return {
        id: text(source.id, `canvases[${index}].id`, 128),
        ...spec,
        revision: boundedInteger(
          source.revision || 1,
          `canvases[${index}].revision`,
          1,
          Number.MAX_SAFE_INTEGER
        ),
        presentedAt: isoDate(
          source.presentedAt || source.presented_at || source.generatedAt || this.now(),
          `canvases[${index}].presentedAt`
        ),
        updatedAt: isoDate(
          source.updatedAt || source.updated_at || source.generatedAt || this.now(),
          `canvases[${index}].updatedAt`
        )
      };
    });
    const activeCanvasId = optionalText(input?.activeCanvasId, "activeCanvasId", 128);
    this.canvases = canvases;
    this.activeCanvasId = canvases.some((canvas) => canvas.id === activeCanvasId)
      ? activeCanvasId
      : canvases[0]?.id || null;
    return this.state();
  }

  state() {
    return {
      canvases: this.list(),
      activeCanvasId: this.activeCanvasId
    };
  }
}

function normalizeBlock(input, index, canvasSource) {
  const block = object(input, `blocks[${index}] must be an object`);
  const type = text(block.type, `blocks[${index}].type`, 32);
  if (!CANVAS_BLOCK_TYPES.includes(type)) {
    throw new Error(`Unsupported canvas block type: ${type}`);
  }

  const common = {
    id: optionalText(block.id, `blocks[${index}].id`, 80) || `block-${index + 1}`,
    type,
    title: optionalText(block.title, `blocks[${index}].title`, 160),
    provenance: normalizeBlockProvenance(
      block.provenance || {},
      canvasSource,
      `blocks[${index}].provenance`
    )
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

  if (type === "code") {
    const startLine = Number(block.start_line || block.startLine || 1);
    if (!Number.isSafeInteger(startLine) || startLine < 1 || startLine > 1_000_000) {
      throw new Error(`blocks[${index}].start_line must be a positive integer`);
    }
    return {
      ...common,
      language: optionalText(block.language, `blocks[${index}].language`, 64),
      filename: optionalText(block.filename, `blocks[${index}].filename`, 500),
      startLine,
      content: preservedText(block.content, `blocks[${index}].content`, 50_000)
    };
  }

  if (type === "document") {
    const artifacts = array(
      block.artifacts || [],
      `blocks[${index}].artifacts`,
      MAX_DOCUMENT_ARTIFACTS
    );
    if (artifacts.length === 0) throw new Error(`blocks[${index}].artifacts cannot be empty`);
    const diagnostics = array(
      block.diagnostics || [],
      `blocks[${index}].diagnostics`,
      MAX_DOCUMENT_DIAGNOSTICS
    );
    const pagePreview = block.page_preview || block.pagePreview || null;
    return {
      ...common,
      document: normalizeDocumentSpec(block.document),
      artifacts: artifacts.map((artifact, artifactIndex) => normalizeDocumentArtifact(
        artifact,
        `blocks[${index}].artifacts[${artifactIndex}]`
      )),
      diagnostics: diagnostics.map((diagnostic, diagnosticIndex) => normalizeDocumentDiagnostic(
        diagnostic,
        `blocks[${index}].diagnostics[${diagnosticIndex}]`
      )),
      pagePreview: pagePreview ? normalizeDocumentPagePreview(
        pagePreview,
        `blocks[${index}].page_preview`
      ) : null,
      estimatedPages: boundedInteger(
        block.estimated_pages || block.estimatedPages || 1,
        `blocks[${index}].estimated_pages`,
        1,
        10_000
      ),
      previewTruncated: block.preview_truncated === true || block.previewTruncated === true,
      totalBlocks: boundedInteger(
        block.total_blocks || block.totalBlocks || block.document?.blocks?.length || 1,
        `blocks[${index}].total_blocks`,
        1,
        300
      )
    };
  }

  if (type === "spreadsheet") {
    const artifact = normalizeSpreadsheetArtifact(
      block.artifact,
      `blocks[${index}].artifact`
    );
    const verification = object(
      block.verification || {},
      `blocks[${index}].verification must be an object`
    );
    const sheetNames = array(
      block.sheet_names || block.sheetNames || [],
      `blocks[${index}].sheet_names`,
      MAX_SPREADSHEET_SHEETS
    ).map((name, sheetIndex) =>
      text(name, `blocks[${index}].sheet_names[${sheetIndex}]`, 31)
    );
    const checks = array(
      block.checks || [],
      `blocks[${index}].checks`,
      MAX_SPREADSHEET_CHECKS
    ).map((check, checkIndex) => {
      const value = object(check, `blocks[${index}].checks[${checkIndex}] must be an object`);
      return {
        label: text(value.label, `blocks[${index}].checks[${checkIndex}].label`, 240),
        passed: value.passed === true,
        required: value.required !== false,
        note: optionalText(value.note, `blocks[${index}].checks[${checkIndex}].note`, 500)
      };
    });
    return {
      ...common,
      artifact,
      sheetNames,
      checks,
      verification: {
        verified: verification.verified === true,
        sheetCount: boundedInteger(
          verification.sheetCount ?? verification.sheet_count ?? sheetNames.length,
          `blocks[${index}].verification.sheet_count`,
          1,
          MAX_SPREADSHEET_SHEETS + 1
        ),
        formulaCount: boundedInteger(
          verification.formulaCount ?? verification.formula_count ?? 0,
          `blocks[${index}].verification.formula_count`,
          0,
          100_000
        ),
        checkCount: boundedInteger(
          verification.checkCount ?? verification.check_count ?? checks.length,
          `blocks[${index}].verification.check_count`,
          0,
          MAX_SPREADSHEET_CHECKS
        ),
        checksPassed: boundedInteger(
          verification.checksPassed ?? verification.checks_passed ?? checks.filter((check) => check.passed).length,
          `blocks[${index}].verification.checks_passed`,
          0,
          MAX_SPREADSHEET_CHECKS
        ),
        requiredChecksPassed: verification.requiredChecksPassed === true ||
          verification.required_checks_passed === true
      }
    };
  }

  if (type === "browser") {
    const viewport = object(block.viewport || {}, `blocks[${index}].viewport must be an object`);
    const localPreviewAttested = block[LOCAL_PREVIEW_ATTESTATION] === true;
    const normalized = {
      ...common,
      sessionId: text(block.session_id || block.sessionId, `blocks[${index}].session_id`, 128),
      url: safeBrowserUrl(block.url, `blocks[${index}].url`, { localPreviewAttested }),
      status: enumValue(
        block.status || "ready",
        ["loading", "ready", "error", "closed"],
        `blocks[${index}].status`
      ),
      pageRevision: boundedInteger(
        block.page_revision ?? block.pageRevision ?? 0,
        `blocks[${index}].page_revision`,
        0,
        Number.MAX_SAFE_INTEGER
      ),
      frameId: optionalText(block.frame_id || block.frameId, `blocks[${index}].frame_id`, 128),
      frameSha256: optionalText(
        block.frame_sha256 || block.frameSha256,
        `blocks[${index}].frame_sha256`,
        64
      ),
      viewport: {
        width: boundedInteger(viewport.width || 1280, `blocks[${index}].viewport.width`, 1, 4_000),
        height: boundedInteger(viewport.height || 800, `blocks[${index}].viewport.height`, 1, 4_000)
      },
      observedAt: isoDate(
        block.observed_at || block.observedAt || new Date().toISOString(),
        `blocks[${index}].observed_at`
      ),
      elementCount: boundedInteger(
        block.element_count ?? block.elementCount ?? 0,
        `blocks[${index}].element_count`,
        0,
        120
      ),
      summary: optionalText(block.summary, `blocks[${index}].summary`, 1_000),
      visualFallback: block.visual_fallback === true || block.visualFallback === true,
      visualTarget: optionalText(
        block.visual_target || block.visualTarget,
        `blocks[${index}].visual_target`,
        300
      ),
      download: normalizeBrowserDownload(block.download, `blocks[${index}].download`),
      takeoverActive: block.takeover_active === true || block.takeoverActive === true,
      interactive: block.interactive === true
    };
    if (localPreviewAttested) {
      Object.defineProperty(normalized, LOCAL_PREVIEW_ATTESTATION, {
        value: true,
        enumerable: false
      });
    }
    return normalized;
  }

  if (type === "link") {
    return {
      ...common,
      label: text(block.label, `blocks[${index}].label`, 160),
      url: safePreviewUrl(block.url, `blocks[${index}].url`),
      description: optionalText(block.description, `blocks[${index}].description`, 500),
      actionLabel: optionalText(
        block.action_label || block.actionLabel,
        `blocks[${index}].action_label`,
        80
      ) || "Open in browser"
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

function normalizeBrowserDownload(input, path) {
  if (input === undefined || input === null) return null;
  const artifact = object(input, `${path} must be an object`);
  const sha256 = text(artifact.sha256, `${path}.sha256`, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`${path}.sha256 must be a SHA-256 digest`);
  return {
    attachmentId: text(artifact.attachment_id || artifact.attachmentId, `${path}.attachment_id`, 128),
    name: text(artifact.name, `${path}.name`, 240),
    mime: text(artifact.mime || "application/octet-stream", `${path}.mime`, 200),
    size: boundedInteger(artifact.size, `${path}.size`, 1, 20 * 1024 * 1024),
    sha256
  };
}

function normalizeDocumentPagePreview(input, path) {
  const preview = object(input, `${path} must be an object`);
  const pages = array(preview.pages || [], `${path}.pages`, MAX_DOCUMENT_PREVIEW_PAGES)
    .map((page, index) => {
      const value = object(page, `${path}.pages[${index}] must be an object`);
      const previewPath = text(value.path, `${path}.pages[${index}].path`, 1_000).replaceAll("\\", "/");
      if (
        !previewPath.startsWith(".amos/previews/") ||
        previewPath.split("/").includes("..") ||
        !previewPath.toLowerCase().endsWith(".png")
      ) {
        throw new Error(`${path}.pages[${index}].path must be an AMOS preview PNG path`);
      }
      const sha256 = text(value.sha256, `${path}.pages[${index}].sha256`, 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error(`${path}.pages[${index}].sha256 must be a SHA-256 digest`);
      }
      return {
        path: previewPath,
        page: boundedInteger(value.page, `${path}.pages[${index}].page`, 1, 10_000),
        width: boundedInteger(value.width, `${path}.pages[${index}].width`, 1, 4_000),
        height: boundedInteger(value.height, `${path}.pages[${index}].height`, 1, 6_000),
        bytes: boundedInteger(value.bytes, `${path}.pages[${index}].bytes`, 1, 5_000_000),
        sha256
      };
    });
  return {
    pageCount: boundedInteger(
      preview.page_count || preview.pageCount || pages.length,
      `${path}.page_count`,
      1,
      10_000
    ),
    truncated: preview.truncated === true,
    pages
  };
}

function normalizeCanvasState(input) {
  const state = typeof input === "string" ? { kind: input } : object(input, "state must be an object");
  return {
    kind: enumValue(state.kind || "ready", [...CANVAS_STATE_KINDS], "state.kind"),
    message: optionalText(state.message, "state.message", 500)
  };
}

function normalizeBlockProvenance(input, canvasSource, path) {
  const value = object(input, `${path} must be an object`);
  const references = array(value.references || canvasSource.references || [], `${path}.references`, MAX_SOURCES);
  return {
    sourceKind: enumValue(
      value.source_kind || value.sourceKind || canvasSource.kind,
      [...SOURCE_KINDS],
      `${path}.source_kind`
    ),
    sourceLabel:
      optionalText(value.source_label || value.sourceLabel, `${path}.source_label`, 160) ||
      canvasSource.label,
    tenantId: optionalText(value.tenant_id || value.tenantId, `${path}.tenant_id`, 160),
    observedAt: isoDate(
      value.observed_at || value.observedAt || canvasSource.refreshedAt,
      `${path}.observed_at`
    ),
    staleAfter: optionalIsoDate(
      value.stale_after || value.staleAfter || canvasSource.staleAfter,
      `${path}.stale_after`
    ),
    uncertainty: enumValue(
      value.uncertainty || "none",
      ["none", "estimated", "partial", "unknown"],
      `${path}.uncertainty`
    ),
    receiptId: optionalText(value.receipt_id || value.receiptId, `${path}.receipt_id`, 120),
    approvalId: optionalText(value.approval_id || value.approvalId, `${path}.approval_id`, 120),
    references: references.map((reference, referenceIndex) =>
      normalizeReference(reference, `${path}.references[${referenceIndex}]`)
    )
  };
}

function normalizeSource(input, now) {
  const source = object(input, "source must be an object");
  const references = array(source.references || [], "source.references", MAX_SOURCES);
  const normalized = {
    kind: enumValue(source.kind || "live", [...SOURCE_KINDS], "source.kind"),
    label: optionalText(source.label, "source.label", 160) || "AMOS company data",
    refreshedAt: isoDate(source.refreshed_at || source.refreshedAt || now(), "source.refreshed_at"),
    staleAfter: optionalIsoDate(source.stale_after || source.staleAfter, "source.stale_after"),
    refreshPrompt: optionalText(source.refresh_prompt || source.refreshPrompt, "source.refresh_prompt", 500),
    references: references.map((reference, index) =>
      normalizeReference(reference, `source.references[${index}]`)
    )
  };
  const briefing = source.briefing;
  if (briefing && typeof briefing === "object" && !Array.isArray(briefing)) {
    normalized.briefing = normalizeBriefingReference(briefing);
  }
  return normalized;
}

function normalizeBriefingReference(input) {
  const sourcePlan = Array.isArray(input.sourcePlan || input.source_plan)
    ? structuredClone(input.sourcePlan || input.source_plan).slice(0, 8)
    : [];
  return {
    definitionId: optionalText(input.definitionId || input.definition_id, "source.briefing.definition_id", 120),
    runId: optionalText(input.runId || input.run_id, "source.briefing.run_id", 120),
    templateKey: optionalText(input.templateKey || input.template_key, "source.briefing.template_key", 80),
    title: text(input.title, "source.briefing.title", 160),
    objective: text(input.objective, "source.briefing.objective", 4_000),
    sourcePlan,
    parameters: input.parameters && typeof input.parameters === "object"
      ? structuredClone(input.parameters)
      : {},
    presentation: input.presentation && typeof input.presentation === "object"
      ? structuredClone(input.presentation)
      : {}
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

function normalizeDocumentArtifact(input, path) {
  const artifact = object(input, `${path} must be an object`);
  const format = enumValue(artifact.format, ["docx", "pdf"], `${path}.format`);
  const artifactPath = text(artifact.path, `${path}.path`, 1_000);
  const portablePath = artifactPath.replaceAll("\\", "/");
  if (
    portablePath.startsWith("/") ||
    /^[a-z]:\//i.test(portablePath) ||
    portablePath.split("/").includes("..") ||
    !portablePath.toLowerCase().endsWith(`.${format}`)
  ) {
    throw new Error(`${path}.path must be a workspace-relative ${format.toUpperCase()} path`);
  }
  const sha256 = text(artifact.sha256, `${path}.sha256`, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`${path}.sha256 must be a SHA-256 digest`);
  return {
    path: portablePath,
    format,
    bytes: boundedInteger(artifact.bytes, `${path}.bytes`, 1, Number.MAX_SAFE_INTEGER),
    sha256,
    verified: artifact.verified === true
  };
}

function normalizeSpreadsheetArtifact(input, path) {
  const artifact = object(input, `${path} must be an object`);
  const artifactPath = text(artifact.path, `${path}.path`, 1_000);
  const portablePath = artifactPath.replaceAll("\\", "/");
  if (
    portablePath.startsWith("/") ||
    /^[a-z]:\//i.test(portablePath) ||
    portablePath.split("/").includes("..") ||
    !portablePath.toLowerCase().endsWith(".xlsx")
  ) {
    throw new Error(`${path}.path must be a workspace-relative XLSX path`);
  }
  const sha256 = text(artifact.sha256, `${path}.sha256`, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`${path}.sha256 must be a SHA-256 digest`);
  return {
    path: portablePath,
    format: "xlsx",
    bytes: boundedInteger(artifact.bytes, `${path}.bytes`, 1, Number.MAX_SAFE_INTEGER),
    sha256,
    verified: artifact.verified === true
  };
}

function normalizeDocumentDiagnostic(input, path) {
  const diagnostic = object(input, `${path} must be an object`);
  const normalized = {
    severity: enumValue(diagnostic.severity || "warning", ["info", "warning", "error"], `${path}.severity`),
    code: text(diagnostic.code, `${path}.code`, 80),
    message: text(diagnostic.message, `${path}.message`, 500)
  };
  const blockIndex = diagnostic.block_index ?? diagnostic.blockIndex;
  if (blockIndex != null) {
    normalized.blockIndex = boundedInteger(blockIndex, `${path}.block_index`, 0, 299);
  }
  return normalized;
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

function boundedInteger(value, path, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${path} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function preservedText(value, path, limit) {
  if (typeof value !== "string") throw new Error(`${path} must be text`);
  if (!value.trim()) throw new Error(`${path} cannot be empty`);
  if (value.length > limit) throw new Error(`${path} exceeds the limit of ${limit} characters`);
  return value;
}

function safePreviewUrl(value, path) {
  const raw = text(value, path, 2_048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${path} must be a valid URL`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${path} must use HTTPS or loopback HTTP`);
  }
  if (url.username || url.password) {
    throw new Error(`${path} cannot contain embedded credentials`);
  }
  for (const key of url.searchParams.keys()) {
    if (/(?:token|secret|password|signature|api[_-]?key|access[_-]?key|code)/i.test(key)) {
      throw new Error(`${path} cannot contain credential-like query parameters`);
    }
  }
  return url.toString();
}

function safeBrowserUrl(value, path, { localPreviewAttested = false } = {}) {
  const raw = text(value, path, 2_048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${path} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${path} must use HTTP or HTTPS`);
  }
  const host = url.hostname.toLowerCase();
  const exactLoopbackPreview =
    localPreviewAttested &&
    url.protocol === "http:" &&
    host === "127.0.0.1" &&
    Boolean(url.port) &&
    Number(url.port) >= 1024;
  if (
    !host ||
    (!exactLoopbackPreview && ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(host)) ||
    host.endsWith(".local")
  ) {
    throw new Error(`${path} cannot target a local network host`);
  }
  if (url.username || url.password) {
    throw new Error(`${path} cannot contain embedded credentials`);
  }
  return url.toString();
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
