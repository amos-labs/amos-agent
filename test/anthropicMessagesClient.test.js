import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicMessagesClient } from "../src/model/anthropicMessagesClient.js";

function client(fetchImpl) {
  return new AnthropicMessagesClient(
    {
      displayName: "Anthropic",
      apiKey: "anthropic-test-key",
      apiVersion: "2023-06-01",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-5",
      reasoningEffort: "medium",
      maxCompletionTokens: 4_096,
      requestTimeoutMs: 5_000,
      capabilities: { tools: true, vision: true, reasoning: true }
    },
    fetchImpl
  );
}

test("Anthropic Messages maps system, tools, tool results, and native continuation blocks", async () => {
  let request;
  const priorContent = [
    { type: "thinking", thinking: "private state", signature: "signed-state" },
    { type: "tool_use", id: "toolu_1", name: "amos_lookup", input: { unit: "42" } }
  ];
  const fetchImpl = async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "msg_2",
      role: "assistant",
      content: [
        { type: "text", text: "Unit 42 is ahead." },
        { type: "tool_use", id: "toolu_2", name: "amos_score", input: { unit: "42" } }
      ],
      usage: { input_tokens: 80, output_tokens: 20 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await client(fetchImpl).chat({
    messages: [
      { role: "system", content: "Operate safely." },
      { role: "user", content: "Inspect unit 42." },
      {
        role: "assistant",
        content: "",
        provider_state: { protocol: "anthropic-messages", content: priorContent }
      },
      { role: "tool", tool_call_id: "toolu_1", content: "{\"ok\":true,\"revenue\":120}" }
    ],
    tools: [{
      type: "function",
      function: {
        name: "amos_score",
        description: "Score a business unit",
        parameters: { type: "object", properties: { unit: { type: "string" } } },
        strict: true
      }
    }]
  });

  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "anthropic-test-key");
  assert.equal(JSON.stringify(request.body).includes("anthropic-test-key"), false);
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.body.system, "Operate safely.");
  assert.deepEqual(request.body.output_config, { effort: "medium" });
  assert.deepEqual(request.body.tools, [{
    name: "amos_score",
    description: "Score a business unit",
    input_schema: { type: "object", properties: { unit: { type: "string" } } },
    strict: true
  }]);
  assert.deepEqual(request.body.messages[1], { role: "assistant", content: priorContent });
  assert.deepEqual(request.body.messages[2], {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: "{\"ok\":true,\"revenue\":120}"
    }]
  });
  assert.equal(result.message.content, "Unit 42 is ahead.");
  assert.deepEqual(result.message.tool_calls, [{
    id: "toolu_2",
    type: "function",
    function: { name: "amos_score", arguments: "{\"unit\":\"42\"}" }
  }]);
  assert.equal(result.message.provider_state.protocol, "anthropic-messages");
  assert.equal(result.usage.total_tokens, 100);
});

test("Anthropic Messages streaming preserves signed thinking and assembles tool input", async () => {
  const frames = [
    ["message_start", {
      type: "message_start",
      message: { content: [], usage: { input_tokens: 30, output_tokens: 1 } }
    }],
    ["content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" }
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "private state" }
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "signed-state" }
    }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "" }
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Checking " }
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "now." }
    }],
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    ["content_block_start", {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "toolu_1", name: "amos_lookup", input: {} }
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: "{\"unit\":" }
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: "\"42\"}" }
    }],
    ["content_block_stop", { type: "content_block_stop", index: 2 }],
    ["future_event", { type: "future_event", ignored: true }],
    ["message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 15 }
    }],
    ["message_stop", { type: "message_stop" }]
  ];
  const fetchImpl = async () => new Response(
    frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
  const deltas = [];
  const result = await client(fetchImpl).chat({
    messages: [{ role: "user", content: "Check unit 42" }],
    onDelta: (delta, text, meta = {}) => deltas.push({ delta, text, ...meta })
  });

  assert.equal(deltas[0].channel, "thinking");
  assert.equal(deltas[0].thinking, "private state");
  assert.deepEqual(deltas.slice(1), [
    { delta: "Checking ", text: "Checking " },
    { delta: "now.", text: "Checking now." }
  ]);
  assert.equal(result.message.content, "Checking now.");
  assert.equal(result.message.tool_calls[0].function.arguments, "{\"unit\":\"42\"}");
  assert.deepEqual(result.message.provider_state.content[0], {
    type: "thinking",
    thinking: "private state",
    signature: "signed-state"
  });
  assert.equal(result.usage.total_tokens, 45);
});

