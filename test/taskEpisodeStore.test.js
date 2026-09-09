import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DesktopTaskEpisodeStore,
  taskEpisodeEvent
} from "../src/desktop/taskEpisodeStore.js";

test("Desktop stores an immutable digest-only episode per terminal task attempt", async () => {
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
  const episode = JSON.parse(contents);
  assert.equal(episode.schema, "amos.desktop-task-episode");
  assert.equal(episode.schemaVersion, 1);
  assert.equal(episode.outcome.outcomeBearing, true);
  assert.equal(episode.dataPolicy.exportEligible, false);
  assert.equal(episode.events[0].argsSha256.length, 64);
  assert.equal(episode.events[1].resultSha256.length, 64);
  assert.equal(episode.events[2].finishReason, "stop");
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

test("a resumed task preserves both its interruption and completed outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-task-episode-"));
  const store = new DesktopTaskEpisodeStore({ rootPath: root });
  const interrupted = await store.record({
    taskId: "task.resume.with.dots",
    status: "interrupted",
    boundary: "online",
    model: "amos-hosted:auto",
    objective: "Finish safely after sleep",
    startedAt: "2026-09-01T10:00:00.000Z",
    finishedAt: "2026-09-01T10:01:00.000Z",
    events: [taskEpisodeEvent({ type: "phase", phase: "interrupted" })],
    error: "system_sleep"
  });
  const completed = await store.record({
    taskId: "task.resume.with.dots",
    status: "completed",
    boundary: "online",
    model: "amos-hosted:auto",
    objective: "Finish safely after sleep",
    startedAt: "2026-09-01T10:05:00.000Z",
    finishedAt: "2026-09-01T10:06:00.000Z",
    events: [taskEpisodeEvent({ type: "tool_end", name: "verify", result: { ok: true } })]
  });

  assert.notEqual(interrupted.filePath, completed.filePath);
  assert.equal(interrupted.episode.outcome.status, "interrupted");
  assert.equal(completed.episode.outcome.status, "completed");
  assert.equal(completed.episode.outcome.outcomeBearing, true);
  assert.equal((await store.list()).length, 2);
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

test("task episodes separate successful tool execution from independent verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-task-verification-"));
  const store = new DesktopTaskEpisodeStore({ rootPath: root });
  const toolEvent = taskEpisodeEvent({ type: "tool_end", name: "save", result: { ok: true } }, {
    at: "2026-09-09T10:00:01.000Z"
  });
  const cases = [
    { id: "answer", events: [], reason: "answer_returned", verified: false, bearing: false },
    { id: "tool-only", events: [toolEvent], reason: "answer_returned", verified: false, bearing: true },
    { id: "checked", events: [toolEvent], reason: "verified_delivery", verified: true, bearing: true }
  ];
  for (const item of cases) {
    const input = {
      taskId: item.id, status: "completed", events: item.events,
      startedAt: "2026-09-09T10:00:00.000Z", finishedAt: "2026-09-09T10:01:00.000Z",
      executionOutcome: { status: "completed", reason: item.reason, verified: item.verified }
    };
    const recorded = await store.record(input);
    assert.equal(recorded.episode.outcome.outcomeBearing, item.bearing);
    assert.equal(recorded.episode.outcome.verified, item.verified);
    assert.deepEqual(recorded.episode.outcome.executionOutcome, input.executionOutcome);
    assert.equal(recorded.episode.dataPolicy.exportEligible, false);
    assert.ok(recorded.episode.dataPolicy.exportBlockers.includes("training-consent-not-recorded"));
    assert.equal((await store.record(input)).episodeDigest, recorded.episodeDigest);
  }
});

test("interrupted task metadata overrides a stale completed status without exporting raw content", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-task-interrupted-metadata-"));
  const store = new DesktopTaskEpisodeStore({ rootPath: root });
  const recorded = await store.record({
    taskId: "interrupted-task", status: "completed",
    startedAt: "2026-09-09T10:00:00.000Z", finishedAt: "2026-09-09T10:01:00.000Z",
    events: [taskEpisodeEvent({ type: "tool_end", name: "save", result: { ok: true } })],
    executionOutcome: {
      status: "interrupted", reason: "private-reason-token", verified: true,
      evidence: { content: "private-page-content" }, prompt: "private-prompt"
    }
  });
  assert.equal(recorded.episode.outcome.status, "interrupted");
  assert.equal(recorded.episode.outcome.outcomeBearing, false);
  assert.equal(recorded.episode.outcome.verified, false);
  assert.deepEqual(recorded.episode.outcome.executionOutcome, {
    status: "interrupted", reason: "incomplete", verified: false
  });
  assert.doesNotMatch(await readFile(recorded.filePath, "utf8"), /private-reason-token|private-page-content|private-prompt/);
  assert.equal(recorded.episode.dataPolicy.exportEligible, false);
});

test("legacy task episodes keep their digest shape and cancellation metadata uses the existing terminal spelling", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-task-outcome-compatibility-"));
  const store = new DesktopTaskEpisodeStore({ rootPath: root });
  const common = {
    startedAt: "2026-09-09T10:00:00.000Z", finishedAt: "2026-09-09T10:01:00.000Z",
    status: "completed", events: []
  };
  const legacy = await store.record({ ...common, taskId: "legacy" });
  assert.deepEqual(Object.keys(legacy.episode.outcome), ["status", "outcomeBearing", "errorSha256"]);
  assert.equal((await store.record({ ...common, taskId: "legacy" })).episodeDigest, legacy.episodeDigest);
  const canceled = await store.record({
    ...common, taskId: "canceled",
    executionOutcome: { status: "cancelled", reason: "user_cancelled", verified: true }
  });
  assert.equal(canceled.episode.outcome.status, "canceled");
  assert.equal(canceled.episode.outcome.verified, false);
});
