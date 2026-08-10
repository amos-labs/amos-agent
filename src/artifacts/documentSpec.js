export const DOCUMENT_SPEC_VERSION = "2";
export const DOCUMENT_SPEC_VERSIONS = Object.freeze(["1", "2"]);
export const DOCUMENT_FORMATS = Object.freeze(["docx", "pdf"]);
export const DOCUMENT_STYLES = Object.freeze(["business", "compact", "proposal"]);
export const DOCUMENT_TEMPLATES = Object.freeze([
  "standard_business_brief",
  "compact_reference_guide",
  "narrative_proposal"
]);
export const DOCUMENT_BLOCK_TYPES = Object.freeze([
  "heading",
  "paragraph",
  "list",
  "table",
  "callout",
  "image",
  "chart",
  "page_break",
  "sources"
]);

const MAX_BLOCKS = 300;
const MAX_TOTAL_CHARACTERS = 250_000;
const MAX_LIST_ITEMS = 100;
const MAX_TABLE_COLUMNS = 8;
const MAX_TABLE_ROWS = 200;
const MAX_SOURCES = 100;
const MAX_VISUALS = 40;
const MAX_CHART_LABELS = 24;
const MAX_CHART_SERIES = 6;

export function normalizeDocumentSpec(input) {
  const source = object(input, "DocumentSpec must be an object");
  const version = text(source.version || DOCUMENT_SPEC_VERSION, "version", 8);
  if (!DOCUMENT_SPEC_VERSIONS.includes(version)) {
    throw new Error(`Unsupported DocumentSpec version: ${version}`);
  }

  const requestedStyle = text(source.style || "business", "style", 32);
  if (!DOCUMENT_STYLES.includes(requestedStyle)) {
    throw new Error(`Unsupported document style: ${requestedStyle}`);
  }
  const blocks = array(source.blocks, "blocks", 1, MAX_BLOCKS)
    .map((block, index) => normalizeBlock(block, index, version));
  const visualCount = blocks.filter((block) => ["image", "chart"].includes(block.type)).length;
  if (visualCount > MAX_VISUALS) {
    throw new Error(`Document visuals exceed the limit of ${MAX_VISUALS}`);
  }
  const template = source.template
    ? text(source.template, "template", 80)
    : templateForStyle(requestedStyle);
  if (!DOCUMENT_TEMPLATES.includes(template)) {
    throw new Error(`Unsupported document template: ${template}`);
  }
  const style = styleForTemplate(template);
  if (source.template && source.style && style !== requestedStyle) {
    throw new Error(`Document style ${requestedStyle} does not match template ${template}`);
  }
  const normalized = {
    version,
    title: text(source.title, "title", 300),
    subtitle: optionalText(source.subtitle, "subtitle", 500),
    author: optionalText(source.author, "author", 200),
    subject: optionalText(source.subject, "subject", 500),
    style,
    template,
    brand: normalizeBrand(source.brand),
    header: optionalText(source.header, "header", 200),
    footer: optionalText(source.footer, "footer", 200),
    blocks
  };
  const characters = documentText(normalized).length;
  if (characters > MAX_TOTAL_CHARACTERS) {
    throw new Error(`Document content exceeds the ${MAX_TOTAL_CHARACTERS.toLocaleString()} character limit`);
  }
  return normalized;
}

export function normalizeDocumentFormats(value) {
  const formats = [...new Set(array(value || DOCUMENT_FORMATS, "formats", 1, 2)
    .map((format) => text(format, "format", 8).toLowerCase()))];
  for (const format of formats) {
    if (!DOCUMENT_FORMATS.includes(format)) throw new Error(`Unsupported document format: ${format}`);
  }
  return formats;
}

