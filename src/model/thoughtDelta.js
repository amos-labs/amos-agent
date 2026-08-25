export function normalizeThoughtText(value) {
  return String(value || "").replace(/[`*_~]/g, "").replace(/\s+/g, " ").trim();
}

function isPrefixGrowth(previous, next) {
  const p = normalizeThoughtText(previous);
  const n = normalizeThoughtText(next);
  if (!p || !n) return false;
  return n.startsWith(p) || p.startsWith(n);
}

function pickLongerRaw(previous, next) {
  return normalizeThoughtText(next).length >= normalizeThoughtText(previous).length
    ? next
    : previous;
}

export function mergeThoughtDelta(previous, delta) {
  const prev = String(previous || "");
  const next = String(delta || "");
  if (!next) return prev;
  if (!prev) return next;
  const p = normalizeThoughtText(prev);
  const n = normalizeThoughtText(next);
  if (!n) return prev + next;
  if (n.startsWith(p)) return next;
  if (p.startsWith(n)) return prev;
  if (n.length > p.length && n.includes(p)) return next;
  if (n.length >= 12 && p.includes(n)) return prev;

  const prevLines = prev.replace(/\r/g, "").split("\n");
  const nextLines = next.replace(/\r/g, "").split("\n");
  const last = prevLines[prevLines.length - 1] || "";
  const firstNext = nextLines[0] || "";
  if (last && firstNext && isPrefixGrowth(last, firstNext)) {
    prevLines[prevLines.length - 1] = pickLongerRaw(last, firstNext);
    if (nextLines.length > 1) prevLines.push(...nextLines.slice(1));
    return prevLines.join("\n");
  }

  if (prev.endsWith("\n") || next.startsWith("\n")) return `${prev.replace(/\n+$/, "")}\n${next.replace(/^\n+/, "")}`;
  return prev + next;
}

export function collapseThoughtStream(text) {
  const folded = [];
  for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (folded.length && folded[folded.length - 1] !== "") folded.push("");
      continue;
    }
    const last = folded[folded.length - 1];
    if (last && isPrefixGrowth(last, trimmed)) {
      folded[folded.length - 1] = pickLongerRaw(last, trimmed);
      continue;
    }
    folded.push(trimmed);
  }

  if (folded.length === 0) return "";
  const opening = normalizeThoughtText(folded[0]);
  let start = 0;
  if (opening) {
    for (let index = 1; index < folded.length; index += 1) {
      if (normalizeThoughtText(folded[index]) === opening) start = index;
    }
  }
  return folded.slice(start).join("\n").trim();
}
