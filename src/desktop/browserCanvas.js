export function browserSessionCanvas(input, { generatedAt = new Date().toISOString() } = {}) {
  const closed = input.status === "closed";
  const download = browserDownload(input.downloaded_attachment);
  const references = input.url && !closed
    ? [{ type: "web_page", id: input.page_revision, label: input.url, observed_at: generatedAt }]
    : [];
  return {
    version: "1",
    title: input.title || "AMOS browser",
    subtitle: closed
      ? "This task-bound browser session is closed."
      : "JavaScript page in an isolated task-bound AMOS Desktop browser session",
    generated_at: generatedAt,
    state: {
      kind: closed ? "stale" : input.status === "error" ? "error" : "ready",
      message: closed
        ? "The page, semantic references, and screenshot capability were revoked."
        : input.error || "The browser observation is current for this page revision."
    },
    source: {
      kind: "local",
      label: "AMOS Desktop governed semantic browser",
      refreshed_at: generatedAt,
      references
    },
    blocks: [{
      id: `browser-${input.session_id}`,
      type: "browser",
      title: input.title || "Browser page",
      session_id: input.session_id,
      url: input.url || "https://example.invalid/",
      status: closed ? "closed" : input.status || "ready",
      page_revision: Math.max(0, Number(input.page_revision) || 0),
      frame_id: input.frame?.frame_id || "",
      viewport: input.frame
        ? { width: input.frame.width, height: input.frame.height }
        : { width: 1280, height: 800 },
      observed_at: input.observed_at || generatedAt,
      element_count: Math.max(0, Number(input.element_count) || 0),
      summary: input.summary || "",
      ...(download ? { download } : {}),
      takeover_active: !closed && input.takeover_active === true,
      interactive: !closed
    }]
  };
}

function browserDownload(input) {
  if (!input || typeof input !== "object") return null;
  const sha256 = String(input.sha256 || "").toLowerCase();
  const size = Number(input.size);
  if (
    !input.id ||
    !input.name ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 20 * 1024 * 1024
  ) return null;
  return {
    attachment_id: String(input.id).slice(0, 128),
    name: String(input.name).slice(0, 240),
    mime: String(input.mime || "application/octet-stream").slice(0, 200),
    size,
    sha256
  };
}
