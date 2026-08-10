import { readFile, stat } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { normalizeDocumentSpec } from "./documentSpec.js";
import { assertSafeAgentPath, resolveWorkspacePath } from "../util/pathSafety.js";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 48 * 1024 * 1024;
const CHART_COLORS = Object.freeze([
  "1F4E78",
  "0F766E",
  "C25D2C",
  "6D5BD0",
  "B78A00",
  "3F7D4A"
]);

export async function resolveDocumentAssets(input, workspaceRoot) {
  const spec = normalizeDocumentSpec(input);
  const images = new Map();
  let totalBytes = 0;
  const imagePaths = [
    spec.brand?.logo_path,
    ...spec.blocks.filter((block) => block.type === "image").map((block) => block.path)
  ].filter(Boolean);
  for (const relativePath of new Set(imagePaths)) {
    const absolutePath = resolveWorkspacePath(workspaceRoot, relativePath, false);
    assertSafeAgentPath(absolutePath, workspaceRoot);
    const info = await stat(absolutePath);
    if (!info.isFile()) throw new Error(`${relativePath} is not a regular image file`);
    if (info.size > MAX_IMAGE_BYTES) throw new Error(`${relativePath} exceeds the 12 MB document-image limit`);
    totalBytes += info.size;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error("Document images exceed the 48 MB combined limit");
    const buffer = await readFile(absolutePath);
    const decoded = await loadImage(buffer).catch(() => null);
    if (!decoded?.width || !decoded?.height) throw new Error(`${relativePath} is not a readable PNG or JPEG image`);
    images.set(relativePath, {
      kind: "image",
      path: relativePath,
      data: buffer,
      type: /\.png$/i.test(relativePath) ? "png" : "jpg",
      width: decoded.width,
      height: decoded.height
    });
  }

  const charts = new Map();
  spec.blocks.forEach((block, index) => {
    if (block.type !== "chart") return;
    const data = renderChart(block, spec.brand);
    charts.set(index, {
      kind: "chart",
      data,
      type: "png",
      width: 1_200,
      height: 700
    });
  });

  return {
    images,
    charts,
    logo: spec.brand?.logo_path ? images.get(spec.brand.logo_path) : null
  };
}

function renderChart(block, brand) {
  const width = 1_200;
  const height = 700;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const primary = `#${brand?.primary_color || CHART_COLORS[0]}`;
  const colors = block.series.map((series, index) =>
    `#${series.color || (index === 0 ? primary.slice(1) : CHART_COLORS[index % CHART_COLORS.length])}`
  );
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#17202A";
  context.font = "bold 34px Arial";
  context.fillText(block.title, 76, 58, width - 152);

  const plot = { left: 100, top: 108, right: width - 56, bottom: height - 118 };
  const values = block.series.flatMap((series) => series.values);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  const yFor = (value) => plot.bottom - ((value - minimum) / span) * (plot.bottom - plot.top);

  context.strokeStyle = "#D5DCE5";
  context.fillStyle = "#5B6770";
  context.font = "20px Arial";
  context.lineWidth = 2;
  for (let step = 0; step <= 5; step += 1) {
    const value = minimum + (span * step / 5);
    const y = yFor(value);
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.fillText(formatChartValue(value), 10, y + 7, 82);
  }
  const baseline = yFor(0);
  context.strokeStyle = "#687588";
  context.beginPath();
  context.moveTo(plot.left, baseline);
  context.lineTo(plot.right, baseline);
  context.stroke();

  const groupWidth = (plot.right - plot.left) / block.labels.length;
  if (block.chart_type === "bar") {
    const barWidth = Math.max(8, Math.min(54, (groupWidth * 0.74) / block.series.length));
    block.series.forEach((series, seriesIndex) => {
      context.fillStyle = colors[seriesIndex];
      series.values.forEach((value, valueIndex) => {
        const center = plot.left + (valueIndex + 0.5) * groupWidth;
        const x = center - ((block.series.length * barWidth) / 2) + (seriesIndex * barWidth);
        const y = yFor(value);
        context.fillRect(x + 2, Math.min(y, baseline), barWidth - 4, Math.max(2, Math.abs(baseline - y)));
      });
    });
  } else {
    block.series.forEach((series, seriesIndex) => {
      context.strokeStyle = colors[seriesIndex];
      context.fillStyle = colors[seriesIndex];
      context.lineWidth = 5;
      context.beginPath();
      series.values.forEach((value, valueIndex) => {
        const x = plot.left + (valueIndex + 0.5) * groupWidth;
        const y = yFor(value);
        if (valueIndex === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      series.values.forEach((value, valueIndex) => {
        const x = plot.left + (valueIndex + 0.5) * groupWidth;
        const y = yFor(value);
        context.beginPath();
        context.arc(x, y, 7, 0, Math.PI * 2);
        context.fill();
      });
    });
  }

  context.fillStyle = "#526071";
  context.font = "18px Arial";
  block.labels.forEach((label, index) => {
    const x = plot.left + (index + 0.5) * groupWidth;
    const clipped = label.length > 15 ? `${label.slice(0, 14)}…` : label;
    context.save();
    context.translate(x, plot.bottom + 28);
    context.rotate(block.labels.length > 8 ? -0.55 : 0);
    context.textAlign = block.labels.length > 8 ? "right" : "center";
    context.fillText(clipped, 0, 0, Math.max(72, groupWidth - 8));
    context.restore();
  });

  let legendX = plot.left;
  const legendY = height - 36;
  block.series.forEach((series, index) => {
    context.fillStyle = colors[index];
    context.fillRect(legendX, legendY - 15, 22, 14);
    context.fillStyle = "#364152";
    context.font = "18px Arial";
    context.fillText(series.name, legendX + 30, legendY, 220);
    legendX += Math.min(260, 60 + (series.name.length * 11));
  });
  return canvas.toBuffer("image/png");
}

function formatChartValue(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded) >= 1_000_000) return `${Math.round(rounded / 1_000_000)}M`;
  if (Math.abs(rounded) >= 1_000) return `${Math.round(rounded / 1_000)}K`;
  return String(rounded);
}
