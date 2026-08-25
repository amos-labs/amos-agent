export function normalizeThoughtText(value) {
  return String(value || "").replace(/[`*_~]/g, "").replace(/\s+/g, " ").trim();
}

export function mergeThoughtDelta(previous, delta) {
  const prev = String(previous || "");
  const next = String(delta || "");
  if (!next) return prev;
  if (!prev) return next;
  const p = normalizeThoughtText(prev);
  const n = normalizeThoughtText(next);
  if (!n) return prev + next;
  if (n.startsWith(p) || p.startsWith(n)) {
    return n.length >= p.length ? next : prev;
  }
  return prev + next;
}

export function collapseThoughtStream(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  return lines.reduce((merged, line) => mergeThoughtDelta(merged, line), "");
}
