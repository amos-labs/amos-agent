import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleClient } from "../src/model/openAiCompatibleClient.js";

test("OpenAICompatibleClient sends Kimi K3 reasoning effort and tool definitions to Moonshot", async () => {
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
        usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 }
        });
      }
    };
  };

  const client = new OpenAICompatibleClient(
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
  assert.equal(result.usage.input_tokens, 80);
  assert.equal(result.usage.output_tokens, 40);
  assert.equal(result.usage.total_tokens, 120);
});
