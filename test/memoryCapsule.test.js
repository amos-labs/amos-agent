import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ENCRYPTED_CAPSULE_FORMAT,
  readPrivateMemoryCapsule,
  writePrivateMemoryCapsule
} from "../src/desktop/memoryCapsule.js";

const passphrase = "a portable secret with enough length";

function privateDocument(overrides = {}) {
  return {
    id: "private-1",
    memoryClass: "private",
    authority: "user",
    visibility: "private",
    name: "founder-plan.md",
    mime: "text/markdown",
    kind: "document",
    size: 27,
    sha256: "a".repeat(64),
    source: "amos-desktop",
    createdAt: "2026-07-26T10:00:00Z",
    updatedAt: "2026-07-26T10:05:00Z",
    text: "Private company launch plan.",
    bufferBase64: "",
    ...overrides
  };
}

test("private memory capsules encrypt content and round-trip with lineage", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-memory-capsule-"));
  const filePath = join(root, "portable.amos-memory");
  const written = await writePrivateMemoryCapsule({
    filePath,
    passphrase,
    subjectId: "user-1",
    tenantId: "tenant-1",
    memories: [privateDocument()],
    parentCapsuleId: "parent-capsule",
    now: new Date("2026-07-26T12:00:00Z"),
    capsuleId: "capsule-1"
  });

  assert.equal(written.itemCount, 1);
  assert.equal(written.parentCapsuleId, "parent-capsule");
  const raw = await readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /founder-plan|Private company launch plan|user-1|tenant-1/);
  assert.equal(JSON.parse(raw).format, ENCRYPTED_CAPSULE_FORMAT);

  const unlocked = await readPrivateMemoryCapsule({ filePath, passphrase });
  assert.equal(unlocked.manifest.capsule_id, "capsule-1");
  assert.equal(unlocked.manifest.parent_capsule_id, "parent-capsule");
  assert.equal(unlocked.records[0].text, "Private company launch plan.");
  assert.equal(unlocked.summary.items[0].name, "founder-plan.md");
});

test("capsules reject a wrong passphrase and modified ciphertext", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-memory-capsule-integrity-"));
  const filePath = join(root, "portable.amos-memory");
  await writePrivateMemoryCapsule({
    filePath,
    passphrase,
    subjectId: "local-owner",
    memories: [privateDocument()],
    capsuleId: "capsule-2"
  });

  await assert.rejects(
    readPrivateMemoryCapsule({ filePath, passphrase: "this is the wrong passphrase" }),
    /could not unlock/
  );

  const envelope = JSON.parse(await readFile(filePath, "utf8"));
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString("base64");
  await writeFile(filePath, JSON.stringify(envelope));
  await assert.rejects(
    readPrivateMemoryCapsule({ filePath, passphrase }),
    /could not unlock/
  );
});

test("memory capsules include conversation scratch pads and omit them from the ciphertext envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-memory-capsule-scratchpad-"));
  const filePath = join(root, "portable.amos-memory");
  const written = await writePrivateMemoryCapsule({
    filePath,
    passphrase,
    subjectId: "user-1",
    memories: [privateDocument()],
    scratchpads: [{
      taskId: "task-tax",
      contextKey: "task:task-tax",
      title: "Ops thread",
      objective: "Fix Stripe tax",
      scratchpad: {
        currentJob: "Fix tax_behavior on the three Stripe prices",
        jobs: [
          { title: "Build Stripe to QBO integration", status: "parked" },
          { title: "Fix tax_behavior on the three Stripe prices", status: "current" }
        ],
        notes: "Use password=hunter2 never"
      }
    }],
    capsuleId: "capsule-pads"
  });

  assert.equal(written.memoryCount, 1);
  assert.equal(written.scratchpadCount, 1);
  assert.equal(written.itemCount, 2);
  const raw = await readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /tax_behavior|password=hunter2|Ops thread/);

  const unlocked = await readPrivateMemoryCapsule({ filePath, passphrase });
  assert.equal(unlocked.records.length, 1);
  assert.equal(unlocked.scratchpads.length, 1);
  assert.equal(unlocked.scratchpads[0].taskId, "task-tax");
  assert.equal(unlocked.scratchpads[0].scratchpad.currentJob, "Fix tax_behavior on the three Stripe prices");
  assert.equal(unlocked.scratchpads[0].scratchpad.jobs.length, 2);
  assert.equal(unlocked.summary.items[1].kind, "conversation_scratchpad");
});

test("capsules still read a payload that has no conversation scratch pads", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-memory-capsule-legacy-"));
  const filePath = join(root, "portable.amos-memory");
  await writePrivateMemoryCapsule({
    filePath,
    passphrase,
    subjectId: "user-1",
    memories: [privateDocument()],
    capsuleId: "capsule-legacy"
  });
  const unlocked = await readPrivateMemoryCapsule({ filePath, passphrase });
  assert.equal(unlocked.scratchpads.length, 0);
  assert.equal(unlocked.summary.scratchpadCount, 0);
});

test("capsules export only private memory and require a strong passphrase", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-memory-capsule-policy-"));
  const filePath = join(root, "portable.amos-memory");
  await assert.rejects(
    writePrivateMemoryCapsule({
      filePath,
      passphrase: "too short",
      subjectId: "user-1",
      memories: [privateDocument()]
    }),
    /at least 12/
  );
  await assert.rejects(
    writePrivateMemoryCapsule({
      filePath,
      passphrase,
      subjectId: "user-1",
      memories: [privateDocument({ memoryClass: "company" })]
    }),
    /Only private memory/
  );
});
