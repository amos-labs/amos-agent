import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTaskResumePrompt,
  onlineTaskSource,
  reconcileTaskCheckpoint,
  TaskCheckpointStore
} from "../src/desktop/taskCheckpoint.js";

function codec() {
  return {
    encrypt: (value) => Buffer.from(`sealed:${value}`).toString("base64"),
    decrypt: (value) => {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      if (!decoded.startsWith("sealed:")) throw new Error("not sealed");
      return decoded.slice(7);
    }
  };
}

function identity(overrides = {}) {
  return {
    principal_type: "user",
    sub: "user-1",
    tenant_id: "tenant-1",
    tenant_slug: "northwind",
    role: "owner",
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    generated_at: "2026-07-26T08:00:00.000Z",
    identity: { company: "Northwind" },
    company_state: { customers: 12 },
    authority: { role: "owner" },
    active_work: { campaigns: 2 },
    ...overrides
  };
}

test("task checkpoints are encrypted and running work becomes interrupted after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-task-checkpoint-"));
  const store = new TaskCheckpointStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    now: () => new Date("2026-07-26T09:00:00.000Z"),
    createId: () => "task-1"
  });
  await store.start({
    objective: "Prepare the launch plan",
    attachmentNames: ["brief.pdf"],
    source: onlineTaskSource({ identity: identity(), snapshot: snapshot() })
  });
  const raw = await readFile(join(root, "tasks.json"), "utf8");
  assert.doesNotMatch(raw, /Prepare the launch plan|brief\.pdf|tenant-1/);

  const [recovered] = await store.initialize();
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.progress.phase, "interrupted");
});

test("resuming revalidates identity, company drift, and pending approvals without replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-task-resume-"));
  const store = new TaskCheckpointStore({
    filePath: join(root, "tasks.json"),
    ...codec(),
    createId: () => "task-2"
  });
  const checkpoint = await store.start({
    objective: "Improve campaign conversion",
    source: onlineTaskSource({ identity: identity(), snapshot: snapshot() })
  });
  await store.update(checkpoint.id, {
    status: "interrupted",
    phase: "acting",
    summary: "Drafted a landing page",
    objective: "Improve campaign conversion\n\nUser steering: prioritize mobile traffic",
    completedStep: "Completed create_landing_page"
  });
  const current = await store.get(checkpoint.id);
  const reconciliation = reconcileTaskCheckpoint({
    checkpoint: current,
    identity: identity(),
    snapshot: snapshot({ company_state: { customers: 14 } }),
    approvals: [{ status: "pending" }, { status: "approved" }]
  });
  const saved = await store.update(checkpoint.id, { reconciliation });
  const prompt = buildTaskResumePrompt(saved);

  assert.deepEqual(reconciliation.changedSections, ["company_state"]);
  assert.equal(reconciliation.pendingApprovalCount, 1);
  assert.match(prompt, /untrusted continuity context/i);
  assert.match(prompt, /Do not repeat an action unless current receipts prove it did not already complete/i);
  assert.match(prompt, /Company_state/i);
  assert.match(prompt, /Completed create_landing_page/);
  assert.match(prompt, /prioritize mobile traffic/);
  assert.equal(reconciliation.replayAllowed, false);

  assert.throws(
    () => reconcileTaskCheckpoint({
      checkpoint: current,
      identity: identity({ tenant_id: "tenant-2" }),
      snapshot: snapshot(),
      approvals: []
    }),
    /different AMOS user or company/
  );

  const replacement = await store.start({
    id: "task-3",
    title: saved.title,
    replacesId: saved.id,
    objective: prompt,
    source: onlineTaskSource({
      identity: identity(),
      snapshot: snapshot({ company_state: { customers: 14 } })
    })
  });
  assert.equal(replacement.id, "task-3");
  assert.deepEqual((await store.list()).map((item) => item.id), ["task-3"]);
});
