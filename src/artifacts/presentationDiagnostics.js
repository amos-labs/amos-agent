import { normalizePresentationSpec } from "./presentationSpec.js";

export function analyzePresentationLayout(input) {
  const spec = normalizePresentationSpec(input);
  const diagnostics = [];

  if (spec.title.length > 72) {
    diagnostics.push(warning(
      "long-title",
      "The deck title is likely to wrap on a 16:9 title slide; shorten it."
    ));
  }
  if (spec.slides[0]?.layout !== "title") {
    diagnostics.push(warning(
      "missing-title-slide",
      "Decks usually start with a title layout so the cover carries the deck title."
    ));
  }
  if (["investor", "sales", "operating_review"].includes(spec.kind)
    && spec.slides.at(-1)?.layout !== "closer") {
    diagnostics.push(warning(
      "missing-closer",
      "This deck kind usually ends with a closer slide that states the next step."
    ));
  }

  spec.slides.forEach((slide, index) => {
    const previous = spec.slides[index - 1];
    if (slide.title.length > 72) {
      diagnostics.push(warning(
        "long-slide-title",
        "This slide title is likely to wrap across more than two lines.",
        index
      ));
    }
    if (previous?.layout === "section" && slide.layout === "section") {
      diagnostics.push(warning(
        "consecutive-sections",
        "Two section slides in a row leave an empty beat in the narrative.",
        index
      ));
    }
    if (slide.layout === "bullets") {
      if (slide.items.length >= 7) {
        diagnostics.push(warning(
          "dense-bullets",
          "This slide is at the bullet ceiling; split the argument across two slides.",
          index
        ));
      }
      if (slide.items.some((item) => item.length > 140)) {
        diagnostics.push(warning(
          "long-bullet",
          "A bullet is long enough to wrap poorly on a 16:9 frame; shorten it.",
          index
        ));
      }
    }
    if (slide.layout === "metrics" && slide.metrics.length >= 5) {
      diagnostics.push(warning(
        "dense-metrics",
        "Five or six KPI cards will feel cramped; keep four or fewer when possible.",
        index
      ));
    }
    if (slide.layout === "table") {
      if (slide.headers.length >= 7) {
        diagnostics.push(warning(
          "wide-table",
          "This table is close to the slide-width limit; drop or combine columns.",
          index
        ));
      }
      if (slide.rows.length >= 10) {
        diagnostics.push(warning(
          "long-table",
          "This table is near the row ceiling and will feel dense on one slide.",
          index
        ));
      }
      const longestCell = Math.max(
        ...slide.headers.map((value) => value.length),
        ...slide.rows.flat().map((value) => value.length)
      );
      if (longestCell > 80) {
        diagnostics.push(warning(
          "dense-table-cell",
          "A table cell contains dense prose; move it to a bullets slide.",
          index
        ));
      }
    }
    if (slide.layout === "chart" && slide.labels.length >= 10) {
      diagnostics.push(warning(
        "dense-chart",
        "This chart has many category labels; confirm readability in the slide preview.",
        index
      ));
    }
    if (slide.layout === "image" && !slide.caption) {
      diagnostics.push(warning(
        "uncaptioned-image",
        "This image slide has no caption; add one so the visual has a claim.",
        index
      ));
    }
    if (slide.layout === "closer" && !slide.next_step && slide.items.length === 0) {
      diagnostics.push(warning(
        "empty-closer",
        "The closer slide should name a next step or a short action list.",
        index
      ));
    }
  });

  return {
    status: diagnostics.length > 0 ? "attention" : "ready",
    slide_count: spec.slides.length,
    diagnostic_count: diagnostics.length,
    diagnostics: diagnostics.slice(0, 20)
  };
}

function warning(code, message, slideIndex = null) {
  return {
    severity: "warning",
    code,
    message,
    ...(slideIndex == null ? {} : { slide_index: slideIndex })
  };
}
