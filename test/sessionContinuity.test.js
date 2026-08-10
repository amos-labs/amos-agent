import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContinuityManifest,
  buildSessionContinuityPrompt,
  compileContinuityContext,
  continuityScope,
  normalizeSharedContinuityManifest,
  SessionContinuityStore
} from "../src/desktop/sessionContinuity.js";

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

function scope(overrides = {}, contextKey = "active") {
  return continuityScope({
    boundary: "online",
    workspace: "/workspace/ai_co",
    contextKey,
    identity: {
      principal_type: "user",
      sub: "user-1",
      tenant_id: "tenant-1",
      ...overrides
    }
  });
}

test("session continuity is encrypted, identity pinned, redacted, and non-replayable", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-session-continuity-"));
  const filePath = join(root, "continuity.json");
  const store = new SessionContinuityStore({
    filePath,
    ...codec(),
    now: () => new Date("2026-08-02T09:00:00.000Z")
  });
  const currentScope = scope();
  await store.appendTurn(currentScope, {
    objective: "Fix the AMOS website; client_secret=do-not-store; password: colon-secret; sk-live_abcdefghijklmnopqrstuvwxyz123456",
    answer: `Updated amos-website/app/downloads/page.tsx. Bearer secret-token ${"a".repeat(64)}`,
    artifacts: [
      "amos-website/app/downloads/page.tsx",
      "git branch: fix/downloads",
      "src/components/company/WorkingContinuityPanelWithLongName.tsx"
    ],
    receipt: {
      id: "receipt-1",
      digest: "a".repeat(64),
      taskId: "task-1",
      status: "completed",
      model: "anthropic:claude",
      events: [
        { type: "workflow", name: "code-change", outcome: "Inspect and verify" },
        { type: "tool_start", name: "apply_patch", outcome: "started" },
        { type: "tool_end", name: "apply_patch", outcome: "completed" }
      ]
    },
    continuity: {
      commitments: [{ summary: "Keep the download URL stable", status: "open" }],
      corrections: [{ summary: "The affected route is /downloads, not /download" }]
    }
  });

  const raw = await readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /AMOS website|amos-website|tenant-1|do-not-store/);

  const restored = await store.load(currentScope);
  assert.equal(restored.turns.length, 1);
  assert.match(restored.turns[0].objective, /client_secret=\[REDACTED\]/);
  assert.match(restored.turns[0].objective, /password: \[REDACTED\]/);
  assert.doesNotMatch(restored.turns[0].objective, /colon-secret/);
  assert.match(restored.turns[0].objective, /\[REDACTED HIGH-ENTROPY VALUE\]/);
  assert.match(restored.turns[0].answer, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(restored.turns[0].answer, new RegExp("a{64}"));
  assert.deepEqual(restored.artifacts, [
    "amos-website/app/downloads/page.tsx",
    "git branch: fix/downloads",
    "src/components/company/WorkingContinuityPanelWithLongName.tsx"
  ]);
  assert.equal(await store.load(scope({ tenant_id: "tenant-2" })), null);
  assert.equal(restored.manifest.format, "amos.continuity_manifest");
  assert.equal(restored.manifest.transitions[0].workflow.id, "code-change");
  assert.deepEqual(restored.manifest.transitions[0].actions, [{
    name: "apply_patch",
    status: "completed",
    summary: "completed"
  }]);
  assert.match(restored.manifest.transitions[0].commitments[0].summary, /download URL/);

  const prompt = buildSessionContinuityPrompt(restored, {
    currentModel: "openai:codex"
  });
  assert.match(prompt, /Exact workspace grant: \/workspace\/ai_co/);
  assert.match(prompt, /amos-website\/app\/downloads\/page\.tsx/);
  assert.match(prompt, /not current company truth/i);
  assert.match(prompt, /None were intentionally stored/i);
  assert.match(prompt, /intelligence_handoff/);
  assert.match(prompt, /openai:codex/);
  assert.doesNotMatch(prompt, /do-not-store|secret-token/);

  assert.equal(await store.clear(currentScope), true);
  assert.equal(await store.load(currentScope), null);
});

test("continuity compilation keeps the latest state inside a strict context budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-session-context-budget-"));
  const store = new SessionContinuityStore({
    filePath: join(root, "continuity.json"),
    ...codec(),
    now: () => new Date("2026-08-02T09:00:00.000Z")
  });
  const currentScope = scope();
  for (let index = 0; index < 8; index += 1) {
    await store.appendTurn(currentScope, {
      objective: `Objective ${index}`,
      answer: `${`Long evidence ${index} `.repeat(900)}final-${index}`,
      artifacts: [`reports/result-${index}.md`],
      receipt: {
        id: `receipt-${index}`,
        digest: String(index).repeat(64),
        taskId: `task-${index}`,
        status: "completed",
        model: "openai-compatible:test"
      }
    });
  }

  const record = await store.load(currentScope);
  const manifest = buildContinuityManifest(record);
  const compiled = compileContinuityContext(manifest, { maxChars: 3_000 });
  assert.ok(compiled.length <= 3_000);
  assert.match(compiled, /Objective 7/);
  assert.match(compiled, /receipt-7/);
  assert.match(compiled, /omitted_prior_transitions/);
  assert.doesNotMatch(compiled, /Objective 0/);
});

