import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIResponsesClient } from "../src/model/openAiResponsesClient.js";

function client(fetchImpl) {
  return new OpenAIResponsesClient(
    {
      displayName: "OpenAI",
      apiKey: "openai-test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      maxCompletionTokens: 4_096,
      requestTimeoutMs: 5_000,
      capabilities: { tools: true, vision: true, reasoning: true }
    },
    fetchImpl
  );
}

test("OpenAI Responses maps canonical tools, tool results, and stateless reasoning continuation", async () => {
  let request;
  const reasoning = {
    id: "rs_1",
    type: "reasoning",
    encrypted_content: "encrypted-state",
    summary: []
  };
  const priorCall = {
    id: "fc_1",
    type: "function_call",
    call_id: "call_1",
    name: "amos_lookup",
    arguments: "{\"location\":\"Austin\"}"
  };
  const fetchImpl = async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "resp_2",
      output: [
        {
          id: "msg_2",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Austin is ahead." }]
        },
        {
          id: "fc_2",
          type: "function_call",
          call_id: "call_2",
          name: "amos_score",
          arguments: "{\"location\":\"Austin\"}"
        }
      ],
      usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await client(fetchImpl).chat({
    messages: [
      { role: "system", content: "Operate the company safely." },
      { role: "user", content: "Compare Austin." },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "ignored-canonical-call",
          type: "function",
          function: { name: "ignored", arguments: "{}" }
        }],
        provider_state: { protocol: "openai-responses", output: [reasoning, priorCall] }
      },
      { role: "tool", tool_call_id: "call_1", content: "{\"revenue\":120}" }
    ],
    tools: [{
      type: "function",
      function: {
        name: "amos_score",
        description: "Score one location",
        parameters: { type: "object", properties: { location: { type: "string" } } },
        strict: true
      }
    }]
  });

  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.headers.Authorization, "Bearer openai-test-key");
  assert.equal(JSON.stringify(request.body).includes("openai-test-key"), false);
  assert.deepEqual(request.body.reasoning, { effort: "medium" });
  assert.deepEqual(request.body.include, ["reasoning.encrypted_content"]);
  assert.equal(request.body.store, false);
  assert.deepEqual(request.body.tools, [{
    type: "function",
    name: "amos_score",
    description: "Score one location",
    parameters: { type: "object", properties: { location: { type: "string" } } },
    strict: true
  }]);
  assert.deepEqual(request.body.input.slice(2), [
    reasoning,
    priorCall,
    { type: "function_call_output", call_id: "call_1", output: "{\"revenue\":120}" }
  ]);
  assert.equal(result.message.content, "Austin is ahead.");
  assert.deepEqual(result.message.tool_calls, [{
    id: "call_2",
    type: "function",
    function: { name: "amos_score", arguments: "{\"location\":\"Austin\"}" }
  }]);
  assert.equal(result.message.provider_state.protocol, "openai-responses");
  assert.equal(result.message.provider_state.output.length, 2);
  assert.equal(result.usage.total_tokens, 125);
});

test("OpenAI Responses streaming emits text and assembles a native function call", async () => {
  const output = [
    {
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Checking now." }]
    },
    {
      id: "fc_1",
      type: "function_call",
      call_id: "call_1",
      name: "amos_lookup",
      arguments: "{\"unit\":\"42\"}"
    }
  ];
  const frames = [
    ["response.output_text.delta", { type: "response.output_text.delta", delta: "Checking " }],
    ["response.future_event", { type: "response.future_event", ignored: true }],
    ["response.output_text.delta", { type: "response.output_text.delta", delta: "now." }],
    ["response.output_item.added", {
      type: "response.output_item.added",
      output_index: 1,
      item: { type: "function_call", call_id: "call_1", name: "amos_lookup", arguments: "" }
    }],
    ["response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      output_index: 1,
      delta: "{\"unit\":"
    }],
    ["response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      output_index: 1,
      delta: "\"42\"}"
    }],
    ["response.output_item.done", {
      type: "response.output_item.done",
      output_index: 1,
      item: output[1]
    }],
    ["response.completed", {
      type: "response.completed",
      response: { output, usage: { input_tokens: 20, output_tokens: 8 } }
    }]
  ];
  const fetchImpl = async () => new Response(
    frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
  const deltas = [];
  const result = await client(fetchImpl).chat({
    messages: [{ role: "user", content: "Check unit 42" }],
    onDelta: (delta, text) => deltas.push({ delta, text })
  });

  assert.deepEqual(deltas, [
    { delta: "Checking ", text: "Checking " },
    { delta: "now.", text: "Checking now." }
  ]);
  assert.equal(result.message.content, "Checking now.");
  assert.equal(result.message.tool_calls[0].function.name, "amos_lookup");
  assert.equal(result.message.tool_calls[0].function.arguments, "{\"unit\":\"42\"}");
  assert.equal(result.usage.total_tokens, 28);
});

test("OpenAI Responses streaming timeout measures inactivity instead of total active time", async () => {
  const encoder = new TextEncoder();
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(encoder.encode(
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"still "}\n\n'
        ));
      }, 35);
      setTimeout(() => {
        controller.enqueue(encoder.encode(
          'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"still working"}]}]}}\n\n'
        ));
        controller.close();
      }, 70);
    }
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
  const modelClient = client(fetchImpl);
  modelClient.config.requestTimeoutMs = 50;

  const result = await modelClient.chat({
    messages: [{ role: "user", content: "Do a longer job" }],
    onDelta: () => {}
  });

  assert.equal(result.message.content, "still working");
});

test("OpenAI Responses aborts the native request with the canonical task error", async () => {
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const controller = new AbortController();
  const pending = client(fetchImpl).chat({
    messages: [{ role: "user", content: "Keep working" }],
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

test("OpenAI Responses normalizes provider HTTP errors and request timeouts", async () => {
  await assert.rejects(
    client(async () => new Response(JSON.stringify({
      error: { message: "Rate limit reached", code: "throttled" }
    }), { status: 429 })).chat({ messages: [{ role: "user", content: "hello" }] }),
    (error) => {
      assert.match(error.message, /Rate limit reached/);
      assert.equal(error.status, 429);
      assert.equal(error.code, "throttled");
      return true;
    }
  );

  const modelClient = client((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  }));
  modelClient.config.requestTimeoutMs = 10;
  await assert.rejects(modelClient.chat({ messages: [{ role: "user", content: "hello" }] }), (error) => {
    assert.match(error.message, /OpenAI request timed out/);
    assert.equal(error.code, "AMOS_MODEL_TIMEOUT");
    assert.equal(error.timeoutMs, 10);
    assert.ok(error.inactiveMs >= 0);
    return true;
  });
});
