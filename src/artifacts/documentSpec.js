export const DOCUMENT_SPEC_VERSION = "1";
export const DOCUMENT_FORMATS = Object.freeze(["docx", "pdf"]);
export const DOCUMENT_STYLES = Object.freeze(["business", "compact", "proposal"]);
export const DOCUMENT_BLOCK_TYPES = Object.freeze([
  "heading",
  "paragraph",
  "list",
  "table",
  "callout",
  "page_break",
  "sources"
]);

const MAX_BLOCKS = 300;
const MAX_TOTAL_CHARACTERS = 250_000;
const MAX_LIST_ITEMS = 100;
const MAX_TABLE_COLUMNS = 8;
const MAX_TABLE_ROWS = 200;
const MAX_SOURCES = 100;

export function normalizeDocumentSpec(input) {
  const source = object(input, "DocumentSpec must be an object");
  const version = text(source.version || DOCUMENT_SPEC_VERSION, "version", 8);
  if (version !== DOCUMENT_SPEC_VERSION) {
    throw new Error(`Unsupported DocumentSpec version: ${version}`);
  }

  const style = text(source.style || "business", "style", 32);
  if (!DOCUMENT_STYLES.includes(style)) throw new Error(`Unsupported document style: ${style}`);
  const blocks = array(source.blocks, "blocks", 1, MAX_BLOCKS).map(normalizeBlock);
  const normalized = {
    version,
    title: text(source.title, "title", 300),
    subtitle: optionalText(source.subtitle, "subtitle", 500),
    author: optionalText(source.author, "author", 200),
    subject: optionalText(source.subject, "subject", 500),
    style,
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
  const values = [spec.title, spec.subtitle, spec.author, spec.subject];
  for (const block of spec.blocks || []) {
    values.push(block.text, block.label);
    values.push(...(block.items || []));
    values.push(...(block.headers || []));
    for (const row of block.rows || []) values.push(...row);
    for (const source of block.sources || []) {
      values.push(source.label, source.url, source.source_ref);
    }
  }
  return values.filter(Boolean).join("\n");
}

function normalizeBlock(value, index) {
  const block = object(value, `blocks[${index}] must be an object`);
  const type = text(block.type, `blocks[${index}].type`, 32);
  if (!DOCUMENT_BLOCK_TYPES.includes(type)) throw new Error(`Unsupported document block: ${type}`);
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
  if (type === "sources") {
    return {
      type,
      sources: array(block.sources, `blocks[${index}].sources`, 1, MAX_SOURCES)
        .map((item, sourceIndex) => normalizeSource(item, index, sourceIndex))
    };
  }
  return { type: "page_break" };
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
