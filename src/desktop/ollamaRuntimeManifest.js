export const OLLAMA_RUNTIME_RELEASE = Object.freeze({
  version: "0.32.5",
  license: "MIT",
  source: "https://github.com/ollama/ollama",
  assets: Object.freeze({
    darwin: Object.freeze({
      archive: "ollama-darwin.tgz",
      sha256: "5789dd037a86adb328c72c11fc45e6c558452d07e5b50814a8bdb7b0fbdbcd81",
      binary: "ollama"
    }),
    "win32-x64": Object.freeze({
      archive: "ollama-windows-amd64.zip",
      sha256: "7c941ae084569d298062d29f8139163a3187c76dbca0479c70d085e78fd8c7bb",
      binary: "ollama.exe"
    })
  })
});

const WINDOWS_PORTABLE_EXCLUDES = Object.freeze([
  "lib/ollama/cuda_v12",
  "lib/ollama/cuda_v13"
]);

export function ollamaRuntimeProfile(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") {
    return Object.freeze({
      id: "portable",
      description: "CPU and Vulkan backends for the bundled router and local models",
      excludedDirectories: WINDOWS_PORTABLE_EXCLUDES
    });
  }
  return Object.freeze({
    id: "full",
    description: "Official platform runtime",
    excludedDirectories: Object.freeze([])
  });
}

export function ollamaRuntimeAsset(platform = process.platform, arch = process.arch) {
  const key = platform === "darwin" ? "darwin" : `${platform}-${arch}`;
  const asset = OLLAMA_RUNTIME_RELEASE.assets[key];
  if (!asset) {
    throw new Error(`AMOS Local does not have a runtime package for ${platform}-${arch}`);
  }
  return {
    ...asset,
    platform,
    arch,
    url: `${OLLAMA_RUNTIME_RELEASE.source}/releases/download/v${OLLAMA_RUNTIME_RELEASE.version}/${asset.archive}`
  };
}
