import { documentText, normalizeDocumentSpec } from "../artifacts/documentSpec.js";

const MAX_PREVIEW_BLOCKS = 60;
const MAX_PREVIEW_CHARACTERS = 50_000;

export function documentArtifactCanvas({ document, artifacts, layout, generatedAt }) {
  const spec = normalizeDocumentSpec(document);
  const preview = boundedPreview(spec);
  const timestamp = generatedAt || new Date().toISOString();
  const references = artifacts.map((artifact) => ({
    type: artifact.format,
    id: artifact.sha256,
    label: artifact.path,
    observed_at: timestamp
  }));
  return {
    version: "1",
    title: spec.title,
    subtitle: `Verified ${artifacts.map((artifact) => artifact.format.toUpperCase()).join(" + ")} artifact preview`,
    generated_at: timestamp,
    state: {
      kind: layout.status === "attention" ? "partial" : "ready",
      message: layout.status === "attention"
        ? `${layout.diagnostic_count} layout ${layout.diagnostic_count === 1 ? "item needs" : "items need"} review.`
        : "The document passed deterministic layout checks."
    },
    source: {
      kind: "local",
      label: "AMOS Desktop verified artifact",
      refreshed_at: timestamp,
      references
    },
    blocks: [{
      id: "document-artifact-preview",
      type: "document",
      title: "Document preview",
      document: preview.document,
      artifacts,
      diagnostics: layout.diagnostics,
      estimated_pages: layout.estimated_pages,
      preview_truncated: preview.truncated,
      total_blocks: spec.blocks.length
    }]
  };
}

function boundedPreview(spec) {
  const blocks = [];
  let characters = spec.title.length + spec.subtitle.length + spec.author.length;
  for (const block of spec.blocks) {
    if (blocks.length >= MAX_PREVIEW_BLOCKS) break;
    const blockCharacters = documentText({ blocks: [block] }).length;
    if (blocks.length > 0 && characters + blockCharacters > MAX_PREVIEW_CHARACTERS) break;
    blocks.push(block);
    characters += blockCharacters;
  }
  return {
    document: { ...spec, blocks },
    truncated: blocks.length < spec.blocks.length
  };
}