export function documentText(spec) {
  const values = [
    spec.title,
    spec.subtitle,
    spec.author,
    spec.subject,
    spec.header,
    spec.footer,
    spec.brand?.name,
    spec.brand?.logo_path
  ];
  for (const block of spec.blocks || []) {
    values.push(block.text, block.label, block.alt_text, block.caption, block.title, block.source_ref);
    values.push(...(block.items || []));
    values.push(...(block.headers || []));
    values.push(...(block.labels || []));
    for (const series of block.series || []) values.push(series.name, ...(series.values || []));
    for (const row of block.rows || []) values.push(...row);
    for (const source of block.sources || []) {
      values.push(source.label, source.url, source.source_ref);
    }
  }
  return values.filter(Boolean).join("\n");
}

function normalizeBlock(value, index, version) {
  const block = object(value, `blocks[${index}] must be an object`);
  const type = text(block.type, `blocks[${index}].type`, 32);
  if (!DOCUMENT_BLOCK_TYPES.includes(type)) throw new Error(`Unsupported document block: ${type}`);
  if (version === "1" && ["image", "chart"].includes(type)) {
    throw new Error(`${type} blocks require DocumentSpec version 2`);
  }
  if (type === "heading") {
    const level = integer(block.level ?? 1, `blocks[${index}].level`, 1, 3);
    return { type, level, text: text(block.text, `blocks[${index}].text`, 500) };
  }
  if (type === "paragraph") {
    return { type, text: text(block.text, `blocks[${index}].text`, 20_000) };
  }
  if (type === "list") {
    const style = block.style === "numbered" ? "numbered" : "bullets";
    return {
      type,
      style,
      items: array(block.items, `blocks[${index}].items`, 1, MAX_LIST_ITEMS)
        .map((item, itemIndex) => text(item, `blocks[${index}].items[${itemIndex}]`, 4_000))
    };
  }
  if (type === "table") {
    const headers = array(block.headers, `blocks[${index}].headers`, 1, MAX_TABLE_COLUMNS)
      .map((header, columnIndex) => text(header, `blocks[${index}].headers[${columnIndex}]`, 300));
    const rows = array(block.rows, `blocks[${index}].rows`, 1, MAX_TABLE_ROWS)
      .map((row, rowIndex) => {
        const cells = array(row, `blocks[${index}].rows[${rowIndex}]`, headers.length, headers.length);
        return cells.map((cell, columnIndex) => optionalText(
          cell,
          `blocks[${index}].rows[${rowIndex}][${columnIndex}]`,
          4_000
        ));
      });
    return { type, headers, rows };
  }
  if (type === "callout") {
    return {
      type,
      label: optionalText(block.label, `blocks[${index}].label`, 120),
      text: text(block.text, `blocks[${index}].text`, 8_000)
    };
  }
  if (type === "image") {
    return {
      type,
      path: safeImagePath(block.path, `blocks[${index}].path`),
      alt_text: text(block.alt_text, `blocks[${index}].alt_text`, 1_000),
      caption: optionalText(block.caption, `blocks[${index}].caption`, 1_000),
      width_percent: integer(block.width_percent ?? 100, `blocks[${index}].width_percent`, 25, 100),
      source_ref: optionalText(block.source_ref, `blocks[${index}].source_ref`, 1_000)
    };
  }
  if (type === "chart") {
    const chartType = text(block.chart_type || "bar", `blocks[${index}].chart_type`, 20);
    if (!["bar", "line"].includes(chartType)) {
      throw new Error(`blocks[${index}].chart_type must be bar or line`);
    }
    const labels = array(block.labels, `blocks[${index}].labels`, 2, MAX_CHART_LABELS)
      .map((label, labelIndex) => text(label, `blocks[${index}].labels[${labelIndex}]`, 120));
    const series = array(block.series, `blocks[${index}].series`, 1, MAX_CHART_SERIES)
      .map((item, seriesIndex) => normalizeChartSeries(item, index, seriesIndex, labels.length));
    return {
      type,
      chart_type: chartType,
      title: text(block.title, `blocks[${index}].title`, 300),
      labels,
      series,
      alt_text: text(block.alt_text, `blocks[${index}].alt_text`, 1_000),
      caption: optionalText(block.caption, `blocks[${index}].caption`, 1_000),
      source_ref: optionalText(block.source_ref, `blocks[${index}].source_ref`, 1_000)
    };
  }
  if (type === "sources") {
    return {
      type,
      sources: array(block.sources, `blocks[${index}].sources`, 1, MAX_SOURCES)
        .map((item, sourceIndex) => normalizeSource(item, index, sourceIndex))
    };
  }
  return { type: "page_break" };
}

