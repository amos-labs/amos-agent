export const PRESENTATION_SPEC_VERSION = "1";
export const PRESENTATION_KINDS = Object.freeze([
  "briefing",
  "investor",
  "operating_review",
  "sales",
  "general"
]);
export const PRESENTATION_SIZES = Object.freeze(["widescreen_16_9"]);
export const PRESENTATION_STYLES = Object.freeze(["business", "compact", "proposal"]);
export const PRESENTATION_TEMPLATES = Object.freeze([
  "standard_business_brief",
  "compact_reference_guide",
  "narrative_proposal"
]);
export const PRESENTATION_LAYOUTS = Object.freeze([
  "title",
  "section",
  "bullets",
  "two_column",
  "metrics",
  "table",
  "chart",
  "quote",
  "image",
  "closer"
]);

export const PRESENTATION_LIMITS = Object.freeze({
  maxSlides: 40,
  maxBullets: 8,
  maxMetrics: 6,
  maxTableColumns: 8,
  maxTableRows: 12,
  maxCharts: 12,
  maxVisuals: 16,
  maxChartLabels: 12,
  maxChartSeries: 4,
  maxColumnItems: 6,
  maxCloserItems: 6,
  maxSources: 12,
  maxNotes: 4_000,
  maxTotalCharacters: 80_000
});

export function normalizePresentationSpec(input) {
  // Cheap early guard: reject a runaway or hostile payload before any per-field
  // normalization allocates. The authoritative text budget is re-checked on the
  // normalized spec below; this only bounds raw input size (2x headroom for
  // JSON structure, escaping, and non-text fields).
  const rawSize = input == null ? 0 : Buffer.byteLength(safeSerialize(input), "utf8");
  if (rawSize > PRESENTATION_LIMITS.maxTotalCharacters * 2) {
    throw new Error(
      `Presentation payload exceeds the ${(PRESENTATION_LIMITS.maxTotalCharacters * 2).toLocaleString()} byte input limit`
    );
  }
  const source = object(input, "PresentationSpec must be an object");
  const version = text(source.version || PRESENTATION_SPEC_VERSION, "version", 8);
  if (version !== PRESENTATION_SPEC_VERSION) {
    throw new Error(`Unsupported PresentationSpec version: ${version}`);
  }

  const requestedStyle = text(source.style || "business", "style", 32);
  if (!PRESENTATION_STYLES.includes(requestedStyle)) {
    throw new Error(`Unsupported presentation style: ${requestedStyle}`);
  }
  const template = source.template
    ? text(source.template, "template", 80)
    : templateForStyle(requestedStyle);
  if (!PRESENTATION_TEMPLATES.includes(template)) {
    throw new Error(`Unsupported presentation template: ${template}`);
  }
  const style = styleForTemplate(template);
  if (source.template && source.style && style !== requestedStyle) {
    throw new Error(`Presentation style ${requestedStyle} does not match template ${template}`);
  }

  const slides = array(source.slides, "slides", 1, PRESENTATION_LIMITS.maxSlides)
    .map((slide, index) => normalizeSlide(slide, index));
  const chartCount = slides.filter((slide) => slide.layout === "chart").length;
  const visualCount = slides.filter((slide) => ["chart", "image"].includes(slide.layout)).length;
  if (chartCount > PRESENTATION_LIMITS.maxCharts) {
    throw new Error(`Presentation charts exceed the limit of ${PRESENTATION_LIMITS.maxCharts}`);
  }
  if (visualCount > PRESENTATION_LIMITS.maxVisuals) {
    throw new Error(`Presentation visuals exceed the limit of ${PRESENTATION_LIMITS.maxVisuals}`);
  }

  const normalized = {
    version,
    title: text(source.title, "title", 160),
    subtitle: optionalText(source.subtitle, "subtitle", 240),
    author: optionalText(source.author, "author", 160),
    kind: enumValue(source.kind || "general", PRESENTATION_KINDS, "kind"),
    size: enumValue(source.size || "widescreen_16_9", PRESENTATION_SIZES, "size"),
    style,
    template,
    brand: normalizeBrand(source.brand),
    footer: optionalText(source.footer, "footer", 160),
    slides
  };
  const characters = presentationText(normalized).length;
  if (characters > PRESENTATION_LIMITS.maxTotalCharacters) {
    throw new Error(
      `Presentation content exceeds the ${PRESENTATION_LIMITS.maxTotalCharacters.toLocaleString()} character limit`
    );
  }
  return normalized;
}

