import { normalizeDocumentSpec } from "./documentSpec.js";

const PAGE_CAPACITY = Object.freeze({
  business: 52,
  compact: 62,
  proposal: 48
});

export function analyzeDocumentLayout(input) {
  const spec = normalizeDocumentSpec(input);
  const diagnostics = [];

  if (spec.title.length > 90) {
    diagnostics.push(warning(
      "long-title",
      "The title is likely to wrap across several lines; shorten it or use the compact style."
    ));
  }

  spec.blocks.forEach((block, index) => {
    const previous = spec.blocks[index - 1];
    const next = spec.blocks[index + 1];
    if (block.type === "page_break") {
      if (!previous || !next || previous.type === "page_break" || next.type === "page_break") {
        diagnostics.push(warning(
          "sparse-page-break",
          "This page break may create an empty or nearly empty page.",
          index
        ));
      }
      if (previous?.type === "heading") {
        diagnostics.push(warning(
          "orphan-heading",
          "A heading immediately before a page break will be separated from its content.",
          index - 1
        ));
      }
      return;
    }

    if (block.type === "paragraph") {
      if (block.text.length > 3_500) {
        diagnostics.push(warning(
          "dense-paragraph",
          "This paragraph is unusually long; split it for more reliable pagination and readability.",
          index
        ));
      }
      if (longestToken(block.text) > 80) {
        diagnostics.push(warning(
          "unbroken-text",
          "This paragraph contains a very long unbroken value that may wrap poorly.",
          index
        ));
      }
    }

    if (block.type === "table") {
      if (block.headers.length >= 7) {
        diagnostics.push(warning(
          "wide-table",
          "This table is close to the page-width limit; shorten columns or use the compact style.",
          index
        ));
      }
      if (block.rows.length > 40) {
        diagnostics.push(warning(
          "long-table",
          "This table spans many rows and will continue across pages with repeated headers.",
          index
        ));
      }
      const longestCell = Math.max(
        ...block.headers.map((value) => value.length),
        ...block.rows.flat().map((value) => value.length)
      );
      if (longestCell > 300) {
        diagnostics.push(warning(
          "dense-table-cell",
          "A table cell contains dense prose; move it into a paragraph or shorten it.",
          index
        ));
      }
    }

    if (block.type === "image" && block.width_percent < 45) {
      diagnostics.push(warning(
        "small-image",
        "This image may be difficult to read at the selected width; confirm the rendered page preview.",
        index
      ));
    }

    if (block.type === "chart" && block.labels.length > 12) {
      diagnostics.push(warning(
        "dense-chart",
        "This chart has many category labels; confirm label readability in the rendered page preview.",
        index
      ));
    }
  });

  const estimatedPages = estimatePages(spec);
  return {
    status: diagnostics.length > 0 ? "attention" : "ready",
    estimated_pages: estimatedPages,
    diagnostic_count: diagnostics.length,
    diagnostics: diagnostics.slice(0, 20)
  };
}

function estimatePages(spec) {
  const capacity = PAGE_CAPACITY[spec.style] || PAGE_CAPACITY.business;
  const sections = [[]];
  for (const block of spec.blocks) {
    if (block.type === "page_break") sections.push([]);
    else sections.at(-1).push(block);
  }
  return sections.reduce((pages, blocks) => {
    const units = 14 + blocks.reduce((sum, block) => sum + layoutUnits(block), 0);
    return pages + Math.max(1, Math.ceil(units / capacity));
  }, 0);
}

function layoutUnits(block) {
  if (block.type === "heading") return [7, 5, 4][block.level - 1];
  if (block.type === "paragraph") return Math.max(3, Math.ceil(block.text.length / 115));
  if (block.type === "list") {
    return block.items.reduce((sum, item) => sum + Math.max(2, Math.ceil(item.length / 100)), 0);
  }
  if (block.type === "table") {
    return 5 + block.rows.reduce((sum, row) => {
      const longest = Math.max(...row.map((cell) => cell.length));
      return sum + Math.max(3, Math.ceil(longest / 80));
    }, 0);
  }
  if (block.type === "callout") return 6 + Math.ceil(block.text.length / 120);
  if (block.type === "image") return 28;
  if (block.type === "chart") return 34;
  if (block.type === "sources") return 4 + (block.sources.length * 2);
  return 0;
}

function longestToken(value) {
  return String(value).split(/\s+/).reduce((longest, token) => Math.max(longest, token.length), 0);
}

function warning(code, message, blockIndex = null) {
  return {
    severity: "warning",
    code,
    message,
    ...(blockIndex == null ? {} : { block_index: blockIndex })
  };
}