function normalizeBrand(value) {
  if (value == null) return null;
  const brand = object(value, "brand must be an object");
  return {
    name: optionalText(brand.name, "brand.name", 200),
    primary_color: color(brand.primary_color || "", "brand.primary_color"),
    secondary_color: color(brand.secondary_color || "", "brand.secondary_color"),
    text_color: color(brand.text_color || "", "brand.text_color"),
    logo_path: brand.logo_path ? safeImagePath(brand.logo_path, "brand.logo_path") : ""
  };
}

function normalizeChartSeries(value, blockIndex, seriesIndex, labelCount) {
  const series = object(value, `blocks[${blockIndex}].series[${seriesIndex}] must be an object`);
  const values = array(
    series.values,
    `blocks[${blockIndex}].series[${seriesIndex}].values`,
    labelCount,
    labelCount
  ).map((entry, valueIndex) => finiteNumber(
    entry,
    `blocks[${blockIndex}].series[${seriesIndex}].values[${valueIndex}]`
  ));
  return {
    name: text(series.name, `blocks[${blockIndex}].series[${seriesIndex}].name`, 120),
    values,
    color: color(series.color || "", `blocks[${blockIndex}].series[${seriesIndex}].color`)
  };
}

function templateForStyle(style) {
  return {
    business: "standard_business_brief",
    compact: "compact_reference_guide",
    proposal: "narrative_proposal"
  }[style];
}

function styleForTemplate(template) {
  return {
    standard_business_brief: "business",
    compact_reference_guide: "compact",
    narrative_proposal: "proposal"
  }[template];
}

function safeImagePath(value, field) {
  const normalized = text(value, field, 1_000).replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").includes("..") ||
    !/\.(?:png|jpe?g)$/i.test(normalized)
  ) {
    throw new Error(`${field} must be a workspace-relative PNG or JPEG path`);
  }
  return normalized;
}

function color(value, field) {
  if (!value) return "";
  const normalized = String(value).trim().replace(/^#/, "").toUpperCase();
  if (!/^[A-F0-9]{6}$/.test(normalized)) throw new Error(`${field} must be a six-digit hex color`);
  return normalized;
}

function finiteNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1_000_000_000_000) {
    throw new Error(`${field} must be a finite number with absolute value at most 1e12`);
  }
  return parsed;
}

function normalizeSource(value, blockIndex, sourceIndex) {
  const source = object(value, `blocks[${blockIndex}].sources[${sourceIndex}] must be an object`);
  const url = optionalText(source.url, "source.url", 2_000);
  if (url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Document source URLs must be valid HTTPS URLs");
    }
    if (parsed.protocol !== "https:") throw new Error("Document source URLs must use HTTPS");
  }
  const sourceRef = optionalText(source.source_ref, "source.source_ref", 1_000);
  if (!url && !sourceRef) throw new Error("Each document source needs url or source_ref");
  return {
    label: text(source.label, "source.label", 500),
    url,
    source_ref: sourceRef
  };
}

function object(value, message) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(message);
  return value;
}

function array(value, field, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${field} must contain between ${min} and ${max} items`);
  }
  return value;
}

function text(value, field, maxLength) {
  const normalized = clean(value);
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return normalized;
}

function optionalText(value, field, maxLength) {
  if (value == null || value === "") return "";
  const normalized = clean(value);
  if (normalized.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return normalized;
}

function clean(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function integer(value, field, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}
