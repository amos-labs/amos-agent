import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildEvidencePack,
  LOCAL_RECEIPT_DIGEST_KEYS,
  LocalReceiptStore,
  replayLocalReceiptDigest,
  toDesktopLocalItem,
  toPlatformEvidenceItem,
  verifyEvidencePack
} from "../src/desktop/localReceiptStore.js";
import { EVIDENCE_PACK_SCHEMA } from "../src/desktop/memoryContract.js";

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

test("evidence pack uses public local shape and platform rows without tool args", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-evidence-"));
  const store = new LocalReceiptStore({
    filePath: join(directory, "receipts.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
    createId: () => "receipt-local",
    now: () => new Date("2026-08-14T12:00:00.000Z")
  });
  const local = await store.add({
    taskId: "task-1",
    status: "completed",
    boundary: "personal",
    workspace: "project",
    model: "small-capable-model",
    objective: "Inspect the project",
    startedAt: "2026-08-14T11:59:00.000Z",
    finishedAt: "2026-08-14T12:00:00.000Z",
    events: [{ type: "tool_result", name: "desktop_inspect_project", outcome: "completed" }]
  });

  assert.deepEqual(LOCAL_RECEIPT_DIGEST_KEYS, [
    "id", "taskId", "status", "boundary", "workspace", "model", "objective",
    "startedAt", "finishedAt", "events", "error", "ownerSubjectId", "ownerTenantId",
    "recordedAt"
  ]);
  assert.equal(Object.hasOwn(local, "ownerSubjectId"), false);
  assert.equal(replayLocalReceiptDigest(local), local.digest);

  const pack = buildEvidencePack({
    localReceipts: [local],
    platformReceipts: [
      completePlatformRow({
        id: "platform-1",
        receipt: {
          ...completeNestedReceipt(),
          inputs: { tool: "create_ad", secret: "must-not-export" }
        }
      }),
      ...Array.from({ length: 201 }, (_, index) => completePlatformRow({
        id: `extra-${index}`,
        operation: "list_automations"
      }))
    ],
    exportedAt: "2026-08-14T12:00:00.000Z"
  });

  assert.equal(pack.schema, EVIDENCE_PACK_SCHEMA);
  assert.equal(pack.items[0].kind, "desktop-local");
  assert.deepEqual(Object.keys(pack.items[0]), [
    "kind", "id", "taskId", "status", "boundary", "workspace", "model", "objective",
    "startedAt", "finishedAt", "events", "error", "recordedAt", "digest"
  ]);
  assert.equal(pack.items.filter((item) => item.kind === "platform").length, 200);
  assert.equal(pack.items[1].kind, "platform");
  assert.equal(pack.items[1].receipt.inputs, undefined);
  assert.equal(pack.items[1].receipt.outputs, undefined);
  assert.equal(pack.items[1].receipt.unexpected, undefined);
  assert.equal(JSON.stringify(pack).includes("must-not-export"), false);
  assert.equal(pack.items[1].digest, undefined);

  const verified = verifyEvidencePack(pack);
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.errors, []);
  assert.equal(verified.items[0].digest, "ok");
});

test("evidence pack verify is per-kind and does not hash platform rows as local receipts", () => {
  const localItem = toDesktopLocalItem({
    id: "local-1",
    taskId: "task-1",
    status: "completed",
    boundary: "offline",
    workspace: "project",
    model: "local",
    objective: "Summarize",
    startedAt: "2026-08-14T11:59:00.000Z",
    finishedAt: "2026-08-14T12:00:00.000Z",
    events: [],
    error: null,
    recordedAt: "2026-08-14T12:00:00.000Z",
    digest: "b".repeat(64)
  });
  const platformItem = toPlatformEvidenceItem(completePlatformRow({
    id: "platform-1",
    digest: "c".repeat(64)
  }));
  const pack = {
    schema: EVIDENCE_PACK_SCHEMA,
    exportedAt: "2026-08-14T12:00:00.000Z",
    items: [localItem, platformItem]
  };

  const verified = verifyEvidencePack(pack);
  assert.equal(verified.ok, true);
  assert.equal(verified.items[0].digest, "unverified");
  assert.equal(verified.items[1].digest, "n/a");
  assert.notEqual(platformItem.digest, localItem.digest);

  const withObjectInputs = verifyEvidencePack({
    ...pack,
    items: [{
      ...platformItem,
      receipt: { ...completeNestedReceipt(), inputs: { prompt: "secret" } }
    }]
  });
  assert.equal(withObjectInputs.ok, false);
  assert.match(withObjectInputs.errors.join("\n"), /inputs must be omitted/);

  const withStringInputs = verifyEvidencePack({
    ...pack,
    items: [{
      ...platformItem,
      receipt: { ...completeNestedReceipt(), inputs: "raw-secret" }
    }]
  });
  assert.equal(withStringInputs.ok, false);
  assert.match(withStringInputs.errors.join("\n"), /inputs must be omitted/);

  const withArrayInputs = verifyEvidencePack({
    ...pack,
    items: [{
      ...platformItem,
      receipt: { ...completeNestedReceipt(), inputs: ["raw-secret"] }
    }]
  });
  assert.equal(withArrayInputs.ok, false);
  assert.match(withArrayInputs.errors.join("\n"), /inputs must be omitted/);

  const withOutputs = verifyEvidencePack({
    ...pack,
    items: [{
      ...platformItem,
      receipt: {
        ...completeNestedReceipt(),
        outputs: { customer_email: "secret@example.test" }
      }
    }]
  });
  assert.equal(withOutputs.ok, false);
  assert.match(withOutputs.errors.join("\n"), /outputs must be omitted/);

  const badSchema = verifyEvidencePack({ ...pack, schema: "amos-memory-capsule" });
  assert.equal(badSchema.ok, false);
});