test("Anthropic Messages reports malformed streamed tool input after capturing its stop reason", async () => {
  const frames = [
    ["message_start", {
      type: "message_start",
      message: { content: [], usage: { input_tokens: 30, output_tokens: 1 } }
    }],
    ["content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_bad", name: "desktop_write", input: {} }
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: "{\"path\":\"unfinished" }
    }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", {
      type: "message_delta",
      delta: { stop_reason: "max_tokens" },
      usage: { output_tokens: 4_096 }
    }],
    ["message_stop", { type: "message_stop" }]
  ];
  const fetchImpl = async () => new Response(
    frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );

  await assert.rejects(
    client(fetchImpl).chat({
      messages: [{ role: "user", content: "Write the artifact" }],
      onDelta() {}
    }),
    (error) => {
      assert.equal(error.code, "AMOS_MODEL_INVALID_TOOL_ARGUMENTS");
      assert.equal(error.stopReason, "max_tokens");
      assert.equal(error.toolName, "desktop_write");
      assert.equal(error.truncated, true);
      assert.equal(error.argumentCharacters, 19);
      assert.equal(error.usage.total_tokens, 4_126);
      assert.match(error.message, /incomplete tool arguments/i);
      assert.doesNotMatch(error.message, /unfinished/);
      return true;
    }
  );
});

test("Anthropic Messages marks failed canonical tool results as errors", async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "I will recover." }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await client(fetchImpl).chat({
    messages: [
      { role: "user", content: "Run it" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "toolu_failed",
          type: "function",
          function: { name: "amos_lookup", arguments: "{}" }
        }]
      },
      { role: "tool", tool_call_id: "toolu_failed", content: "{\"ok\":false,\"error\":\"denied\"}" }
    ]
  });

  assert.equal(requestBody.messages[2].content[0].is_error, true);
});

test("Anthropic Messages translates the shared none setting into disabled thinking", async () => {
  let requestBody;
  const modelClient = client(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return Response.json({ content: [{ type: "text", text: "Direct answer." }] });
  });
  modelClient.config.reasoningEffort = "none";
  await modelClient.chat({ messages: [{ role: "user", content: "Answer directly" }] });
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.equal(requestBody.output_config, undefined);
});

test("Anthropic Messages supports a turn-local lower reasoning effort for recovery synthesis", async () => {
  let requestBody;
  const modelClient = client(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return Response.json({ content: [{ type: "text", text: "Recovered answer." }] });
  });
  await modelClient.chat({
    messages: [{ role: "user", content: "Synthesize completed work" }],
    reasoningEffortOverride: "low"
  });
  assert.deepEqual(requestBody.output_config, { effort: "low" });
});

test("Anthropic Messages identifies a reasoning-only response without exposing private thinking", async () => {
  const modelClient = client(async () => Response.json({
    content: [{ type: "thinking", thinking: "private analysis", signature: "signed" }],
    stop_reason: "max_tokens",
    usage: { input_tokens: 100, output_tokens: 4096 }
  }));

  await assert.rejects(
    modelClient.chat({ messages: [{ role: "user", content: "Finish the answer" }] }),
    (error) => {
      assert.equal(error.code, "AMOS_MODEL_REASONING_ONLY_RESPONSE");
      assert.equal(error.stopReason, "max_tokens");
      assert.deepEqual(error.contentBlockTypes, ["thinking"]);
      assert.equal(error.usage.total_tokens, 4196);
      assert.doesNotMatch(error.message, /private analysis/);
      return true;
    }
  );
});
