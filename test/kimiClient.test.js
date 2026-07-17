import test from "node:test";
import assert from "node:assert/strict";
import { KimiClient } from "../src/model/kimiClient.js";

test("KimiClient sends K3 reasoning effort and tool definitions", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { total_tokens: 1 }
        });
      }
    };
  };

  const client = new KimiClient(
    {
      apiKey: "test",
      baseUrl: "https://api.moonshot.ai/v1",
      model: "kimi-k3",
      reasoningEffort: "max",
      maxCompletionTokens: 8192
    },
    fetchImpl
  );

  const result = await client.chat({
    messages: [{ role: "user", content: "hello" }],
    tools: [{ type: "function", function: { name: "noop", parameters: { type: "object" } } }]
  });

  assert.equal(captured.url, "https://api.moonshot.ai/v1/chat/completions");
  assert.equal(captured.body.model, "kimi-k3");
  assert.equal(captured.body.reasoning_effort, "max");
  assert.equal(captured.body.tools[0].function.name, "noop");
  assert.equal(result.message.content, "ok");
});
