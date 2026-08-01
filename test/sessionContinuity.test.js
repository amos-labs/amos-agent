import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSessionContinuityPrompt,
  continuityScope,
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

function scope(overrides = {}) {
  return continuityScope({
    boundary: "online",
    workspace: "/workspace/ai_co",
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
    objective: "Fix the AMOS website; client_secret=do-not-store; sk-live_abcdefghijklmnopqrstuvwxyz123456",
    answer: "Updated amos-website/app/downloads/page.tsx. Bearer secret-token",
    artifacts: ["amos-website/app/downloads/page.tsx", "git branch: fix/downloads"],
    receipt: { id: "receipt-1", digest: "a".repeat(64) }
  });

  const raw = await readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /AMOS website|amos-website|tenant-1|do-not-store/);

  const restored = await store.load(currentScope);
  assert.equal(restored.turns.length, 1);
  assert.match(restored.turns[0].objective, /client_secret=\[REDACTED\]/);
  assert.match(restored.turns[0].objective, /\[REDACTED HIGH-ENTROPY VALUE\]/);
  assert.match(restored.turns[0].answer, /Bearer \[REDACTED\]/);
  assert.deepEqual(restored.artifacts, [
    "amos-website/app/downloads/page.tsx",
    "git branch: fix/downloads"
  ]);
  assert.equal(await store.load(scope({ tenant_id: "tenant-2" })), null);

  const prompt = buildSessionContinuityPrompt(restored);
  assert.match(prompt, /Exact workspace grant: \/workspace\/ai_co/);
  assert.match(prompt, /amos-website\/app\/downloads\/page\.tsx/);
  assert.match(prompt, /not current company truth/i);
  assert.match(prompt, /None were intentionally stored/i);
  assert.doesNotMatch(prompt, /do-not-store|secret-token/);

  assert.equal(await store.clear(currentScope), true);
  assert.equal(await store.load(currentScope), null);
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
  assert.notEqual(personal.key, offline.key);
  assert.notEqual(personal.key, otherWorkspace.key);
});
