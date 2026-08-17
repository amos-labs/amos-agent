import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "./napiCanvas.js";
import {
  SLIDE_HEIGHT_IN,
  SLIDE_WIDTH_IN,
  layoutPresentationSlides
} from "./presentationLayout.js";
import { normalizePresentationSpec } from "./presentationSpec.js";

export const MAX_PRESENTATION_PREVIEW_SLIDES = 16;
const PREVIEW_WIDTH = 960;
const POINTS_PER_INCH = 72;

export async function renderPresentationPreviewSlides(input, assets, {
  maxSlides = MAX_PRESENTATION_PREVIEW_SLIDES
} = {}) {
  const spec = normalizePresentationSpec(input);
  const laidOut = layoutPresentationSlides(spec, assets);
  const selected = laidOut.slice(0, maxSlides);
  const slides = [];
  for (const slide of selected) {
    const rendered = await renderSlidePng(slide);
    slides.push({
      slide: slide.number,
      title: slide.title,
      layout: slide.layout,
      width: rendered.width,
      height: rendered.height,
      bytes: rendered.data.length,
      sha256: createHash("sha256").update(rendered.data).digest("hex"),
      data: rendered.data
    });
  }
  return {
    slideCount: laidOut.length,
    truncated: laidOut.length > selected.length,
    slides
  };
}

async function renderSlidePng(slide) {
  const scale = PREVIEW_WIDTH / SLIDE_WIDTH_IN;
  const width = Math.round(SLIDE_WIDTH_IN * scale);
  const height = Math.round(SLIDE_HEIGHT_IN * scale);
  const canvas = await createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, width, height);
  context.textBaseline = "top";

  for (const primitive of slide.primitives) {
    if (primitive.kind === "rect") {
      drawRect(context, primitive, scale);
    } else if (primitive.kind === "text") {
      drawText(context, primitive, scale);
    } else if (primitive.kind === "table") {
      drawTable(context, primitive, scale);
    } else if (primitive.kind === "picture") {
      await drawPicture(context, primitive, scale);
    }
  }

  return { width, height, data: canvas.toBuffer("image/png") };
}

function drawRect(context, box, scale) {
  context.fillStyle = hex(box.fill);
  context.fillRect(px(box.x, scale), px(box.y, scale), px(box.w, scale), px(box.h, scale));
  if (box.line) {
    context.strokeStyle = hex(box.line);
    context.lineWidth = Math.max(1, scale * 0.015);
    context.strokeRect(px(box.x, scale), px(box.y, scale), px(box.w, scale), px(box.h, scale));
  }
}

function drawText(context, box, scale) {
  const paragraphs = box.paragraphs || [{ text: box.text || "", bullet: box.bullet, size: box.size }];
  const width = px(box.w, scale);
  const height = px(box.h, scale);
  const lines = [];
  for (const paragraph of paragraphs) {
    const size = fontPixels(paragraph.size || box.size || 16, scale);
    context.font = fontFace(Boolean(paragraph.bold ?? box.bold), size);
    const wrapped = wrapLines(context, paragraph.text || "", width - (paragraph.bullet ? size * 1.1 : 0));
    wrapped.forEach((text, lineIndex) => {
      lines.push({
        text,
        bullet: paragraph.bullet && lineIndex === 0,
        size,
        bold: Boolean(paragraph.bold ?? box.bold),
        color: paragraph.color || box.color || "1F2937",
        align: paragraph.align || box.align || "l"
      });
    });
  }

  const lineHeight = (size) => size * 1.22;
  const contentHeight = lines.reduce((sum, line) => sum + lineHeight(line.size), 0);
  let y = px(box.y, scale);
  if (box.anchor === "b") y += Math.max(0, height - contentHeight);
  if (box.anchor === "ctr") y += Math.max(0, (height - contentHeight) / 2);

  for (const line of lines) {
    context.font = fontFace(line.bold, line.size);
    context.fillStyle = hex(line.color);
    const textX = px(box.x, scale);
    const indent = line.bullet ? line.size * 1.1 : 0;
    if (line.bullet) {
      context.fillText("•", textX, y, width);
    }
    const align = line.align;
    if (align === "ctr") {
      context.textAlign = "center";
      context.fillText(line.text, textX + (width / 2), y, width);
    } else if (align === "r") {
      context.textAlign = "right";
      context.fillText(line.text, textX + width, y, width);
    } else {
      context.textAlign = "left";
      context.fillText(line.text, textX + indent, y, Math.max(8, width - indent));
    }
    context.textAlign = "left";
    y += lineHeight(line.size);
    if (y > px(box.y, scale) + height) break;
  }
}

function drawTable(context, box, scale) {
  const columns = Math.max(1, box.headers.length);
  const rows = [box.headers, ...box.rows];
  const width = px(box.w, scale);
  const height = px(box.h, scale);
  const x = px(box.x, scale);
  const y = px(box.y, scale);
  const columnWidth = width / columns;
  const rowHeight = height / rows.length;
  const fontSize = fontPixels(12, scale);

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const cellX = x + (columnIndex * columnWidth);
      const cellY = y + (rowIndex * rowHeight);
      context.fillStyle = hex(rowIndex === 0 ? box.theme.accent : box.theme.surface);
      context.fillRect(cellX, cellY, columnWidth, rowHeight);
      context.strokeStyle = hex(box.theme.line);
      context.lineWidth = Math.max(1, scale * 0.012);
      context.strokeRect(cellX, cellY, columnWidth, rowHeight);
      context.font = fontFace(rowIndex === 0, fontSize);
      context.fillStyle = hex(rowIndex === 0 ? "FFFFFF" : box.theme.text);
      context.textAlign = "left";
      context.fillText(String(cell || " "), cellX + 8, cellY + 8, columnWidth - 16);
    });
  });
}

async function drawPicture(context, box, scale) {
  const image = await loadImage(box.asset.data);
  context.drawImage(
    image,
    px(box.x, scale),
    px(box.y, scale),
    px(box.w, scale),
    px(box.h, scale)
  );
}

function wrapLines(context, value, maxWidth) {
  const text = String(value || "");
  if (!text) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const next = `${current} ${word}`;
    if (context.measureText(next).width <= maxWidth) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function fontFace(bold, size) {
  return `${bold ? "700" : "400"} ${Math.max(8, Math.round(size))}px Arial`;
}

function fontPixels(points, scale) {
  return (Number(points) / POINTS_PER_INCH) * scale;
}

function px(inches, scale) {
  return Number(inches) * scale;
}

function hex(value) {
  return `#${String(value || "1F2937").replace(/^#/, "")}`;
}
