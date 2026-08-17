const MAX_PREVIEW_SLIDES = 16;

export function presentationArtifactCanvas({
  presentation,
  artifact,
  layout,
  verification,
  slidePreview,
  generatedAt
}) {
  const timestamp = generatedAt || new Date().toISOString();
  const slides = (slidePreview?.slides || []).slice(0, MAX_PREVIEW_SLIDES);
  return {
    version: "1",
    title: presentation.title,
    subtitle: "Verified PowerPoint · AMOS slide preview",
    generated_at: timestamp,
    state: {
      kind: layout.status === "attention" || verification.verified !== true ? "partial" : "ready",
      message: verification.verified !== true
        ? "The deck needs attention before use."
        : layout.status === "attention"
          ? `${layout.diagnostic_count} layout ${layout.diagnostic_count === 1 ? "item needs" : "items need"} review.`
          : "The deck reopened successfully and the slide preview was generated from the same AMOS layout."
    },
    source: {
      kind: "local",
      label: "AMOS Desktop verified presentation engine",
      refreshed_at: timestamp,
      references: [{
        type: "pptx",
        id: artifact.sha256,
        label: artifact.path,
        observed_at: timestamp
      }]
    },
    blocks: [{
      id: "presentation-artifact-preview",
      type: "presentation",
      title: "Presentation preview",
      artifact,
      verification: {
        verified: verification.verified === true,
        slide_count: verification.slideCount ?? presentation.slides.length,
        extracted_characters: verification.extractedCharacters ?? 0,
        titles: verification.titles || presentation.slides.map((slide) => slide.title)
      },
      diagnostics: layout.diagnostics || [],
      slide_preview: {
        slide_count: slidePreview?.slide_count || slidePreview?.slideCount || presentation.slides.length,
        truncated: slidePreview?.truncated === true || slides.length < presentation.slides.length,
        slides
      },
      kind: presentation.kind,
      style: presentation.style,
      slide_count: presentation.slides.length
    }]
  };
}
