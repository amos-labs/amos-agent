import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DesktopController } from "../src/desktop/controller.js";
import { LocalReceiptStore, replayLocalReceiptDigest } from "../src/desktop/localReceiptStore.js";
import { DesktopTaskEpisodeStore } from "../src/desktop/taskEpisodeStore.js";

test("Desktop keeps checkpoint and interruption metadata when a guarded loop returns an answer", async () => {
  const harness = await outcomeHarness({
    outcome: { status: "interrupted", reason: "repeated_tool_request", verified: false },
    withTool: true
  });
  const result = await harness.controller.run({ text: "Inspect the latest CRM entries" });
  assert.equal(result.interrupted, true);
  assert.equal(result.answer, "Saved progress; another check is still needed.");
  const checkpoint = harness.checkpoints.get(result.taskId);
  assert.ok(checkpoint, "guarded completion must retain its recovery checkpoint");
  assert.equal(checkpoint.status, "interrupted");
  assert.equal(harness.removed.length, 0);
  const [receipt] = await harness.receipts.list();
  assert.equal(receipt.status, "interrupted");
  assert.deepEqual(receipt.events.at(-1), {
    type: "execution_outcome", name: "repeated_tool_request", outcome: "interrupted:unverified"
  });
  assert.equal(replayLocalReceiptDigest(receipt, { ownerSubjectId: "local-owner" }), receipt.digest);
  const [{ episode }] = await harness.episodes.list();
  assert.equal(episode.outcome.status, "interrupted");
  assert.equal(episode.outcome.outcomeBearing, false);
  assert.equal(episode.outcome.verified, false);
  assert.deepEqual(episode.outcome.executionOutcome, harness.outcome);
  assert.equal(episode.dataPolicy.exportEligible, false);
  assert.ok(!harness.metrics.includes("desktop_first_verified_outcome"));
  assert.ok(!harness.metrics.includes("northwind_demo_value_reached"));
  assert.equal(harness.loopCalls, 1);
});

test("Desktop completion clears its checkpoint without treating successful tools as independent verification", async () => {
  const harness = await outcomeHarness({
    outcome: { status: "completed", reason: "answer_returned", verified: false },
    withTool: true
  });
  const result = await harness.controller.run({ text: "Inspect the latest CRM entries" });
  assert.notEqual(result.interrupted, true);
  assert.equal(harness.checkpoints.has(result.taskId), false);
  assert.deepEqual(harness.removed, [result.taskId]);
  const [receipt] = await harness.receipts.list();
  assert.equal(receipt.status, "completed");
  assert.deepEqual(receipt.events.at(-1), {
    type: "execution_outcome", name: "answer_returned", outcome: "completed:unverified"
  });
  const [{ episode }] = await harness.episodes.list();
  assert.equal(episode.outcome.outcomeBearing, true, "preserve the legacy tool-success meaning");
  assert.equal(episode.outcome.verified, false);
  assert.deepEqual(episode.outcome.executionOutcome, harness.outcome);
  assert.equal(episode.dataPolicy.exportEligible, false);
  assert.ok(!harness.metrics.includes("desktop_first_verified_outcome"));
});

test("a simple Desktop question retains a single answer path without artifact review calls", async () => {
  const harness = await outcomeHarness({
    outcome: { status: "completed", reason: "answer_returned", verified: false },
    withTool: false
  });
  const result = await harness.controller.run({ text: "What is two plus two?" });
  assert.equal(result.answer, "Four.");
  assert.equal(harness.loopCalls, 1);
  assert.equal(harness.extraModelCalls, 0);
  assert.equal(result.codingLifecycle, null);
  assert.equal(result.deliverableLifecycle ?? null, null);
  assert.ok(!harness.messages.some(({ payload }) => payload?.type === "deliverable_lifecycle"));
  assert.ok(!harness.metrics.includes("desktop_first_verified_outcome"));
  const [{ episode }] = await harness.episodes.list();
  assert.equal(episode.outcome.outcomeBearing, false);
  assert.equal(episode.outcome.verified, false);
});

