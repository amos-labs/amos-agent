export const SLIDE_WIDTH_IN = 13.333333;
export const SLIDE_HEIGHT_IN = 7.5;

export const PRESENTATION_THEMES = Object.freeze({
  business: {
    font: "Calibri",
    accent: "1F4E78",
    accentLight: "EAF2F8",
    text: "1F2937",
    muted: "64748B",
    line: "CBD5E1",
    surface: "FFFFFF",
    background: "F8FAFC"
  },
  compact: {
    font: "Calibri",
    accent: "0F766E",
    accentLight: "E6FFFA",
    text: "17202A",
    muted: "5B6770",
    line: "CBD5E1",
    surface: "FFFFFF",
    background: "F8FFFD"
  },
  proposal: {
    font: "Calibri",
    accent: "7C3E21",
    accentLight: "FFF3E8",
    text: "2D2926",
    muted: "6B625D",
    line: "D8CFC8",
    surface: "FFFFFF",
    background: "FFFCF8"
  }
});

export function resolvedTheme(spec) {
  const base = { ...PRESENTATION_THEMES[spec.style] };
  if (spec.brand?.primary_color) base.accent = spec.brand.primary_color;
  if (spec.brand?.secondary_color) base.accentLight = spec.brand.secondary_color;
  if (spec.brand?.text_color) base.text = spec.brand.text_color;
  return base;
}

export function layoutPresentationSlides(spec, assets = null) {
  const theme = resolvedTheme(spec);
  return spec.slides.map((slide, index) => ({
    index,
    number: index + 1,
    title: slide.title,
    layout: slide.layout,
    theme,
    primitives: layoutSlide(spec, slide, index, theme, assets)
  }));
}

