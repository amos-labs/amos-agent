import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopAccountStore } from "../src/auth/tokenStore.js";

function codec() {
  return {
    encrypt(value) {
      return Buffer.from(`sealed:${value}`, "utf8").toString("base64");
    },
    decrypt(value) {
      const plain = Buffer.from(value, "base64").toString("utf8");
      if (!plain.startsWith("sealed:")) throw new Error("not sealed");
      return plain.slice(7);
    }
  };
}

test("Desktop stores independent OAuth accounts encrypted and switches locally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-accounts-"));
  const filePath = join(directory, "accounts.json");
  const store = new DesktopAccountStore({ filePath, ...codec() });

  const firstKey = "11111111-1111-4111-8111-111111111111";
  const secondKey = "22222222-2222-4222-8222-222222222222";
  const first = await store.add(
    { access_token: "first-secret", refresh_token: "first-refresh" },
    {},
    { approvalKeyId: firstKey }
  );
  await store.updateActiveProfile({
    user: { id: "user-amos", name: "Rick Barkley", email: "rick@amoslabs.com" },
    tenant_id: "tenant-amos",
    tenant_slug: "amos-labs",
    role: "owner"
  });
  const second = await store.add(
    { access_token: "second-secret", refresh_token: "second-refresh" },
    {},
    { approvalKeyId: secondKey }
  );
  await store.updateActiveProfile({
    user: { id: "user-smile", name: "Rick Barkley", email: "rick@smilewise.com" },
    tenant_id: "tenant-smile",
    tenant_slug: "smile-wise",
    role: "owner"
  });

  assert.equal((await store.read()).access_token, "second-secret");
  assert.equal(await store.activeApprovalKeyId(), secondKey);
  await store.activate(first);
  assert.equal((await store.read()).access_token, "first-secret");
  assert.equal(await store.activeApprovalKeyId(), firstKey);
  const replacementKey = "33333333-3333-4333-8333-333333333333";
  await store.setActiveApprovalKeyId(replacementKey);
  assert.equal(await store.activeApprovalKeyId(), replacementKey);
  await store.write({ access_token: "first-rotated", refresh_token: "first-refresh-2" });
  assert.equal((await store.read()).access_token, "first-rotated");

  const publicAccounts = await store.list();
  assert.equal(publicAccounts.currentAccountId, first);
  assert.deepEqual(
    publicAccounts.accounts.map((account) => account.tenantSlug).sort(),
    ["amos-labs", "smile-wise"]
  );
  assert.equal(JSON.stringify(publicAccounts).includes("secret"), false);
  assert.deepEqual(await store.activeScope(), {
    ownerSubjectId: "user-amos",
    ownerTenantId: "tenant-amos"
  });
  const raw = await readFile(filePath, "utf8");
  assert.equal(raw.includes("first-rotated"), false);
  assert.equal(raw.includes("second-secret"), false);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);

  await store.remove(first);
  assert.equal((await store.list()).currentAccountId, second);
  assert.equal((await store.read()).access_token, "second-secret");
});

test("Desktop migrates the legacy OAuth session once and removes the plaintext copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-account-migration-"));
  const filePath = join(directory, "accounts.json");
  const legacyFilePath = join(directory, "oauth.json");
  await writeFile(legacyFilePath, JSON.stringify({
    version: 1,
    access_token: "legacy-secret",
    refresh_token: "legacy-refresh"
  }), { mode: 0o600 });
  const store = new DesktopAccountStore({ filePath, legacyFilePath, ...codec() });

  await store.initialize();

  assert.equal((await store.read()).access_token, "legacy-secret");
  await assert.rejects(readFile(legacyFilePath, "utf8"), (error) => error.code === "ENOENT");
  assert.equal((await readFile(filePath, "utf8")).includes("legacy-secret"), false);
});
