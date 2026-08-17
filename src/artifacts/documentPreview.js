import { createHash } from "node:crypto";
import { createCanvas } from "./napiCanvas.js";

const MAX_PREVIEW_PAGES = 12;
const PREVIEW_WIDTH = 420;

export async function renderPdfPreviewPages(buffer, { maxPages = MAX_PREVIEW_PAGES } = {}) {
  ensureArrayBufferTransferToFixedLength();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: false,
    useSystemFonts: true,
    isEvalSupported: false
  });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pageCount, maxPages); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = PREVIEW_WIDTH / natural.width;
      const viewport = page.getViewport({ scale });
      const canvas = await createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const data = canvas.toBuffer("image/png");
      pages.push({
        page: pageNumber,
        width: canvas.width,
        height: canvas.height,
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        data
      });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return {
    pageCount,
    truncated: pageCount > pages.length,
    pages
  };
}

function ensureArrayBufferTransferToFixedLength() {
  if (typeof ArrayBuffer.prototype.transferToFixedLength === "function") return;
  Object.defineProperty(ArrayBuffer.prototype, "transferToFixedLength", {
    configurable: true,
    writable: true,
    value(newLength) {
      const length = Number(newLength);
      if (!Number.isInteger(length) || length < 0) {
        throw new RangeError("ArrayBuffer transfer length must be a non-negative integer");
      }
      const transferred = new ArrayBuffer(length);
      const source = new Uint8Array(this, 0, Math.min(this.byteLength, length));
      new Uint8Array(transferred).set(source);
      return transferred;
    }
  });
}
