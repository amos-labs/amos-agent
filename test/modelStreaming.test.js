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
  assert.equal(result.usage.model, "test-model");
  assert.ok(result.usage.latency_ms >= 0);
  assert.ok(result.usage.time_to_first_output_ms >= 0);
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

test("OpenAI-compatible timeout reports the safe stalled request phase", async () => {
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const timeoutClient = client(fetchImpl);
  timeoutClient.config.requestTimeoutMs = 10;
  const keepTestAlive = setTimeout(() => {}, 1_000);

  try {
    await assert.rejects(
      timeoutClient.chat({ messages: [{ role: "user", content: "hello" }] }),
      (error) => {
        assert.equal(error.code, "AMOS_MODEL_TIMEOUT");
        assert.equal(error.phase, "awaiting_response");
        assert.equal(error.timeoutMs, 10);
        assert.ok(error.elapsedMs >= 0);
        assert.ok(error.inactiveMs >= 0);
        return true;
      }
    );
  } finally {
    clearTimeout(keepTestAlive);
  }
});

test("OpenAI-compatible streaming timeout measures inactivity rather than total active time", async () => {
  const encoder = new TextEncoder();
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"still "}}]}\n\n'));
      }, 35);
      setTimeout(() => {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"working"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }, 70);
    }
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
  const streamingClient = client(fetchImpl);
  streamingClient.config.requestTimeoutMs = 50;
  const result = await streamingClient.chat({
    messages: [{ role: "user", content: "do a longer job" }],
    onDelta: () => {}
  });
  assert.equal(result.message.content, "still working");
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
  assert.equal(result.usage.model, "test-model");
  assert.ok(result.usage.time_to_first_output_ms >= 0);
});

test("OpenAI-compatible responses retain native local timing diagnostics", async () => {
  const result = await client(async () => new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: "Done" } }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    load_duration: 1_500_000_000,
    prompt_eval_duration: 500_000_000,
    eval_duration: 2_000_000_000,
    mtplx_stats: {
      session_cache_hit: true,
      cached_tokens: 18,
      new_prefill_tokens: 2,
      cache_source: "live_frontier",
      request_session_source: "x-mtplx-session-id",
      ssd_cache_hit: false
    }
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  })).chat({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(result.usage.load_ms, 1_500);
  assert.equal(result.usage.prompt_eval_ms, 500);
  assert.equal(result.usage.generation_ms, 2_000);
  assert.equal(result.usage.model, "test-model");
  assert.equal(result.usage.cache_read_input_tokens, 18);
  assert.equal(result.usage.new_prefill_tokens, 2);
  assert.equal(result.usage.session_cache_hit, true);
  assert.equal(result.usage.cache_source, "live_frontier");
  assert.equal(result.usage.request_session_source, "x-mtplx-session-id");
});

test("local compatible endpoints receive opaque MTPLX session affinity headers only", async () => {
  let localHeaders;
  const local = new OpenAICompatibleClient({
    apiKey: "local",
    deployment: "local",
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "qwen",
    requestTimeoutMs: 5_000,
    capabilities: { tools: true }
  }, async (_url, options) => {
    localHeaders = options.headers;
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Done" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await local.chat({
    messages: [{ role: "user", content: "hello" }],
    promptSessionId: "amos-opaque-session",
    promptContractHash: "a".repeat(64)
  });

  let cloudHeaders;
  await client(async (_url, options) => {
    cloudHeaders = options.headers;
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Done" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }).chat({
    messages: [{ role: "user", content: "hello" }],
    promptSessionId: "amos-opaque-session",
    promptContractHash: "a".repeat(64)
  });

  assert.equal(localHeaders["X-MTPLX-Session-ID"], "amos-opaque-session");
  assert.equal(localHeaders["X-AMOS-Prompt-Contract"], "a".repeat(64));
  assert.equal(cloudHeaders["X-MTPLX-Session-ID"], undefined);
  assert.equal(cloudHeaders["X-AMOS-Prompt-Contract"], undefined);
});

test("streaming responses retain native local timing diagnostics from the final event", async () => {
  const events = [
    { choices: [{ delta: { role: "assistant", content: "Done" } }] },
    {
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      load_duration: 1_500_000_000,
      prompt_eval_duration: 500_000_000,
      eval_duration: 2_000_000_000
    }
  ];
  const result = await client(async () => new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } }
  )).chat({
    messages: [{ role: "user", content: "hello" }],
    onDelta: () => {}
  });

  assert.equal(result.usage.load_ms, 1_500);
  assert.equal(result.usage.prompt_eval_ms, 500);
  assert.equal(result.usage.generation_ms, 2_000);
});
