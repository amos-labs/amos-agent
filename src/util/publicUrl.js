import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain"]);

export function parsePublicHttpUrl(value) {
  const url = value instanceof URL ? new URL(value.href) : new URL(String(value || ""));
  assertPublicUrlSyntax(url);
  return url;
}

export function assertPublicUrlSyntax(url) {
  if (!(url instanceof URL)) throw new Error("A valid URL is required");
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || LOCAL_HOSTS.has(hostname) || hostname.endsWith(".local")) {
    throw new Error("Private or local network URLs are not allowed");
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) {
    throw new Error("Private or local network URLs are not allowed");
  }
  return url;
}

export async function assertPublicUrl(url, { lookupImpl = lookup } = {}) {
  assertPublicUrlSyntax(url);
  const hostname = url.hostname.toLowerCase();
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookupImpl(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Private or local network URLs are not allowed");
  }
  return url;
}

export function isPrivateAddress(address) {
  const lower = String(address || "").toLowerCase();
  if (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  ) {
    return true;
  }
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped || (isIP(lower) === 4 ? lower : null);
  if (!ipv4) return false;
  const [a, b] = ipv4.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