export function presentationText(spec) {
  const values = [
    spec.title,
    spec.subtitle,
    spec.author,
    spec.footer,
    spec.brand?.name,
    spec.brand?.logo_path
  ];
  for (const slide of spec.slides || []) {
    values.push(
      slide.title,
      slide.eyebrow,
      slide.subtitle,
      slide.text,
      slide.quote,
      slide.attribution,
      slide.next_step,
      slide.notes,
      slide.alt_text,
      slide.caption,
      slide.source_ref,
      slide.path
    );
    values.push(...(slide.items || []));
    values.push(...(slide.headers || []));
    values.push(...(slide.labels || []));
    for (const column of slide.columns || []) {
      values.push(column.title, column.text, ...(column.items || []));
    }
    for (const metric of slide.metrics || []) {
      values.push(metric.label, metric.value, metric.delta, metric.note);
    }
    for (const series of slide.series || []) values.push(series.name);
    for (const row of slide.rows || []) values.push(...row);
    for (const source of slide.sources || []) {
      values.push(source.label, source.url, source.source_ref);
    }
  }
  return values.filter(Boolean).join("\n");
}

export function presentationSlideTitles(spec) {
  return (spec.slides || []).map((slide) => slide.title);
}

function normalizeSlide(value, index) {
  const slide = object(value, `slides[${index}] must be an object`);
  const layout = text(slide.layout, `slides[${index}].layout`, 32);
  if (!PRESENTATION_LAYOUTS.includes(layout)) {
    throw new Error(`Unsupported presentation layout: ${layout}`);
  }
  const base = {
    layout,
    title: text(slide.title, `slides[${index}].title`, 120),
    eyebrow: optionalText(slide.eyebrow, `slides[${index}].eyebrow`, 80),
    subtitle: optionalText(slide.subtitle, `slides[${index}].subtitle`, 240),
    notes: optionalText(slide.notes, `slides[${index}].notes`, PRESENTATION_LIMITS.maxNotes)
  };

  if (layout === "title") {
    return {
      ...base,
      text: optionalText(slide.text, `slides[${index}].text`, 400)
    };
  }
  if (layout === "section") {
    return base;
  }
  if (layout === "bullets") {
    return {
      ...base,
      items: array(slide.items, `slides[${index}].items`, 1, PRESENTATION_LIMITS.maxBullets)
        .map((item, itemIndex) => text(item, `slides[${index}].items[${itemIndex}]`, 240))
    };
  }
  if (layout === "two_column") {
    const columns = array(slide.columns, `slides[${index}].columns`, 2, 2)
      .map((column, columnIndex) => normalizeColumn(column, index, columnIndex));
    return { ...base, columns };
  }
  if (layout === "metrics") {
    return {
      ...base,
      metrics: array(slide.metrics, `slides[${index}].metrics`, 1, PRESENTATION_LIMITS.maxMetrics)
        .map((metric, metricIndex) => normalizeMetric(metric, index, metricIndex))
    };
  }
  if (layout === "table") {
    const headers = array(
      slide.headers,
      `slides[${index}].headers`,
      1,
      PRESENTATION_LIMITS.maxTableColumns
    ).map((header, columnIndex) => text(header, `slides[${index}].headers[${columnIndex}]`, 80));
    const rows = array(
      slide.rows,
      `slides[${index}].rows`,
      1,
      PRESENTATION_LIMITS.maxTableRows
    ).map((row, rowIndex) => {
      const cells = array(
        row,
        `slides[${index}].rows[${rowIndex}]`,
        headers.length,
        headers.length
      );
      return cells.map((cell, columnIndex) => optionalText(
        cell,
        `slides[${index}].rows[${rowIndex}][${columnIndex}]`,
        160
      ));
    });
    return { ...base, headers, rows };
  }
  if (layout === "chart") {
    const chartType = text(slide.chart_type || "bar", `slides[${index}].chart_type`, 20);
    if (!["bar", "line"].includes(chartType)) {
      throw new Error(`slides[${index}].chart_type must be bar or line`);
    }
    const labels = array(
      slide.labels,
      `slides[${index}].labels`,
      2,
      PRESENTATION_LIMITS.maxChartLabels
    ).map((label, labelIndex) => text(label, `slides[${index}].labels[${labelIndex}]`, 40));
    const series = array(
      slide.series,
      `slides[${index}].series`,
      1,
      PRESENTATION_LIMITS.maxChartSeries
    ).map((item, seriesIndex) => normalizeChartSeries(item, index, seriesIndex, labels.length));
    return {
      ...base,
      chart_type: chartType,
      labels,
      series,
      alt_text: text(slide.alt_text, `slides[${index}].alt_text`, 400),
      caption: optionalText(slide.caption, `slides[${index}].caption`, 240),
      source_ref: optionalText(slide.source_ref, `slides[${index}].source_ref`, 400)
    };
  }
  if (layout === "quote") {
    return {
      ...base,
      quote: text(slide.quote, `slides[${index}].quote`, 400),
      attribution: optionalText(slide.attribution, `slides[${index}].attribution`, 160)
    };
  }
  if (layout === "image") {
    return {
      ...base,
      path: safeImagePath(slide.path, `slides[${index}].path`),
      alt_text: text(slide.alt_text, `slides[${index}].alt_text`, 400),
      caption: optionalText(slide.caption, `slides[${index}].caption`, 240),
      source_ref: optionalText(slide.source_ref, `slides[${index}].source_ref`, 400)
    };
  }
  return {
    ...base,
    next_step: optionalText(slide.next_step, `slides[${index}].next_step`, 240),
    items: array(slide.items || [], `slides[${index}].items`, 0, PRESENTATION_LIMITS.maxCloserItems)
      .map((item, itemIndex) => text(item, `slides[${index}].items[${itemIndex}]`, 240)),
    sources: array(slide.sources || [], `slides[${index}].sources`, 0, PRESENTATION_LIMITS.maxSources)
      .map((item, sourceIndex) => normalizeSource(item, index, sourceIndex))
  };
}

