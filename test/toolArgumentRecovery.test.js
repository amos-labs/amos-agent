import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../src/agentLoop.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { OpenAICompatibleClient } from "../src/model/openAiCompatibleClient.js";
import { assertValidModelToolArguments } from "../src/model/protocol.js";
import { DesktopController } from "../src/desktop/controller.js";
import { taskEpisodeEvent } from "../src/desktop/taskEpisodeStore.js";
import { resolveModelConfig } from "../src/model/providers.js";

const config = {
  displayName: "AMOS Intelligence", provider: "amos-hosted",
  baseUrl: "https://fixture.invalid/v1", model: "fixture-model",
  requestTimeoutMs: 5000, capabilities: { tools: true }
};
const toolCall = (name, args, index = 0) => ({
  index, id: `call-${index}`, type: "function", function: { name, arguments: args }
});
function streamed(calls, reason = "tool_calls", content = "", trailer = {}) {
  const frames = [
    { choices: [{ delta: { role: "assistant", content, tool_calls: calls } }] },
    { choices: [{ delta: {}, finish_reason: reason }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, ...trailer }
  ];
  return new Response(frames.map((x) => `data: ${JSON.stringify(x)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" }
  });
}

test("trailing stream usage retains the output-limit reason for invalid arguments", async () => {
  const client = new OpenAICompatibleClient(config, async () => streamed([
    toolCall("save_note", '{"note":"private unfinished value')
  ], "length"));
  const response = await client.chat({ messages: [{ role: "user", content: "Save a note" }], onDelta() {} });
  assert.equal(response.usage.total_tokens, 120);
  assert.throws(() => assertValidModelToolArguments(response, config), (error) => {
    assert.equal(error.truncated, true);
    assert.equal(error.stopReason, "length");
    assert.equal(error.toolName, "save_note");
    assert.match(error.message, /save_note/);
    assert.doesNotMatch(error.message, /private unfinished value/);
    return true;
  });
});

test("proxy terminal stop cannot hide an earlier output limit or tool-call finish", async () => {
  for (const reason of ["length", "max_tokens", "tool_calls"]) {
    const client = new OpenAICompatibleClient(config, async () => streamed([
      toolCall("save_note", '{"note":"unfinished')
    ], reason, "", { choices: [{ delta: {}, finish_reason: "stop" }] }));
    const response = await client.chat({ messages: [], onDelta() {} });
    assert.equal(response.stopReason, reason);
    assert.equal(response.usage.total_tokens, 120);
    assert.throws(() => assertValidModelToolArguments(response, config), (error) => {
      assert.equal(error.truncated, reason !== "tool_calls");
      return true;
    });
  }
});

for (const recover of [true, false]) {
  test(`failed attempts retain serving evidence and token totals when ${recover ? "recovered" : "exhausted"}`, async () => {
    const hosted = resolveModelConfig({ AMOS_MODEL_PROVIDER: "amos-hosted", AMOS_HOSTED_TIER: "frontier" });
    const registry = new ToolRegistry();
    let requests = 0, writes = 0;
    registry.register({ name: "save_note", handler: async () => { writes++; return { ok: true }; } });
    const client = new OpenAICompatibleClient(hosted, async () => {
      requests++;
      const amos = {
        served_model: requests === 1 ? "opus-5" : "stage1-060408-r32-s5",
        frontier_route: requests === 1 ? "opus" : "canary",
        routed_tier: "frontier", provider_calls: 1, correlation_id: `attempt-${requests}`
      };
      return streamed(requests === 4 ? [] : [
        toolCall("save_note", recover && requests === 3 ? "{}" : '{"note":"PRIVATE_REJECTED_VALUE')
      ], requests <= 2 || !recover ? "length" : "tool_calls", requests === 4 ? "Saved." : "", {
        choices: [{ delta: {}, finish_reason: "stop" }], amos
      });
    });
    const controller = new DesktopController({ userDataPath: "/tmp/amos-failed-serving-evidence",
      settingsStore: {}, openBrowser() {}, emit() {} });
    const task = { usage: {} }, usageEvents = [], episodes = [], routing = [];
    const loop = new AgentLoop({ config: { model: hosted, agent: { maxModelTransientRetries: 2 } },
      registry, approvals: {}, amosClient: {}, modelClient: client });
    const run = loop.run("Save the note", { onEvent: (event) => {
      if (event.type === "usage") usageEvents.push(controller.annotateUsageEvent(event, task));
      if (event.type === "model_call") episodes.push(taskEpisodeEvent(controller.annotateUsageEvent(event, task)));
      if (event.type === "routing") routing.push(controller.annotateUsageEvent(event, task));
    } });
    if (recover) assert.equal(await run, "Saved.");
    else await assert.rejects(run, { code: "AMOS_MODEL_INVALID_TOOL_ARGUMENTS" });
    assert.equal(writes, recover ? 1 : 0);
    assert.equal(requests, recover ? 4 : 3);
    assert.equal(usageEvents.length, requests);
    assert.equal(episodes.length, requests);
    assert.equal(task.usage.totalTokens, requests * 120);
    const failures = usageEvents.filter(event => event.responseRejected);
    assert.equal(failures.length, recover ? 2 : 3);
    assert.equal(failures[0].servedModel, "opus-5");
    assert.equal(failures[0].frontierRoute, "opus");
    assert.equal(failures[1].servedModel, "stage1-060408-r32-s5");
    assert.equal(failures[1].frontierRoute, "canary");
    for (const [index, event] of failures.entries()) {
      assert.equal(event.correlationId, `attempt-${index + 1}`);
      assert.equal(event.finishReason, "length");
      assert.equal(event.outputTruncated, true);
      assert.equal(event.toolName, "save_note");
      assert.equal(episodes[index].responseRejected, true);
      assert.equal(episodes[index].correlationId, event.correlationId);
      assert.equal(episodes[index].servedModel, event.servedModel);
    }
    assert.equal(routing.filter(event => event.status === "resolved")[0].servedModel, "opus-5");
    assert.doesNotMatch(JSON.stringify({ usageEvents, episodes, routing }), /PRIVATE_REJECTED_VALUE/);
  });
}

test("a rejected Frontier response without serving metadata retains unknown identity", async () => {
  const client = new OpenAICompatibleClient(config, async () => streamed([toolCall("save_note", "[1]")]));
  const usage = [];
  const loop = new AgentLoop({ config: { model: config, agent: { maxModelTransientRetries: 0 } },
    registry: new ToolRegistry(), approvals: {}, amosClient: {}, modelClient: client });
  await assert.rejects(loop.run("Save the note", { onEvent: event => {
    if (event.type === "usage") usage.push(event);
  } }));
  assert.equal(usage.length, 1);
  assert.equal(usage[0].servedModel, null);
  assert.equal(usage[0].frontierRoute, null);
  assert.equal(usage[0].correlationId, null);
});

test("real streaming client retries with the failing tool schema and executes only the corrected call", async () => {
  const registry = new ToolRegistry();
  const saved = [], requests = [], events = [];
  registry.register({ name: "save_note", description: "Save one note.",
    parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"], additionalProperties: false },
    handler: async ({ note }) => { saved.push(note); return { ok: true }; }
  });
  const modelClient = new OpenAICompatibleClient(config, async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) return streamed([toolCall("save_note", '{"note":"unfinished')], "length");
    if (requests.length === 2) return streamed([toolCall("save_note", '{"note":"checked"}')]);
    return streamed([], "stop", "Saved.");
  });
  const loop = new AgentLoop({ config: { model: config, agent: { maxModelTransientRetries: 2 } }, registry,
    approvals: {}, amosClient: {}, modelClient });
  assert.equal(await loop.run("Save the note", { onEvent: (event) => events.push(event) }), "Saved.");
  assert.deepEqual(saved, ["checked"]);
  assert.equal(requests.length, 3);
  const correction = requests[1].messages.find((m) => String(m.content).includes("<amos_tool_call_correction>"));
  assert.match(correction.content, /output limit/);
  assert.match(correction.content, /"required":\["note"\]/);
  assert.match(correction.content, /"additionalProperties":false/);
  assert.doesNotMatch(correction.content, /\{"note":"unfinished/);
  assert.ok(events.some((event) => event.phase === "retrying" && /save_note/.test(event.summary)));
  assert.ok(!requests[2].messages.some((m) => String(m.content).includes("<amos_tool_call_correction>")));
});

test("exhausted malformed batches never execute their valid sibling and report the bounded retry count", async () => {
  const registry = new ToolRegistry();
  let writes = 0, requests = 0;
  registry.register({ name: "save_note", handler: async () => { writes++; return { ok: true }; } });
  const modelClient = new OpenAICompatibleClient(config, async () => {
    requests++;
    return streamed([toolCall("save_note", "{}"), toolCall("save_note", "[1]", 1)]);
  });
  const loop = new AgentLoop({ config: { model: config, agent: { maxModelTransientRetries: 2 } }, registry,
    approvals: {}, amosClient: {}, modelClient });
  await assert.rejects(loop.run("Save a note"), (error) => {
    assert.equal(error.code, "AMOS_MODEL_INVALID_TOOL_ARGUMENTS");
    assert.equal(error.argumentProblem, "non_object");
    assert.equal(error.modelRetries, 2);
    assert.match(error.message, /save_note/);
    assert.match(error.message, /2 automatic retries/);
    assert.match(error.message, /No tool from the rejected response ran/);
    return true;
  });
  assert.equal(requests, 3);
  assert.equal(writes, 0);
});
