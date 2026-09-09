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
  LOCAL_RECEIPT_PUBLIC_KEYS,
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
    events: [{ type: "tool_result", name: "desktop_inspect_project", outcome: "completed" }],
    usage: {
      inputTokens: 1200,
      outputTokens: 400,
      totalTokens: 1600,
      costUsedMicrousd: 4200,
      estimated: true,
      model: "grok-4.6",
      requestedRuntime: "mtplx",
      runtime: "ollama",
      runtimeFallbacks: 1,
      fallbackReason: "primary_transport_failed",
      performance: {
        requestCount: 2,
        totalLatencyMs: 60_000,
        averageLatencyMs: 30_000,
        maxLatencyMs: 40_000,
        totalTimeToFirstOutputMs: 50_000,
        timeToFirstOutputSamples: 2,
        averageTimeToFirstOutputMs: 25_000,
        totalPromptEvalMs: 14_000,
        promptEvalSamples: 1,
        totalGenerationMs: 10_000,
        generationSamples: 2,
        generationOutputTokens: 150,
        generationTokensPerSecond: 15
      }
    }
  });
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.usage.totalTokens, 1600);
  assert.equal(receipt.usage.model, "grok-4.6");
  assert.equal(receipt.usage.runtime, "ollama");
  assert.equal(receipt.usage.runtimeFallbacks, 1);
  assert.equal(receipt.usage.performance.averageLatencyMs, 30_000);
  assert.equal(receipt.usage.performance.generationTokensPerSecond, 15);
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

test("interrupted receipts retain their status and replay through the established evidence shape", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-receipt-outcome-"));
  const store = receiptOutcomeStore(directory);
  const receipt = await store.add({
    status: "completed",
    executionOutcome: {
      status: "interrupted", reason: "model_timeout_after_progress", verified: true,
      detail: "private-token-must-not-export", result: { email: "private@example.test" }
    },
    events: Array.from({ length: 250 }, () => ({ type: "tool_end", name: "save", outcome: "completed" }))
  });
  assert.equal(receipt.status, "interrupted");
  assert.equal(receipt.events.length, 200);
  assert.deepEqual(receipt.events.at(-1), {
    type: "execution_outcome", name: "model_timeout_after_progress", outcome: "interrupted:unverified"
  });
  assert.deepEqual(Object.keys(receipt), LOCAL_RECEIPT_PUBLIC_KEYS);
  assert.equal(replayLocalReceiptDigest(receipt), receipt.digest);
  const pack = buildEvidencePack({ localReceipts: [receipt] });
  const checked = verifyEvidencePack(pack);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(checked.items[0].digest, "ok");
  assert.equal(pack.items[0].status, "interrupted");
  assert.doesNotMatch(JSON.stringify(pack), /private-token|private@example/);
  assert.deepEqual((await store.list())[0], receipt);
});

test("receipts record verification only from explicit execution metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-receipt-verification-"));
  const store = receiptOutcomeStore(directory);
  const tools = [{ type: "tool_end", name: "save", outcome: "completed" }];
  for (const [reason, verified] of [["answer_returned", false], ["verified_delivery", true]]) {
    const receipt = await store.add({
      status: "completed", events: tools,
      executionOutcome: { status: "completed", reason, verified }
    });
    assert.equal(receipt.events.at(-1).outcome, `completed:${verified ? "verified" : "unverified"}`);
    assert.equal(replayLocalReceiptDigest(receipt), receipt.digest);
  }
  const legacy = await store.add({ status: "completed", events: tools });
  assert.deepEqual(legacy.events, tools);
  assert.equal(Object.hasOwn(legacy, "executionOutcome"), false);
  assert.equal(replayLocalReceiptDigest(legacy), legacy.digest);
});

test("receipt outcome reasons cannot carry arbitrary content and cancellations retain the legacy spelling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-receipt-safe-enum-"));
  const store = receiptOutcomeStore(directory);
  const receipt = await store.add({
    status: "completed",
    executionOutcome: { status: "cancelled", reason: "private@example.test", verified: true }
  });
  assert.equal(receipt.status, "canceled");
  assert.deepEqual(receipt.events, [{
    type: "execution_outcome", name: "user_cancelled", outcome: "cancelled:unverified"
  }]);
  assert.equal(replayLocalReceiptDigest(receipt), receipt.digest);
  assert.doesNotMatch(JSON.stringify(receipt), /private@example/);
  const interrupted = await store.add({ status: "interrupted" });
  assert.equal(interrupted.status, "interrupted");
  assert.equal(replayLocalReceiptDigest(interrupted), interrupted.digest);
});

function receiptOutcomeStore(directory) {
  let index = 0;
  return new LocalReceiptStore({
    filePath: join(directory, "receipts.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
    createId: () => `receipt-${++index}`,
    now: () => new Date("2026-09-09T12:00:00.000Z")
  });
}

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
    "startedAt", "finishedAt", "events", "error", "usage", "ownerSubjectId", "ownerTenantId",
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
    "startedAt", "finishedAt", "events", "error", "usage", "recordedAt", "digest"
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
