import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalReceiptStore } from "../src/desktop/localReceiptStore.js";

test("local task receipts are durable and digest-addressed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-receipts-"));
  const store = new LocalReceiptStore({
    filePath: join(directory, "receipts.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
    createId: () => "receipt-1",
    now: () => new Date("2026-07-27T12:00:00.000Z")
  });
  const receipt = await store.add({
    taskId: "task-1",
    status: "completed",
    boundary: "personal",
    workspace: "project",
    model: "small-capable-model",
    objective: "Inspect the project",
    startedAt: "2026-07-27T11:59:00.000Z",
    finishedAt: "2026-07-27T12:00:00.000Z",
    events: [{ type: "tool_result", name: "desktop_inspect_project", outcome: "completed" }]
  });
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual((await store.list())[0], receipt);
  assert.equal((await readFile(join(directory, "receipts.json"), "utf8")).includes("Inspect the project"), false);
});

test("local task receipts are isolated by independently authenticated account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-account-receipts-"));
  let receiptNumber = 0;
  const store = new LocalReceiptStore({
    filePath: join(directory, "receipts.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
    createId: () => `receipt-${++receiptNumber}`,
    now: () => new Date("2026-08-03T12:00:00.000Z")
  });
  const accountA = { ownerSubjectId: "user-a", ownerTenantId: "tenant-a" };
  const accountB = { ownerSubjectId: "user-b", ownerTenantId: "tenant-b" };
  const common = {
    status: "completed",
    boundary: "online",
    workspace: "project",
    model: "amos-hosted",
    startedAt: "2026-08-03T11:59:00.000Z",
    finishedAt: "2026-08-03T12:00:00.000Z",
    events: []
  };

  await store.add({ ...common, taskId: "task-a", objective: "AMOS-only work" }, accountA);
  await store.add({ ...common, taskId: "task-b", objective: "Smile Wise work" }, accountB);

  assert.deepEqual((await store.list(accountA)).map((receipt) => receipt.taskId), ["task-a"]);
  assert.deepEqual((await store.list(accountB)).map((receipt) => receipt.taskId), ["task-b"]);
  assert.equal(JSON.stringify(await store.list(accountA)).includes("user-a"), false);
  assert.equal(JSON.stringify(await store.list(accountA)).includes("tenant-a"), false);
});
