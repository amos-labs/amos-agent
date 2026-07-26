import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleClient } from "../src/model/openAiCompatibleClient.js";

function client(fetchImpl) {
  return new OpenAICompatibleClient(
    {
      apiKey: "test",
      baseUrl: "https://models.example/v1",
      model: "test-model",
      requestTimeoutMs: 5_000,
      capabilities: { tools: true }
    },
    fetchImpl
  );
}

test("OpenAI-compatible streaming emits text deltas and assembles tool calls", async () => {
  let requestBody;
  const events = [
    { choices: [{ delta: { role: "assistant", content: "Checking " } }] },
    { choices: [{ delta: { content: "now." } }] },
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "amos_", arguments: "{\"engine\":" }
          }]
        }
      }]
    },
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { name: "list_engines", arguments: "\"company\"}" }
          }]
        }
      }]
    }
  ];
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    const body = events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("") + "data: [DONE]\n\n";
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };
  const deltas = [];
  const result = await client(fetchImpl).chat({
    messages: [{ role: "user", content: "hello" }],
    tools: [{ type: "function", function: { name: "amos_list_engines" } }],
    onDelta: (delta, text) => deltas.push({ delta, text })
  });

  assert.equal(requestBody.stream, true);
  assert.deepEqual(deltas, [
    { delta: "Checking ", text: "Checking " },
    { delta: "now.", text: "Checking now." }
  ]);
  assert.equal(result.message.content, "Checking now.");
  assert.deepEqual(result.message.tool_calls, [{
    id: "call-1",
    type: "function",
    function: {
      name: "amos_list_engines",
      arguments: "{\"engine\":\"company\"}"
    }
  }]);
});

test("OpenAI-compatible streaming aborts the actual request", async () => {
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  const controller = new AbortController();
  const pending = client(fetchImpl).chat({
    messages: [{ role: "user", content: "work forever" }],
    onDelta: () => {},
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, "AMOS_TASK_CANCELED");
    return true;
  });
});

test("streaming request remains compatible with endpoints that return one JSON response", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "One response" } }],
      usage: { total_tokens: 4 }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  const deltas = [];
  const result = await client(fetchImpl).chat({
    messages: [{ role: "user", content: "hello" }],
    onDelta: (delta) => deltas.push(delta)
  });
  assert.equal(result.message.content, "One response");
  assert.deepEqual(deltas, ["One response"]);
});