export function layoutSlide(spec, slide, index, theme, assets = null) {
  const primitives = [];
  const addRect = (box) => primitives.push({ kind: "rect", ...box });
  const addText = (box) => primitives.push({ kind: "text", ...box });
  const addPicture = (box, asset) => {
    if (!asset?.data) throw new Error(`slides[${index}] is missing a required image asset`);
    primitives.push({ kind: "picture", ...box, asset });
  };
  const addTable = (box) => primitives.push({ kind: "table", ...box });

  addRect({
    x: 0,
    y: 0,
    w: SLIDE_WIDTH_IN,
    h: SLIDE_HEIGHT_IN,
    fill: theme.background
  });
  addRect({ x: 0, y: 0, w: SLIDE_WIDTH_IN, h: 0.08, fill: theme.accent });

  if (slide.layout === "title") {
    if (assets?.logo?.data) addPicture({ x: 0.7, y: 0.55, w: 1.5, h: 0.5, name: "Logo" }, assets.logo);
    addText({
      x: 0.7,
      y: 2.15,
      w: 12,
      h: 1.7,
      text: slide.title,
      size: 36,
      bold: true,
      color: theme.text,
      anchor: "b"
    });
    if (slide.subtitle || spec.subtitle) {
      addText({
        x: 0.7,
        y: 4.0,
        w: 12,
        h: 0.7,
        text: slide.subtitle || spec.subtitle,
        size: 18,
        color: theme.muted
      });
    }
    if (slide.text) {
      addText({ x: 0.7, y: 4.75, w: 11, h: 0.7, text: slide.text, size: 16, color: theme.text });
    }
    if (spec.author) {
      addText({ x: 0.7, y: 5.55, w: 8, h: 0.35, text: spec.author, size: 13, color: theme.muted });
    }
  } else if (slide.layout === "section") {
    addRect({ x: 0, y: 0, w: 0.18, h: SLIDE_HEIGHT_IN, fill: theme.accent });
    addText({
      x: 0.9,
      y: 2.7,
      w: 11.6,
      h: 1.4,
      text: slide.title,
      size: 34,
      bold: true,
      color: theme.text,
      align: "ctr",
      anchor: "ctr"
    });
    if (slide.subtitle) {
      addText({
        x: 0.9,
        y: 4.2,
        w: 11.6,
        h: 0.6,
        text: slide.subtitle,
        size: 16,
        color: theme.muted,
        align: "ctr"
      });
    }
  } else if (slide.layout === "bullets") {
    addHeading(addText, slide, theme);
    addText({
      x: 0.7,
      y: 1.95,
      w: 12,
      h: 4.7,
      paragraphs: slide.items.map((item) => ({ text: item, bullet: true })),
      size: 18,
      color: theme.text
    });
  } else if (slide.layout === "two_column") {
    addHeading(addText, slide, theme);
    slide.columns.forEach((column, columnIndex) => {
      const x = columnIndex === 0 ? 0.7 : 7.0;
      addRect({ x, y: 1.85, w: 5.65, h: 4.75, fill: theme.surface, line: theme.line });
      addRect({ x, y: 1.85, w: 0.1, h: 4.75, fill: theme.accent });
      addText({
        x: x + 0.3,
        y: 2.05,
        w: 5.15,
        h: 0.5,
        text: column.title,
        size: 16,
        bold: true,
        color: theme.accent
      });
      const paragraphs = [
        ...(column.text ? [{ text: column.text }] : []),
        ...column.items.map((item) => ({ text: item, bullet: true }))
      ];
      addText({ x: x + 0.3, y: 2.6, w: 5.15, h: 3.75, paragraphs, size: 15, color: theme.text });
    });
  } else if (slide.layout === "metrics") {
    addHeading(addText, slide, theme);
    const columns = slide.metrics.length > 4 ? 3 : slide.metrics.length;
    const rows = Math.ceil(slide.metrics.length / columns);
    const gap = 0.22;
    const width = (12 - (gap * (columns - 1))) / columns;
    const height = rows === 1 ? 3.4 : 2.25;
    slide.metrics.forEach((metric, metricIndex) => {
      const column = metricIndex % columns;
      const row = Math.floor(metricIndex / columns);
      const x = 0.7 + (column * (width + gap));
      const y = 1.9 + (row * (height + gap));
      addRect({ x, y, w: width, h: height, fill: theme.surface, line: theme.line });
      addRect({ x, y, w: width, h: 0.08, fill: theme.accent });
      addText({
        x: x + 0.22,
        y: y + 0.28,
        w: width - 0.44,
        h: 0.4,
        text: metric.label,
        size: 12,
        color: theme.muted
      });
      addText({
        x: x + 0.22,
        y: y + 0.75,
        w: width - 0.44,
        h: 0.85,
        text: metric.value,
        size: 26,
        bold: true,
        color: theme.text
      });
      if (metric.delta) {
        addText({
          x: x + 0.22,
          y: y + 1.65,
          w: width - 0.44,
          h: 0.3,
          text: metric.delta,
          size: 13,
          color: theme.accent
        });
      }
      if (metric.note) {
        addText({
          x: x + 0.22,
          y: y + height - 0.55,
          w: width - 0.44,
          h: 0.35,
          text: metric.note,
          size: 12,
          color: theme.muted
        });
      }
    });
  } else if (slide.layout === "table") {
    addHeading(addText, slide, theme);
    addTable({
      x: 0.7,
      y: 1.85,
      w: 12,
      h: 4.75,
      headers: slide.headers,
      rows: slide.rows,
      theme
    });
  } else if (slide.layout === "chart") {
    addHeading(addText, slide, theme);
    addPicture({ x: 0.7, y: 1.7, w: 12, h: 4.35, name: slide.alt_text || "Chart" }, assets?.charts?.get(index));
    if (slide.caption) {
      addText({ x: 0.7, y: 6.15, w: 12, h: 0.3, text: slide.caption, size: 12, color: theme.muted });
    }
  } else if (slide.layout === "quote") {
    addHeading(addText, slide, theme);
    addRect({ x: 0.7, y: 1.95, w: 0.12, h: 3.4, fill: theme.accent });
    addText({
      x: 1.15,
      y: 2.1,
      w: 11.3,
      h: 2.4,
      text: `“${slide.quote}”`,
      size: 22,
      color: theme.text
    });
    if (slide.attribution) {
      addText({ x: 1.15, y: 4.7, w: 11.3, h: 0.4, text: slide.attribution, size: 14, color: theme.muted });
    }
  } else if (slide.layout === "image") {
    addHeading(addText, slide, theme);
    addPicture(
      { x: 0.7, y: 1.65, w: 12, h: 4.4, name: slide.alt_text || "Image" },
      assets?.images?.get(slide.path)
    );
    if (slide.caption) {
      addText({ x: 0.7, y: 6.15, w: 12, h: 0.3, text: slide.caption, size: 12, color: theme.muted });
    }
  } else {
    addHeading(addText, slide, theme);
    if (slide.next_step) {
      addRect({ x: 0.7, y: 1.85, w: 12, h: 1.15, fill: theme.accentLight, line: theme.line });
      addText({
        x: 0.95,
        y: 2.05,
        w: 11.5,
        h: 0.8,
        text: slide.next_step,
        size: 20,
        bold: true,
        color: theme.accent
      });
    }
    if (slide.items.length > 0) {
      addText({
        x: 0.7,
        y: slide.next_step ? 3.2 : 1.95,
        w: 12,
        h: 2.4,
        paragraphs: slide.items.map((item) => ({ text: item, bullet: true })),
        size: 16,
        color: theme.text
      });
    }
    if (slide.sources.length > 0) {
      addText({
        x: 0.7,
        y: 5.7,
        w: 12,
        h: 0.85,
        paragraphs: slide.sources.map((source) => ({
          text: `${source.label}${source.source_ref ? ` — ${source.source_ref}` : ""}${source.url ? ` — ${source.url}` : ""}`,
          size: 11
        })),
        size: 11,
        color: theme.muted
      });
    }
  }

  const footerBits = [spec.brand?.name, spec.footer].filter(Boolean);
  if (footerBits.length > 0) {
    addText({
      x: 0.7,
      y: 7.08,
      w: 10.2,
      h: 0.26,
      text: footerBits.join("  ·  "),
      size: 10,
      color: theme.muted
    });
  }
  addText({
    x: 11.3,
    y: 7.08,
    w: 1.3,
    h: 0.26,
    text: String(index + 1),
    size: 10,
    color: theme.muted,
    align: "r"
  });

  return primitives;
}

function addHeading(addText, slide, theme) {
  if (slide.eyebrow) {
    addText({
      x: 0.7,
      y: 0.28,
      w: 12,
      h: 0.28,
      text: slide.eyebrow.toUpperCase(),
      size: 11,
      color: theme.accent
    });
  }
  addText({
    x: 0.7,
    y: slide.eyebrow ? 0.55 : 0.32,
    w: 12,
    h: 0.85,
    text: slide.title,
    size: 24,
    bold: true,
    color: theme.text
  });
  if (slide.subtitle) {
    addText({ x: 0.7, y: 1.35, w: 12, h: 0.4, text: slide.subtitle, size: 14, color: theme.muted });
  }
}
