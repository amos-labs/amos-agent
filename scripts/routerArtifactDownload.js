// GitHub release assets 302 to a signed CDN URL. The GitHub app host needs
// auth + octet-stream; the CDN must never see the bearer token. A 403 on the
// authenticated GitHub hop is retried without auth because Actions tokens
// can be rejected on public or cross-repo browser download URLs.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
const USER_AGENT = "AMOS-Desktop-release-builder/1";
const MAX_HOPS = 8;

export function isGitHubAppHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "github.com" || host === "api.github.com" || host.endsWith(".github.com");
}

export function isGitHubCdnHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "githubusercontent.com" ||
    host.endsWith(".githubusercontent.com") ||
    host === "githubassets.com" ||
    host.endsWith(".githubassets.com")
  );
}

export function parseGitHubReleaseDownloadUrl(url) {
  if (!isGitHubAppHost(url.hostname) || isGitHubCdnHost(url.hostname)) return null;
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, owner, repo, tag, file] = match;
  return { owner, repo, tag, file: decodeURIComponent(file) };
}

export function artifactRequestHeaders(url, token, { accept } = {}) {
  const headers = {
    "user-agent": USER_AGENT,
    accept: accept || "application/octet-stream"
  };
  if (token && isGitHubAppHost(url.hostname) && !isGitHubCdnHost(url.hostname)) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchRouterArtifact(urlValue, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const token = String(options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "").trim();
  const url = new URL(urlValue);
  if (url.protocol !== "https:") {
    throw new Error("AMOS_ROUTER_GGUF_URL must use HTTPS");
  }
  const release = parseGitHubReleaseDownloadUrl(url);
  if (release && token) {
    const viaApi = await fetchGitHubReleaseAsset(fetchImpl, release, token);
    if (viaApi) return viaApi;
  }
  return fetchWithRedirects(fetchImpl, url, token);
}

export async function downloadRouterArtifactToFile(urlValue, destinationPath, manifest, options = {}) {
  const response = await fetchRouterArtifact(urlValue, options);
  const contentLength = response.headers.get("content-length");
  const declaredSize = contentLength == null ? null : Number(contentLength);
  if (Number.isSafeInteger(declaredSize) && declaredSize !== manifest.gguf_size_bytes) {
    await discardBody(response);
    throw new Error(
      `Router artifact download size mismatch: expected ${manifest.gguf_size_bytes}, got ${declaredSize}`
    );
  }
  const temporary = `${destinationPath}.${process.pid}.download`;
  let bytes = 0;
  const hash = createHash("sha256");
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      async function* verify(sourceStream) {
        for await (const chunk of sourceStream) {
          bytes += chunk.length;
          if (bytes > manifest.gguf_size_bytes) {
            throw new Error("Router artifact download exceeded its signed size");
          }
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(temporary, { flags: "wx", mode: 0o600 })
    );
    if (bytes !== manifest.gguf_size_bytes || hash.digest("hex") !== manifest.gguf_sha256) {
      throw new Error("Router artifact download failed signed size or SHA-256 verification");
    }
    await rename(temporary, destinationPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function fetchGitHubReleaseAsset(fetchImpl, release, token) {
  const apiUrl = new URL(
    `https://api.github.com/repos/${release.owner}/${release.repo}/releases/tags/${encodeURIComponent(release.tag)}`
  );
  const meta = await fetchImpl(apiUrl, {
    headers: artifactRequestHeaders(apiUrl, token, { accept: "application/vnd.github+json" }),
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  });
  if (!meta.ok) {
    await discardBody(meta);
    return null;
  }
  let body;
  try {
    body = await meta.json();
  } catch {
    return null;
  }
  const asset = Array.isArray(body?.assets)
    ? body.assets.find((item) => item?.name === release.file && typeof item.url === "string")
    : null;
  if (!asset) return null;
  const assetUrl = new URL(asset.url);
  if (assetUrl.protocol !== "https:") return null;
  const first = await fetchImpl(assetUrl, {
    redirect: "manual",
    headers: artifactRequestHeaders(assetUrl, token, { accept: "application/octet-stream" }),
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  });
  return followArtifactResponse(fetchImpl, assetUrl, first, token);
}

async function fetchWithRedirects(fetchImpl, url, token) {
  const first = await fetchImpl(url, {
    redirect: "manual",
    headers: artifactRequestHeaders(url, token),
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  });
  return followArtifactResponse(fetchImpl, url, first, token);
}

async function followArtifactResponse(fetchImpl, startUrl, first, token) {
  let currentUrl = startUrl;
  let response = first;
  let usedAuth = Boolean(artifactRequestHeaders(currentUrl, token).authorization);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.protocol !== "https:") {
        await discardBody(response);
        throw new Error("Router artifact download redirected outside HTTPS");
      }
      await discardBody(response);
      currentUrl = nextUrl;
      response = await fetchImpl(currentUrl, {
        redirect: "manual",
        headers: artifactRequestHeaders(currentUrl, ""),
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      });
      usedAuth = false;
      continue;
    }
    if ((response.status === 401 || response.status === 403) && usedAuth) {
      await discardBody(response);
      response = await fetchImpl(currentUrl, {
        redirect: "manual",
        headers: artifactRequestHeaders(currentUrl, ""),
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      });
      usedAuth = false;
      continue;
    }
    if (!response.ok || !response.body) {
      const hostname = currentUrl.hostname;
      await discardBody(response);
      throw new Error(`Router artifact download failed with HTTP ${response.status} from ${hostname}`);
    }
    return response;
  }
  await discardBody(response);
  throw new Error(`Router artifact download exceeded redirect budget from ${startUrl.hostname}`);
}

async function discardBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // The previous hop's body is unused; ignoring cancel failures keeps download control flow intact.
  }
}