test("verifyReceiptBundle.js accepts a valid pack and rejects a non-empty inputs row", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-evidence-script-"));
  const script = fileURLToPath(new URL("../scripts/verifyReceiptBundle.js", import.meta.url));
  const validPath = join(directory, "valid.json");
  const invalidPath = join(directory, "invalid.json");
  const pack = buildEvidencePack({
    localReceipts: [],
    platformReceipts: [completePlatformRow({ id: "platform-1" })],
    exportedAt: "2026-08-14T12:00:00.000Z"
  });
  await writeFile(validPath, `${JSON.stringify(pack, null, 2)}\n`);
  await writeFile(invalidPath, `${JSON.stringify({
    ...pack,
    items: [{
      ...pack.items[0],
      receipt: { ...completeNestedReceipt(), inputs: { raw: "args" } }
    }]
  }, null, 2)}\n`);

  const valid = spawnSync(process.execPath, [script, validPath], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /ok 1 item/);

  const invalid = spawnSync(process.execPath, [script, invalidPath], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /inputs must be omitted/);
});

test("evidence pack omits every inputs type and every outputs field", () => {
  const pack = buildEvidencePack({
    localReceipts: [],
    platformReceipts: [
      completePlatformRow({
        id: "string-inputs",
        receipt: {
          ...completeNestedReceipt(),
          inputs: "raw-secret",
          outputs: { customer_email: "secret@example.test" },
          unexpected: "keep-me-out"
        }
      }),
      completePlatformRow({
        id: "array-inputs",
        receipt: {
          ...completeNestedReceipt(),
          inputs: ["raw-secret"]
        }
      }),
      completePlatformRow({
        id: "empty-object-inputs",
        receipt: {
          ...completeNestedReceipt(),
          inputs: {},
          outputs: {}
        }
      })
    ],
    exportedAt: "2026-08-14T12:00:00.000Z"
  });

  const raw = JSON.stringify(pack);
  assert.equal(raw.includes("raw-secret"), false);
  assert.equal(raw.includes("secret@example.test"), false);
  assert.equal(raw.includes("keep-me-out"), false);
  for (const item of pack.items) {
    assert.equal(item.receipt.inputs, undefined);
    assert.equal(item.receipt.outputs, undefined);
    assert.equal(item.receipt.unexpected, undefined);
    assert.equal(item.receipt.operation, "repair_automation_failure");
    assert.equal(item.receipt.intent.summary, "Retry a replay-safe automation step");
  }
  assert.equal(verifyEvidencePack(pack).ok, true);
});

function completePlatformRow(overrides = {}) {
  const { receipt, ...rest } = overrides;
  return {
    id: "11111111-1111-1111-1111-111111111111",
    operation: "repair_automation_failure",
    actor: "user:ada",
    agency: "human_directed",
    lifecycle_state: "executed",
    effect_applied: true,
    verified: true,
    created_at: "2026-08-14T12:00:00.000Z",
    correlation: { automation_id: "22222222-2222-2222-2222-222222222222" },
    ...rest,
    receipt: completeNestedReceipt(receipt || {})
  };
}

function completeNestedReceipt(overrides = {}) {
  return {
    receipt_version: "2",
    operation: "repair_automation_failure",
    tenant_id: "33333333-3333-3333-3333-333333333333",
    actor: "user:ada",
    agency: "human_directed",
    lifecycle_state: "executed",
    effect_applied: true,
    correlation: { automation_id: "22222222-2222-2222-2222-222222222222" },
    intent: {
      summary: "Retry a replay-safe automation step",
      self_modifying: false,
      scope_classification: "automation"
    },
    policy: { guardrails: ["tenant_isolation"] },
    validation: [{ id: "step_replayed", status: "passed", detail: "step_run settled" }],
    result_summary: "Replay applied; incident closed.",
    emitted_at: "2026-08-14T12:00:00.000Z",
    ...overrides
  };
}