function normalizeColumn(value, slideIndex, columnIndex) {
  const path = `slides[${slideIndex}].columns[${columnIndex}]`;
  const column = object(value, `${path} must be an object`);
  const items = array(
    column.items || [],
    `${path}.items`,
    0,
    PRESENTATION_LIMITS.maxColumnItems
  ).map((item, itemIndex) => text(item, `${path}.items[${itemIndex}]`, 240));
  const textValue = optionalText(column.text, `${path}.text`, 600);
  if (items.length === 0 && !textValue) {
    throw new Error(`${path} needs text or items`);
  }
  return {
    title: text(column.title, `${path}.title`, 80),
    text: textValue,
    items
  };
}

function normalizeMetric(value, slideIndex, metricIndex) {
  const path = `slides[${slideIndex}].metrics[${metricIndex}]`;
  const metric = object(value, `${path} must be an object`);
  return {
    label: text(metric.label, `${path}.label`, 60),
    value: text(metric.value, `${path}.value`, 40),
    delta: optionalText(metric.delta, `${path}.delta`, 40),
    note: optionalText(metric.note, `${path}.note`, 80)
  };
}

function normalizeChartSeries(value, slideIndex, seriesIndex, labelCount) {
  const path = `slides[${slideIndex}].series[${seriesIndex}]`;
  const series = object(value, `${path} must be an object`);
  const values = array(series.values, `${path}.values`, labelCount, labelCount)
    .map((entry, valueIndex) => finiteNumber(entry, `${path}.values[${valueIndex}]`));
  return {
    name: text(series.name, `${path}.name`, 80),
    values,
    color: color(series.color || "", `${path}.color`)
  };
}

function normalizeBrand(value) {
  if (value == null) return null;
  const brand = object(value, "brand must be an object");
  return {
    name: optionalText(brand.name, "brand.name", 160),
    primary_color: color(brand.primary_color || "", "brand.primary_color"),
    secondary_color: color(brand.secondary_color || "", "brand.secondary_color"),
    text_color: color(brand.text_color || "", "brand.text_color"),
    logo_path: brand.logo_path ? safeImagePath(brand.logo_path, "brand.logo_path") : ""
  };
}

function normalizeSource(value, slideIndex, sourceIndex) {
  const path = `slides[${slideIndex}].sources[${sourceIndex}]`;
  const source = object(value, `${path} must be an object`);
  const url = optionalText(source.url, `${path}.url`, 2_000);
  if (url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Presentation source URLs must be valid HTTPS URLs");
    }
    if (parsed.protocol !== "https:") throw new Error("Presentation source URLs must use HTTPS");
  }
  const sourceRef = optionalText(source.source_ref, `${path}.source_ref`, 400);
  if (!url && !sourceRef) throw new Error("Each presentation source needs url or source_ref");
  return {
    label: text(source.label, `${path}.label`, 160),
    url,
    source_ref: sourceRef
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
    normalized.startsWith("/")
    || /^[a-z]:\//i.test(normalized)
    || normalized.split("/").includes("..")
    || !/\.(?:png|jpe?g)$/i.test(normalized)
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

function enumValue(value, allowed, path) {
  if (!allowed.includes(value)) throw new Error(`${path} must be one of: ${allowed.join(", ")}`);
  return value;
}

function clean(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function safeSerialize(value) {
  try {
    return JSON.stringify(value) || "";
  } catch {
    // Circular or unserializable input: fall back to a bounded string form so the
    // size guard still runs; object() below will reject non-objects anyway.
    return String(value);
  }
}
