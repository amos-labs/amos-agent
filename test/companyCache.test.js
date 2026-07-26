import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign
} from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  COMPANY_CACHE_AUDIENCE,
  COMPANY_CACHE_FORMAT,
  COMPANY_CACHE_TOKEN_TYPE,
  COMPANY_CACHE_VERSION,
  CompanyCacheStore,
  verifyCompanyCacheGrant
} from "../src/desktop/companyCache.js";
import { createCompanyCacheTool } from "../src/tools/companyCache.js";

const NOW_SECONDS = Date.parse("2026-07-26T12:00:00Z") / 1000;

test("company-cache verifier accepts the exact user, tenant, issuer, audience, and key", () => {
  const grant = signedGrant();
  const claims = verifyCompanyCacheGrant({
    token: grant.token,
    jwks: { keys: [grant.jwk] },
    expectedIssuer: "https://app.amoslabs.com",
    expectedIdentity: identity(),
    now: new Date(NOW_SECONDS * 1000)
  });
  assert.equal(claims.tenant_id, identity().tenant_id);
  assert.equal(claims.snapshot.company_state.status, "available");
});

test("company-cache verifier rejects tampering, unknown keys, expiry, and identity drift", () => {
  const grant = signedGrant();
  const pieces = grant.token.split(".");
  pieces[2] = `${pieces[2].slice(0, -1)}${pieces[2].endsWith("a") ? "b" : "a"}`;
  assert.throws(
    () => verifyCompanyCacheGrant({
      token: pieces.join("."),
      jwks: { keys: [grant.jwk] },
      expectedIssuer: "https://app.amoslabs.com",
      expectedIdentity: identity(),
      now: new Date(NOW_SECONDS * 1000)
    }),
    /signature/
  );
  assert.throws(
    () => verifyCompanyCacheGrant({
      token: grant.token,
      jwks: { keys: [{ ...grant.jwk, kid: "rotated-away" }] },
      expectedIssuer: "https://app.amoslabs.com",
      expectedIdentity: identity(),
      now: new Date(NOW_SECONDS * 1000)
    }),
    /not currently trusted/
  );
  assert.throws(
    () => verifyCompanyCacheGrant({
      token: grant.token,
      jwks: { keys: [{ ...grant.jwk, use: "enc" }] },
      expectedIssuer: "https://app.amoslabs.com",
      expectedIdentity: identity(),
      now: new Date(NOW_SECONDS * 1000)
    }),
    /invalid profile/
  );
  assert.throws(
    () => verifyCompanyCacheGrant({
      token: grant.token,
      jwks: { keys: [grant.jwk] },
      expectedIssuer: "https://app.amoslabs.com",
      expectedIdentity: identity(),
      now: new Date((NOW_SECONDS + 14_401) * 1000)
    }),
    /expired/
  );
  assert.throws(
    () => verifyCompanyCacheGrant({
      token: grant.token,
      jwks: { keys: [grant.jwk] },
      expectedIssuer: "https://app.amoslabs.com",
      expectedIdentity: { ...identity(), tenant_id: "other-company" },
      now: new Date(NOW_SECONDS * 1000)
    }),
    /different user or company/
  );
});

test("company cache is encrypted at rest and suppresses expired content", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-company-cache-"));
  const filePath = join(root, "company-cache.json");
  let now = new Date(NOW_SECONDS * 1000);
  const store = new CompanyCacheStore({
    filePath,
    ...codec(),
    now: () => now
  });
  const grant = signedGrant();
  await store.write(grant);
  const raw = await readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /Northwind|company_state|tenant-1/);
  assert.equal((await store.status()).status, "active");
  assert.equal(
    (await store.read({
      expectedIssuer: "https://app.amoslabs.com",
      expectedIdentity: identity()
    })).snapshot.company_state.name,
    "Northwind Labs"
  );

  now = new Date((NOW_SECONDS + 14_401) * 1000);
  assert.equal((await store.status()).status, "expired");
  await assert.rejects(
    () => store.read({
      expectedIssuer: "https://app.amoslabs.com",
      expectedIdentity: identity()
    }),
    /expired/
  );
  await store.clear();
  assert.equal((await store.status()).status, "missing");
});

test("offline company-cache tool is sectioned, provenance-first, and read-only", async () => {
  const grant = signedGrant();
  const tool = createCompanyCacheTool({
    read: async () => ({
      claims: grant.claims,
      snapshot: grant.claims.snapshot
    })
  });
  assert.deepEqual(tool.parameters.properties.section.enum.slice(0, 2), ["summary", "all"]);
  const summary = await tool.handler({});
  assert.equal(summary.provenance.live, false);
  assert.equal(summary.provenance.read_only, true);
  assert.equal(summary.company_state.name, "Northwind Labs");
  const authority = await tool.handler({ section: "authority" });
  assert.equal(authority.section, "authority");
  assert.deepEqual(authority.value, { status: "available" });
});

function signedGrant(overrides = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "cache-key-1",
    use: "sig",
    alg: "EdDSA"
  };
  const claims = {
    cache_format: COMPANY_CACHE_FORMAT,
    cache_version: COMPANY_CACHE_VERSION,
    cache_id: "cache-1",
    iss: "https://app.amoslabs.com",
    aud: COMPANY_CACHE_AUDIENCE,
    sub: "user-1",
    tenant_id: "tenant-1",
    tenant_slug: "northwind",
    role: "owner",
    principal_type: "user",
    scopes: ["app:read", "data:read"],
    scope_fingerprint: createHash("sha256")
      .update(["app:read", "data:read"].join("\0"))
      .digest("hex"),
    iat: NOW_SECONDS,
    nbf: NOW_SECONDS,
    exp: NOW_SECONDS + 14_400,
    snapshot: {
      generated_at: "2026-07-26T12:00:00Z",
      company_state: { status: "available", name: "Northwind Labs" },
      active_work: { status: "available" },
      recent_history: { status: "available" },
      authority: { status: "available" }
    },
    ...overrides
  };
  const header = {
    alg: "EdDSA",
    typ: COMPANY_CACHE_TOKEN_TYPE,
    kid: jwk.kid
  };
  const encodedHeader = encode(header);
  const encodedClaims = encode(claims);
  const signature = sign(
    null,
    Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii"),
    privateKey
  ).toString("base64url");
  return {
    token: `${encodedHeader}.${encodedClaims}.${signature}`,
    claims,
    jwk
  };
}

function identity() {
  return {
    sub: "user-1",
    tenant_id: "tenant-1",
    tenant_slug: "northwind",
    role: "owner",
    principal_type: "user",
    user: { id: "user-1", email: "owner@northwind.example" }
  };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function codec() {
  return {
    encrypt(value) {
      return Buffer.from(`encrypted:${value}`).toString("base64");
    },
    decrypt(value) {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      if (!decoded.startsWith("encrypted:")) throw new Error("invalid test ciphertext");
      return decoded.slice("encrypted:".length);
    }
  };
}
