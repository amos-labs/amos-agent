import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SavedViewStore } from "../src/desktop/savedViewStore.js";

test("saved briefings persist encrypted definitions and stay identity-pinned", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-saved-views-"));
  const filePath = join(directory, "saved-views.json");
  const store = new SavedViewStore({
    filePath,
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString(),
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    createId: () => "view-1"
  });
  const identity = { sub: "user-1", tenant_id: "tenant-1" };
  const saved = await store.save({
    title: "Daily portfolio",
    prompt: "Refresh the daily franchise portfolio briefing.",
    sourceKind: "live"
  }, identity);

  assert.equal(saved.id, "view-1");
  assert.deepEqual((await store.list(identity)).map((view) => view.title), ["Daily portfolio"]);
  assert.deepEqual(await store.list({ sub: "user-2", tenant_id: "tenant-1" }), []);
  assert.doesNotMatch(await readFile(filePath, "utf8"), /Daily portfolio/);
});

test("saved briefings update matching refresh intents and enforce ownership on removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-saved-views-"));
  const store = new SavedViewStore({
    filePath: join(directory, "saved-views.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString(),
    createId: () => "view-1"
  });
  const owner = { sub: "user-1", tenant_id: "tenant-1" };
  await store.save({ title: "Old", prompt: "Refresh this view." }, owner);
  await store.save({ title: "New", prompt: "Refresh this view." }, owner);
  assert.deepEqual((await store.list(owner)).map((view) => view.title), ["New"]);
  await assert.rejects(
    () => store.remove("view-1", { sub: "user-2", tenant_id: "tenant-1" }),
    /another AMOS identity/
  );
  assert.equal(await store.remove("view-1", owner), true);
  assert.deepEqual(await store.list(owner), []);
});
