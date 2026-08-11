export const MODEL_EVIDENCE = Symbol("amos.model-evidence");

export function attachModelEvidence(result, evidence) {
  if (!result || typeof result !== "object" || !Array.isArray(evidence) || evidence.length === 0) {
    return result;
  }
  Object.defineProperty(result, MODEL_EVIDENCE, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: evidence.map(normalizeEvidence)
  });
  return result;
}

export function takeModelEvidence(result) {
  if (!result || typeof result !== "object") return [];
  const evidence = Array.isArray(result[MODEL_EVIDENCE]) ? result[MODEL_EVIDENCE] : [];
  delete result[MODEL_EVIDENCE];
  return evidence.map(normalizeEvidence);
}

function normalizeEvidence(input) {
  if (String(input?.type || "") !== "image_url") {
    throw new Error("AMOS model evidence must be a bounded image");
  }
  const imageUrl = typeof input.image_url === "string"
    ? input.image_url
    : input.image_url?.url;
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(imageUrl || ""))) {
    throw new Error("AMOS model image evidence must be an inline PNG, JPEG, or WebP image");
  }
  if (imageUrl.length > 12 * 1024 * 1024) {
    throw new Error("AMOS model image evidence exceeds its transient safety limit");
  }
  return {
    type: "image_url",
    image_url: {
      url: imageUrl,
      detail: ["low", "high", "auto"].includes(input.image_url?.detail)
        ? input.image_url.detail
        : "auto"
    }
  };
}
