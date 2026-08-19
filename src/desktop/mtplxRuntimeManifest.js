export const MTPLX_RUNTIME_RELEASE = Object.freeze({
  version: "2.8.3",
  license: "Apache-2.0",
  homepage: "https://github.com/youssofal/mtplx"
});

export const MTPLX_QWEN38_MODEL_ID = "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M";
export const MTPLX_SERVED_MODEL_ID = "amos-local-qwen38-mtplx";

export const MTPLX_QWEN38_QUALIFICATION = Object.freeze({
  status: "qualified",
  suite: "amos-local-qualification-v4",
  score: 35,
  maximum: 35,
  repetitions: 3,
  evaluatedAt: "2026-08-19T15:36:46.741Z",
  hardware: "Apple M1 Max, 64 GB unified memory",
  runtimeVersion: MTPLX_RUNTIME_RELEASE.version,
  modelProfile: "qwen38-mtplx-fp16",
  reasoningEffort: "none",
  toolSchemaVersion: "sha256:7d91bd2ef31f4e9a2c21bb3e7ee05ce678208849ff8271c5f3c159cff194073d",
  averageWallSeconds: 617.666,
  averageTokensPerSecond: 9.009,
  reportSha256: Object.freeze([
    "9f48bc0a3dd9e4988c1bb28f8a1078e2b19c782244c96372393e74dea839a3a1",
    "74f52c4eb4679151c62db5f74074804d67df7300a2f6111a44561160ecac06aa",
    "454216d933190e85097b3161ce828752a2930e2114ebd7466ad08808c9a8f992"
  ])
});

const MODEL_PROFILES = Object.freeze({
  legacyAppleSilicon: Object.freeze({
    id: "qwen38-mtplx-fp16",
    repository: "Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed-FP16",
    revision: "main",
    runtimeManifestSha256: "b088d813b7d4eae5e9b814dbe7e56144dd588507cf250122d121658e5af62ea9",
    conversionManifestSha256: "4c2bf56ddd3569d6cbbc76a8e4bda0b6ebf39df9b529adda3e84721235b16aae",
    precision: "4-bit-dynamic-fp16",
    minimumMemoryGb: 32,
    recommendedMemoryGb: 64,
    mtpDepth: 2
  }),
  modernAppleSilicon: Object.freeze({
    id: "qwen38-mtplx-bf16",
    repository: "Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed",
    revision: "main",
    precision: "4-bit-dynamic-bf16",
    minimumMemoryGb: 32,
    recommendedMemoryGb: 64,
    mtpDepth: 2
  })
});

export function mtplxModelProfile({ platform = process.platform, arch = process.arch, cpuModel = "" } = {}) {
  if (platform !== "darwin" || arch !== "arm64") return null;
  // The FP16-tuned artifact targets M1/M2. Later Apple chips have native BF16
  // throughput and should use the parent artifact unless explicitly overridden.
  return /Apple M(?:1|2)\b/i.test(String(cpuModel || ""))
    ? MODEL_PROFILES.legacyAppleSilicon
    : MODEL_PROFILES.modernAppleSilicon;
}

export function mtplxArtifactDirectoryName(repository) {
  return String(repository || "").trim().replaceAll("/", "--");
}
