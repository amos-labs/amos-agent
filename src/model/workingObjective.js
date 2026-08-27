const MAX_OBJECTIVE_CHARS = 6_000;

export function selectWorkingObjective(current, next) {
  const incoming = String(next || "").trim();
  const existing = String(current || "").trim();
  if (!incoming) return existing;
  if (!existing) return incoming.slice(0, MAX_OBJECTIVE_CHARS);
  // A longer user statement is new work. Short follow-ups ("try again")
  // do not replace a more specific job. The first chat message is not special.
  if (incoming.length > existing.length) return incoming.slice(0, MAX_OBJECTIVE_CHARS);
  return existing;
}

export function userMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map((item) => {
    if (item?.type === "text") return String(item.text || "");
    return "";
  }).join("\n");
}
