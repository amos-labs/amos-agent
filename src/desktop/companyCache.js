import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature
} from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const COMPANY_CACHE_AUDIENCE = "amos-desktop-company-cache";
export const COMPANY_CACHE_FORMAT = "amos-company-cache";
export const COMPANY_CACHE_VERSION = "1";
export const COMPANY_CACHE_TOKEN_TYPE = "AMOS-COMPANY-CACHE+JWT";
export const DEFAULT_COMPANY_CACHE_TTL_SECONDS = 4 * 60 * 60;
export const MIN_COMPANY_CACHE_TTL_SECONDS = 15 * 60;
export const MAX_COMPANY_CACHE_TTL_SECONDS = 24 * 60 * 60;

const STORE_VERSION = 1;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_CHARS = 4 * 1024 * 1024;
const MAX_ENCRYPTED_RECORD_CHARS = 8 * 1024 * 1024;

export class CompanyCacheStore {
  constructor({ filePath, encrypt, decrypt, now = () => new Date() }) {
    if (!filePath) throw new Error("Company cache requires a storage path");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Company cache requires platform encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.now = now;
  }

  async write(grant) {
    const record = normalizeGrantRecord(grant);
    const encryptedRecord = this.encrypt(JSON.stringify(record));
    if (
      typeof encryptedRecord !== "string" ||
      encryptedRecord.length === 0 ||
      encryptedRecord.length > MAX_ENCRYPTED_RECORD_CHARS
    ) {
      throw new Error("Encrypted company cache exceeds the local storage limit");
    }
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(
      temporary,
      `${JSON.stringify({ version: STORE_VERSION, encryptedRecord }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
    return publicCompanyCacheStatus(record, this.now());
  }

  async status() {
    const record = await this.readRecord();
    if (!record) return missingCompanyCacheStatus();
    const claims = verifyCompanyCacheGrant({
      token: record.token,
      jwks: { keys: [record.jwk] },
      expectedIssuer: record.issuer,
      now: this.now(),
      allowExpired: true
    });
    return publicCompanyCacheStatus(
      normalizeGrantRecord({ token: record.token, jwk: record.jwk, claims }),
      this.now()
    );
  }

  async read({
    expectedIssuer,
    expectedIdentity = null,
    jwks = null,
    now = this.now()
  } = {}) {
    const record = await this.readRecord();
    if (!record) return null;
    const claims = verifyCompanyCacheGrant({
      token: record.token,
      jwks: jwks || { keys: [record.jwk] },
      expectedIssuer,
      expectedIdentity,
      now
    });
    return {
      token: record.token,
      jwk: record.jwk,
      claims,
      snapshot: claims.snapshot
    };
  }

  async clear() {
    await rm(this.filePath, { force: true });
  }

  async readRecord() {
    let value;
    try {
      value = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error(`Could not read the encrypted company cache: ${error.message}`);
    }
    if (
      value?.version !== STORE_VERSION ||
      typeof value.encryptedRecord !== "string" ||
      value.encryptedRecord.length === 0 ||
      value.encryptedRecord.length > MAX_ENCRYPTED_RECORD_CHARS
    ) {
      throw new Error("Unsupported or corrupted AMOS company cache");
    }
    try {
      return normalizeStoredRecord(JSON.parse(this.decrypt(value.encryptedRecord)));
    } catch (error) {
      throw new Error(`Could not decrypt the AMOS company cache: ${error.message}`);
    }
  }
}

export function verifyCompanyCacheGrant({
  token,
  jwks,
  expectedIssuer,
  expectedIdentity = null,
  now = new Date(),
  allowExpired = false
}) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    throw new Error("AMOS returned an invalid company-cache token");
  }
  const pieces = token.split(".");
  if (pieces.length !== 3 || pieces.some((piece) => !piece)) {
    throw new Error("AMOS returned a malformed company-cache token");
  }
  const header = decodeJsonSegment(pieces[0], "company-cache header");
  const claims = decodeJsonSegment(pieces[1], "company-cache claims");
  if (
    header.alg !== "EdDSA" ||
    header.typ !== COMPANY_CACHE_TOKEN_TYPE ||
    typeof header.kid !== "string" ||
    header.kid.length === 0 ||
    header.kid.length > 256
  ) {
    throw new Error("AMOS company cache uses an unsupported signing profile");
  }

  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const matching = keys.filter((key) => key?.kid === header.kid);
  if (matching.length !== 1) {
    throw new Error("AMOS company-cache signing key is not currently trusted");
  }
  const jwk = matching[0];
  if (
    jwk.kty !== "OKP" ||
    jwk.crv !== "Ed25519" ||
    jwk.alg !== "EdDSA" ||
    jwk.use !== "sig" ||
    typeof jwk.x !== "string"
  ) {
    throw new Error("AMOS company-cache signing key has an invalid profile");
  }
  let verified = false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    verified = verifySignature(
      null,
      Buffer.from(`${pieces[0]}.${pieces[1]}`, "ascii"),
      key,
      decodeBase64Url(pieces[2], "company-cache signature")
    );
  } catch {
    verified = false;
  }
  if (!verified) throw new Error("AMOS company-cache signature could not be verified");

  validateClaims(claims, { expectedIssuer, expectedIdentity, now, allowExpired });
  return claims;
}

export function publicCompanyCacheStatus(record, now = new Date()) {
  const expiresAt = new Date(record.expiresAt);
  const issuedAt = new Date(record.issuedAt);
  const expired = expiresAt.getTime() <= now.getTime();
  return {
    available: !expired,
    status: expired ? "expired" : "active",
    cacheId: record.cacheId,
    issuer: record.issuer,
    subjectId: record.subjectId,
    tenantId: record.tenantId,
    tenantSlug: record.tenantSlug,
    role: record.role,
    scopeCount: record.scopeCount,
    scopeFingerprint: record.scopeFingerprint,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    readOnly: true,
    credentialsIncluded: false,
    onlineRevalidationRequired: true
  };
}

export function missingCompanyCacheStatus() {
  return {
    available: false,
    status: "missing",
    cacheId: null,
    issuer: null,
    subjectId: null,
    tenantId: null,
    tenantSlug: null,
    role: null,
    scopeCount: 0,
    scopeFingerprint: null,
    issuedAt: null,
    expiresAt: null,
    readOnly: true,
    credentialsIncluded: false,
    onlineRevalidationRequired: true
  };
}

function validateClaims(claims, { expectedIssuer, expectedIdentity, now, allowExpired }) {
  if (
    claims?.cache_format !== COMPANY_CACHE_FORMAT ||
    claims?.cache_version !== COMPANY_CACHE_VERSION ||
    claims?.aud !== COMPANY_CACHE_AUDIENCE ||
    claims?.principal_type !== "user"
  ) {
    throw new Error("AMOS company cache has an invalid contract");
  }
  const issuer = normalizeIssuer(expectedIssuer);
  if (!issuer || !sameText(claims.iss, issuer)) {
    throw new Error("AMOS company cache belongs to a different server");
  }
  if (
    typeof claims.cache_id !== "string" ||
    typeof claims.sub !== "string" ||
    typeof claims.tenant_id !== "string" ||
    typeof claims.tenant_slug !== "string" ||
    typeof claims.role !== "string" ||
    !Array.isArray(claims.scopes) ||
    !claims.scopes.every((scope) => typeof scope === "string") ||
    !/^[a-f0-9]{64}$/i.test(String(claims.scope_fingerprint || "")) ||
    !claims.snapshot ||
    typeof claims.snapshot !== "object" ||
    Array.isArray(claims.snapshot)
  ) {
    throw new Error("AMOS company cache is missing required authority metadata");
  }
  const canonicalScopes = [...new Set(claims.scopes)].sort();
  if (JSON.stringify(canonicalScopes) !== JSON.stringify(claims.scopes)) {
    throw new Error("AMOS company cache has a non-canonical scope set");
  }
  const fingerprint = createHash("sha256")
    .update(claims.scopes.join("\0"), "utf8")
    .digest("hex");
  if (!sameText(fingerprint, claims.scope_fingerprint.toLowerCase())) {
    throw new Error("AMOS company-cache scope fingerprint does not match");
  }
  const iat = integerTimestamp(claims.iat, "issued-at");
  const nbf = integerTimestamp(claims.nbf, "not-before");
  const exp = integerTimestamp(claims.exp, "expiry");
  if (nbf !== iat || exp <= iat || exp - iat > MAX_COMPANY_CACHE_TTL_SECONDS) {
    throw new Error("AMOS company cache has an invalid validity window");
  }
  const nowSeconds = Math.floor(new Date(now).getTime() / 1000);
  if (!Number.isFinite(nowSeconds)) throw new Error("Could not evaluate company-cache time");
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS || nbf > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new Error("AMOS company cache is not valid yet");
  }
  if (!allowExpired && exp <= nowSeconds) {
    throw new Error("AMOS company cache has expired; reconnect to refresh it");
  }

  if (expectedIdentity) {
    const expectedSubject = String(
      expectedIdentity.sub || expectedIdentity.user?.id || ""
    );
    const expectedTenant = String(expectedIdentity.tenant_id || "");
    if (!expectedSubject || !expectedTenant || expectedIdentity.principal_type !== "user") {
      throw new Error("Current AMOS user identity cannot authorize an offline cache");
    }
    if (!sameText(claims.sub, expectedSubject) || !sameText(claims.tenant_id, expectedTenant)) {
      throw new Error("AMOS company cache belongs to a different user or company");
    }
  }
}

function normalizeGrantRecord(grant) {
  const claims = grant?.claims;
  const jwk = grant?.jwk;
  if (!claims || !jwk || typeof grant?.token !== "string") {
    throw new Error("Verified company-cache grant is incomplete");
  }
  return {
    token: grant.token,
    jwk: {
      kty: clean(jwk.kty, 16),
      crv: clean(jwk.crv, 32),
      x: clean(jwk.x, 256),
      use: clean(jwk.use, 16),
      alg: clean(jwk.alg, 16),
      kid: clean(jwk.kid, 256)
    },
    cacheId: clean(claims.cache_id, 256),
    issuer: normalizeIssuer(claims.iss),
    subjectId: clean(claims.sub, 256),
    tenantId: clean(claims.tenant_id, 256),
    tenantSlug: clean(claims.tenant_slug, 256),
    role: clean(claims.role, 128),
    scopeCount: Array.isArray(claims.scopes) ? claims.scopes.length : 0,
    scopeFingerprint: clean(claims.scope_fingerprint, 64),
    issuedAt: new Date(integerTimestamp(claims.iat, "issued-at") * 1000).toISOString(),
    expiresAt: new Date(integerTimestamp(claims.exp, "expiry") * 1000).toISOString()
  };
}

function normalizeStoredRecord(record) {
  if (
    typeof record?.token !== "string" ||
    !record.jwk ||
    typeof record.jwk !== "object"
  ) {
    throw new Error("Encrypted company-cache record is incomplete");
  }
  const issuedAt = new Date(record.issuedAt);
  const expiresAt = new Date(record.expiresAt);
  if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    throw new Error("Encrypted company-cache timestamps are invalid");
  }
  return {
    token: record.token,
    jwk: {
      kty: clean(record.jwk.kty, 16),
      crv: clean(record.jwk.crv, 32),
      x: clean(record.jwk.x, 256),
      use: clean(record.jwk.use, 16),
      alg: clean(record.jwk.alg, 16),
      kid: clean(record.jwk.kid, 256)
    },
    cacheId: clean(record.cacheId, 256),
    issuer: normalizeIssuer(record.issuer),
    subjectId: clean(record.subjectId, 256),
    tenantId: clean(record.tenantId, 256),
    tenantSlug: clean(record.tenantSlug, 256),
    role: clean(record.role, 128),
    scopeCount: Math.max(0, Math.min(Number(record.scopeCount) || 0, 10_000)),
    scopeFingerprint: clean(record.scopeFingerprint, 64),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

function decodeJsonSegment(value, label) {
  try {
    return JSON.parse(decodeBase64Url(value, label).toString("utf8"));
  } catch {
    throw new Error(`AMOS returned an invalid ${label}`);
  }
}

function decodeBase64Url(value, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label}`);
  return Buffer.from(value, "base64url");
}

function integerTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`AMOS company cache has an invalid ${label}`);
  }
  return value;
}

function normalizeIssuer(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.username || url.password || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function sameText(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
