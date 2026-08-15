import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compileRelationshipProfile,
  setExplicitPreference
} from "../src/desktop/relationshipProfile.js";
import {
  RelationshipProfileStore,
  profileOwnerKey,
  profileOwnerScope
} from "../src/desktop/relationshipProfileStore.js";

function codec() {
  return {
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  };
}

test("explicit collaboration preferences persist per owner and compile into the runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-relationship-profile-"));
  const store = new RelationshipProfileStore({
    filePath: join(root, "profile.json"),
    ...codec(),
    now: () => new Date("2026-08-15T12:00:00.000Z")
  });
  const personal = profileOwnerScope({ boundary: "personal" });
  const company = profileOwnerScope({
    identity: { sub: "user-1", tenant_id: "tenant-1" },
    boundary: "online"
  });
  assert.notEqual(profileOwnerKey(personal), profileOwnerKey(company));

  const saved = await store.setPreference(personal, "challenge", "blunt");
  assert.equal(saved.revision, 1);
  assert.equal(saved.explicitPreferences[0].value, "blunt");
  assert.equal(saved.learnedPreferences.length, 0);
  const compiled = compileRelationshipProfile(saved);
  assert.match(compiled, /challenge blunt/);
  assert.match(compiled, /cannot weaken/);

  const companyEmpty = await store.load(company);
  assert.equal(companyEmpty.explicitPreferences.length, 0);

  await assert.rejects(
    () => store.setPreference(personal, "challenge", "sycophant"),
    /must be one of/
  );

  const reset = await store.reset(personal);
  assert.equal(reset.explicitPreferences.length, 0);
  const loaded = await store.load(personal);
  assert.equal(loaded.explicitPreferences.length, 0);
});

test("a later local preference cannot silently overwrite a newer revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-relationship-cas-"));
  const store = new RelationshipProfileStore({
    filePath: join(root, "profile.json"),
    ...codec()
  });
  const scope = profileOwnerScope({ boundary: "personal" });
  const first = await store.setPreference(scope, "detail", "concise");
  await store.setPreference(scope, "detail", "deep");
  await assert.rejects(
    () => store.setPreference(scope, "detail", "standard", {
      expectedRevision: first.revision
    }),
    /stale collaboration profile revision/
  );
});

test("setExplicitPreference rejects inferred-only keys and keeps the catalog bounded", () => {
  const next = setExplicitPreference(null, "response_structure", "recommendation_first", {
    now: () => new Date("2026-08-15T12:00:00.000Z")
  });
  assert.equal(next.explicitPreferences[0].pinned, true);
  assert.equal(compileRelationshipProfile(null), "");
});