test("local continuity is separated by boundary and exact workspace", () => {
  const personal = continuityScope({
    boundary: "personal",
    workspace: "/workspace/one"
  });
  const offline = continuityScope({
    boundary: "offline",
    workspace: "/workspace/one"
  });
  const otherWorkspace = continuityScope({
    boundary: "personal",
    workspace: "/workspace/two"
  });
  const otherTask = continuityScope({
    boundary: "personal",
    workspace: "/workspace/one",
    contextKey: "task:automation-builder"
  });
  assert.notEqual(personal.key, offline.key);
  assert.notEqual(personal.key, otherWorkspace.key);
  assert.notEqual(personal.key, otherTask.key);
});

test("named task lanes keep local continuity isolated without losing the active lane", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-named-task-continuity-"));
  const store = new SessionContinuityStore({
    filePath: join(root, "continuity.json"),
    ...codec(),
    now: () => new Date("2026-08-10T09:00:00.000Z")
  });
  const active = scope();
  const automation = scope({}, "task:automation-builder");

  await store.appendTurn(active, { objective: "Plan the quarter", answer: "Plan saved" });
  await store.appendTurn(automation, {
    objective: "Build the renewal automation",
    answer: "Drafted the governed trigger and steps"
  });

  assert.equal((await store.load(active)).turns[0].objective, "Plan the quarter");
  assert.equal(
    (await store.load(automation)).turns[0].objective,
    "Build the renewal automation"
  );
  assert.equal((await store.load(automation)).manifest.scope.contextKey, "task:automation-builder");
});

test("shared continuity is tenant pinned, non-authoritative, and portable", () => {
  const manifest = normalizeSharedContinuityManifest({
    format: "amos.continuity_manifest",
    version: 1,
    revision: 4,
    scope: {
      boundary: "online",
      tenantId: "tenant-1",
      contextKey: "active",
      workspaceHint: "neighborly-demo"
    },
    updatedAt: "2026-08-03T10:00:00.000Z",
    transitions: [{
      at: "2026-08-03T10:00:00.000Z",
      status: "completed",
      objective: "Show the generated learning course",
      outcome: "The draft course is ready for review",
      model: "anthropic:claude",
      sourceClient: "claude_desktop",
      openLoops: [{ summary: "Confirm the audience", sourceRef: "course:42" }],
      artifacts: ["https://learning.example/courses/42"]
    }],
    handoffs: [{
      from: "openai:codex",
      to: "anthropic:claude",
      at: "2026-08-03T10:00:00.000Z"
    }],
    artifacts: ["https://learning.example/courses/42"],
    safeguards: {
      orientationOnly: true,
      requiresFreshAuthority: true,
      replayAllowed: false,
      clientReported: true,
      credentialsIncluded: false,
      companyMemory: false
    }
  }, { tenantId: "tenant-1" });

  const compiled = compileContinuityContext(manifest);
  assert.match(compiled, /Workspace hint \(not a filesystem grant\): neighborly-demo/);
  assert.match(compiled, /Show the generated learning course/);
  assert.match(compiled, /not current company truth/i);
  assert.throws(
    () => normalizeSharedContinuityManifest(manifest, { tenantId: "tenant-2" }),
    /does not match the current company/
  );
  assert.throws(
    () => normalizeSharedContinuityManifest({
      ...manifest,
      safeguards: { ...manifest.safeguards, replayAllowed: true }
    }, { tenantId: "tenant-1" }),
    /safety contract/
  );
});

test("version-one continuity records migrate without losing restart context", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-session-continuity-v1-"));
  const filePath = join(root, "continuity.json");
  const currentScope = scope();
  const legacy = {
    version: 1,
    records: [{
      ...currentScope,
      turns: [{
        objective: "Continue the existing task",
        answer: "The first milestone completed",
        receiptId: "legacy-receipt",
        receiptDigest: "b".repeat(64),
        at: "2026-08-01T10:00:00.000Z"
      }],
      artifacts: ["legacy/result.md"],
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z"
    }]
  };
  const sealed = codec().encrypt(JSON.stringify(legacy));
  await writeFile(filePath, JSON.stringify({ version: 1, encryptedRecord: sealed }));
  const store = new SessionContinuityStore({ filePath, ...codec() });

  const restored = await store.load(currentScope);
  assert.equal(restored.turns[0].status, "completed");
  assert.equal(restored.manifest.transitions[0].receipt.id, "legacy-receipt");
  assert.match(buildSessionContinuityPrompt(restored), /Continue the existing task/);

  await store.appendTurn(currentScope, {
    objective: "Next task",
    answer: "Next milestone"
  });
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).version, 2);
});