for (const reviewerFails of [false, true]) test(reviewerFails
  ? "Desktop accounts provider usage when site review fails and preserves an honest partial result"
  : "Desktop checks the exact saved page through two read-only status calls and accounts tool-free reviewer usage", async () => {
  const harness = await outcomeHarness({
    outcome: { status: "completed", reason: "answer_returned", verified: false }, withTool: false
  });
  const { controller } = harness;
  const runtimeState = await controller.getRuntime();
  const { runtime, config } = runtimeState;
  const source = "<!doctype html><html><head><title>Meet AMOS</title></head><body><h1>See what happens after the click</h1><a href='mailto:hello@example.test'>Get in touch</a></body></html>";
  const sha256 = createHash("sha256").update(source).digest("hex");
  const preview = "https://example.invalid/s/preview/synthetic-private-preview";
  const status = {
    slug: "synthetic-page", status: "draft", published_at: null,
    draft_manifest: { "index.html": { sha256, size: Buffer.byteLength(source), mime: "text/html" } },
    lead_form: { enabled: false }
  };
  const reads = [];
  const reviews = [];
  runtime.amosClient.callTool = async (name, args) => {
    reads.push({ name, args });
    assert.equal(name, "site_status", "checking must not publish, submit, or invoke arbitrary tools");
    assert.deepEqual(args, { slug: "synthetic-page" });
    return { content: [{ type: "text", text: JSON.stringify(status) }] };
  };
  runtime.modelClient.chat = async (request) => {
    reviews.push(request);
    assert.deepEqual(request.tools, []);
    const artifact = JSON.parse(request.messages[1].content);
    assert.equal(artifact.sources[0].source, source);
    assert.equal(artifact.sources[0].sha256, sha256);
    assert.equal(artifact.objective, "Create an unpublished landing page with a contact link");
    const usage = { prompt_tokens: 100, completion_tokens: 10, cost_used_microusd: 321 };
    if (reviewerFails) throw Object.assign(new Error("Synthetic reviewer transport failure"), { usage });
    return { message: { content: '{"pass":true,"issues":[]}' }, usage };
  };
  runtime.loop.run = async function(_content, options) {
    harness.loopCalls += 1;
    // Simulate the already-authorized authoring tool boundary; all returned
    // artifacts are synthetic and no network or real hosted write occurs.
    controller.observeHostedSiteToolOutcome({
      name: "amos_sites_put_site", args: { slug: "synthetic-page" },
      result: { slug: "synthetic-page", created: true, preview_url: preview }
    });
    const save = { name: "amos_sites_put_site_files", args: { slug: "synthetic-page", files: [{ path: "index.html", content: source }] } };
    assert.equal(controller.gateHostedSiteToolCall(save, runtime).allow, true);
    controller.observeHostedSiteToolOutcome({ ...save, result: { slug: "synthetic-page", written: 1 } });
    let check = await options.completionGate({ answer: "Draft ready", runtime, config, signal: options.signal });
    if (reviewerFails) {
      assert.equal(check.allow, false);
      check = await options.completionGate({ answer: "The review could not finish", runtime, config, signal: options.signal });
    }
    assert.equal(check.allow, true, JSON.stringify(check));
    this.lastOutcome = check.outcome;
    return check.answer;
  };
  controller.getRuntime = async () => {
    controller.runtime = runtimeState;
    return runtimeState;
  };
  const result = await controller.run({ text: "Create an unpublished landing page with a contact link" });
  assert.equal(reads.length, 2);
  assert.equal(reviews.length, reviewerFails ? 2 : 1);
  assert.equal(harness.loopCalls, 1);
  assert.equal(result.interrupted === true, reviewerFails);
  assert.match(result.answer, reviewerFails ? /checks remain unfinished/i : /source was checked/i);
  assert.ok(result.answer.includes(preview));
  assert.match(result.answer, /Visual.*end-to-end/);
  assert.equal(result.outcome.verified, false, "source review is not visual or lead-delivery verification");
  assert.ok(!harness.metrics.includes("desktop_first_verified_outcome"));
  const [receipt] = await harness.receipts.list();
  assert.equal(receipt.usage.totalTokens, 110 * reviews.length);
  assert.equal(receipt.usage.inputTokens, 100 * reviews.length);
  assert.equal(receipt.usage.outputTokens, 10 * reviews.length);
  assert.equal(receipt.usage.costUsedMicrousd, 321 * reviews.length);
  assert.equal(receipt.usage.estimated, false);
  const usageEvents = harness.messages.filter(({ channel, payload }) => channel === "agent:event" && payload?.type === "usage");
  assert.equal(usageEvents.length, reviews.length);
  for (const { payload } of usageEvents) {
    assert.equal(payload.totalTokens, 110);
    assert.equal(payload.costUsedMicrousd, 321);
    assert.equal(payload.responseRejected, reviewerFails);
  }
  const [{ episode }] = await harness.episodes.list();
  assert.equal(episode.outcome.verified, false);
  assert.equal(episode.dataPolicy.exportEligible, false);
  assert.doesNotMatch(JSON.stringify(episode), /<!doctype|synthetic-private-preview|hello@example\.test/);
});

