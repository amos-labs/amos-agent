import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DesktopTaskEpisodeStore,
  taskEpisodeEvent
} from "../src/desktop/taskEpisodeStore.js";

test("Desktop stores one immutable digest-only organism trace bundle per task", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-task-episode-"));
  const store = new DesktopTaskEpisodeStore({ rootPath: root });
  const args = { token: "must-not-appear", query: "private buyer search" };
  const result = { contacts: [{ email: "private@example.com" }], count: 1 };
  const recorded = await store.record({
    taskId: "task-1",
    status: "completed",
    boundary: "online",
    model: "amos-hosted:auto",
    objective: "Private customer objective",
    startedAt: "2026-09-01T10:00:00.000Z",
    finishedAt: "2026-09-01T10:01:00.000Z",
    events: [
      taskEpisodeEvent({ type: "tool_start", name: "search", args }, { at: "2026-09-01T10:00:10.000Z" }),
      taskEpisodeEvent({ type: "tool_end", name: "search", result, durationMs: 100 }, { at: "2026-09-01T10:00:10.100Z" }),
      taskEpisodeEvent({ type: "model_call", model: "qwen", finishReason: "stop", inputTokens: 100, outputTokens: 20 }, { at: "2026-09-01T10:00:20.000Z" })
    ]
  });

  const contents = await readFile(recorded.filePath, "utf8");
  const bundle = JSON.parse(contents);
  assert.equal(bundle.schema, "amos.organism-trace-bundle");
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.entries.length, 0);
  assert.equal(bundle.source.episode.outcome.outcomeBearing, true);
  assert.equal(bundle.source.episode.dataPolicy.exportEligible, false);
  assert.equal(bundle.source.episode.events[0].argsSha256.length, 64);
  assert.equal(bundle.source.episode.events[1].resultSha256.length, 64);
  assert.equal(bundle.source.episode.events[2].finishReason, "stop");
  assert.doesNotMatch(contents, /must-not-appear|private buyer search|private@example\.com|Private customer objective/);

  const repeated = await store.record({
    taskId: "task-1",
    status: "completed",
    boundary: "online",
    model: "amos-hosted:auto",
    objective: "Private customer objective",
    startedAt: "2026-09-01T10:00:00.000Z",
    finishedAt: "2026-09-01T10:01:00.000Z",
    events: [
      taskEpisodeEvent({ type: "tool_start", name: "search", args }, { at: "2026-09-01T10:00:10.000Z" }),
      taskEpisodeEvent({ type: "tool_end", name: "search", result, durationMs: 100 }, { at: "2026-09-01T10:00:10.100Z" }),
      taskEpisodeEvent({ type: "model_call", model: "qwen", finishReason: "stop", inputTokens: 100, outputTokens: 20 }, { at: "2026-09-01T10:00:20.000Z" })
    ]
  });
  assert.equal(repeated.filePath, recorded.filePath);
  assert.equal((await store.list()).length, 1);

  await assert.rejects(
    store.record({
      taskId: "task-1",
      status: "failed",
      boundary: "online",
      model: "amos-hosted:auto",
      objective: "Private customer objective",
      startedAt: "2026-09-01T10:00:00.000Z",
      finishedAt: "2026-09-01T10:02:00.000Z",
      events: [],
      error: "later contradictory terminal state"
    }),
    /already finalized/
  );
});

test("non-outcome task episodes are explicitly blocked from export", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-task-episode-"));
  const store = new DesktopTaskEpisodeStore({ rootPath: root });
  const recorded = await store.record({
    taskId: "task-2",
    status: "failed",
    boundary: "personal",
    model: "local:qwen",
    objective: "Answer a question",
    startedAt: "2026-09-01T10:00:00.000Z",
    finishedAt: "2026-09-01T10:00:01.000Z",
    events: [],
    error: "private failure"
  });
  assert.equal(recorded.episode.outcome.outcomeBearing, false);
  assert.ok(recorded.episode.dataPolicy.exportBlockers.includes("not-an-outcome-bearing-task"));
});
