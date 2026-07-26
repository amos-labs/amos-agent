const SAFE_LINK_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

export function safeExternalUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function parseMarkdown(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```([A-Za-z0-9_+-]*)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1], text: code.join("\n") });
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2])
      });
      index += 1;
      continue;
    }

    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", children: parseMarkdown(quoted.join("\n")) });
      continue;
    }

    const listMatch = matchListItem(line);
    if (listMatch) {
      const ordered = listMatch.ordered;
      const start = listMatch.start;
      const items = [];
      while (index < lines.length) {
        const item = matchListItem(lines[index]);
        if (!item || item.ordered !== ordered) break;
        const continuation = [item.text];
        index += 1;
        while (
          index < lines.length &&
          lines[index].trim() &&
          !matchListItem(lines[index]) &&
          !isBlockStart(lines, index)
        ) {
          continuation.push(lines[index].trim());
          index += 1;
        }
        items.push(parseInline(continuation.join(" ")));
      }
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }

    if (isTableHeader(lines, index)) {
      const headers = splitTableRow(lines[index]).map(parseInline);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]).map(parseInline));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

export function parseInline(source) {
  const input = String(source ?? "");
  const nodes = [];
  let textBuffer = "";
  let index = 0;

  const flush = () => {
    if (!textBuffer) return;
    const previous = nodes.at(-1);
    if (previous?.type === "text") previous.value += textBuffer;
    else nodes.push({ type: "text", value: textBuffer });
    textBuffer = "";
  };

  while (index < input.length) {
    if (input[index] === "\\" && index + 1 < input.length) {
      textBuffer += input[index + 1];
      index += 2;
      continue;
    }

    const remaining = input.slice(index);
    const link = remaining.match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/);
    if (link) {
      const href = safeExternalUrl(link[2]);
      if (href) {
        flush();
        nodes.push({ type: "link", href, children: parseInline(link[1]) });
        index += link[0].length;
        continue;
      }
    }

    const autoLink = remaining.match(/^<(https?:\/\/[^ >]+|mailto:[^ >]+)>/i);
    if (autoLink) {
      const href = safeExternalUrl(autoLink[1]);
      if (href) {
        flush();
        nodes.push({ type: "link", href, children: [{ type: "text", value: autoLink[1] }] });
        index += autoLink[0].length;
        continue;
      }
    }

    const delimited = [
      { marker: "**", type: "strong" },
      { marker: "__", type: "strong" },
      { marker: "~~", type: "delete" },
      { marker: "`", type: "code" },
      { marker: "*", type: "emphasis" },
      { marker: "_", type: "emphasis" }
    ].find(({ marker }) => remaining.startsWith(marker));

    if (delimited) {
      const close = input.indexOf(delimited.marker, index + delimited.marker.length);
      if (close > index + delimited.marker.length) {
        flush();
        const value = input.slice(index + delimited.marker.length, close);
        nodes.push(
          delimited.type === "code"
            ? { type: "code", value }
            : { type: delimited.type, children: parseInline(value) }
        );
        index = close + delimited.marker.length;
        continue;
      }
    }

    textBuffer += input[index];
    index += 1;
  }

  flush();
  return nodes;
}

function matchListItem(line) {
  const unordered = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
  if (unordered) return { ordered: false, start: 1, text: unordered[1] };
  const ordered = line.match(/^\s{0,3}(\d+)[.)]\s+(.+)$/);
  if (ordered) return { ordered: true, start: Number(ordered[1]), text: ordered[2] };
  return null;
}

function isTableHeader(lines, index) {
  return (
    index + 1 < lines.length &&
    lines[index].includes("|") &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  );
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isBlockStart(lines, index) {
  const line = lines[index] || "";
  return (
    /^\s*```/.test(line) ||
    /^\s*#{1,6}\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line) ||
    Boolean(matchListItem(line)) ||
    isTableHeader(lines, index)
  );
}