async function outcomeHarness({ outcome, withTool }) {
  const root = await mkdtemp(join(tmpdir(), "amos-controller-outcome-"));
  const receipts = new LocalReceiptStore({
    filePath: join(root, "receipts.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8")
  });
  const episodes = new DesktopTaskEpisodeStore({ rootPath: join(root, "episodes") });
  const state = {
    receipts, episodes, outcome, loopCalls: 0, extraModelCalls: 0,
    metrics: [], messages: [], checkpoints: new Map(), removed: []
  };
  const settings = {
    operatingMode: "online", provider: "ollama", model: "qwen",
    workspace: root, baseUrl: "http://127.0.0.1:11434/v1", apiKey: "",
    reasoningEffort: "medium", amosMcpUrl: "https://example.invalid/mcp"
  };
  const checkpointStore = {
    async list() { return [...state.checkpoints.values()]; },
    async update(id, patch) {
      const updated = { ...state.checkpoints.get(id), ...patch };
      state.checkpoints.set(id, updated);
      return updated;
    },
    async remove(id) { state.removed.push(id); state.checkpoints.delete(id); }
  };
  const controller = new DesktopController({
    userDataPath: root,
    settingsStore: { read: async () => settings },
    localReceiptStore: receipts, taskEpisodeStore: episodes, taskCheckpointStore: checkpointStore,
    telemetry: { async record(name) { state.metrics.push(name); } },
    openBrowser() { throw new Error("This test must not open an external browser"); },
    emit(channel, payload) { state.messages.push({ channel, payload }); }
  });
  // Authentication/capture is an external boundary. Keep its initial checkpoint
  // local, then exercise the real run/finalization/progress paths against it.
  controller.startOnlineTaskCheckpoint = async ({ id, objective }) => {
    const checkpoint = { id, objective, status: "running" };
    state.checkpoints.set(id, checkpoint);
    controller.activeTask.checkpointed = true;
    return checkpoint;
  };
  controller.oauthFor = () => ({ status: async () => ({ demo: true, access_token: "synthetic-demo" }) });
  controller.sendTaskCheckpoints = async () => checkpointStore.list();
  const modelClient = {
    async complete() {
      state.extraModelCalls += 1;
      throw new Error("Unexpected extra model call for this basic task");
    }
  };
  const loop = {
    lastOutcome: null,
    async run(_content, options) {
      state.loopCalls += 1;
      if (withTool) {
        options.onEvent({ type: "tool_start", name: "amos_records_query", args: { collection: "contacts" } });
        options.onEvent({ type: "tool_end", name: "amos_records_query", result: { ok: true, count: 1 }, durationMs: 1 });
      }
      this.lastOutcome = outcome;
      return withTool ? "Saved progress; another check is still needed." : "Four.";
    }
  };
  controller.getRuntime = async () => ({
    config: { model: { capabilities: { vision: false } } },
    runtime: {
      modelClient, loop,
      amosClient: { async callTool() { throw new Error("No remote tool calls allowed in this regression"); } }
    }
  });
  return Object.assign(state, { controller });
}
