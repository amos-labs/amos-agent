import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../src/agentLoop.js";
import { OpenAIResponsesClient } from "../src/model/openAiResponsesClient.js";
import { AnthropicMessagesClient } from "../src/model/anthropicMessagesClient.js";
import { ToolRegistry } from "../src/tools/registry.js";

function scoreRegistry() {
  const registry = new ToolRegistry();
  registry.register({
    name: "score_location",
    description: "Score one location",
    parameters: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
      additionalProperties: false
    },
    handler: async ({ location }) => ({ ok: true, location, score: 92 })
  });
  return registry;
}

function loop(modelClient, provider) {
  return new AgentLoop({
    config: { agent: {}, model: { provider, model: "fixture-model" } },
    modelClient,
    registry: scoreRegistry(),
    approvals: {},
    amosClient: {},
    workflowSelector: () => ({
      id: "fixture",
      version: 1,
      source: "test",
      title: "Fixture",
      summary: "Fixture",
      skills: [],
      steps: [],
      doneWhen: "answered"
    })
  });
}

test("the agent loop executes and continues an OpenAI Responses tool turn", async () => {
  let call = 0;
  const fetchImpl = async (_url, options) => {
    call += 1;
    const body = JSON.parse(options.body);
    if (call === 1) {
      assert.equal(body.tools[0].name, "score_location");
      return Response.json({
        output: [
          { type: "reasoning", id: "rs_1", encrypted_content: "state", summary: [] },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "score_location",
            arguments: "{\"location\":\"Austin\"}"
          }
        ]
      });
    }
    assert.ok(body.input.some((item) =>
      item.type === "reasoning" && item.encrypted_content === "state"
    ));
    assert.ok(body.input.some((item) =>
      item.type === "function_call_output" &&
      item.call_id === "call_1" &&
      JSON.parse(item.output).score === 92
    ));
    return Response.json({
      output: [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Austin scored 92." }]
      }]
    });
  };
  const modelClient = new OpenAIResponsesClient({
    displayName: "OpenAI",
    apiKey: "test",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-terra",
    requestTimeoutMs: 5_000,
    capabilities: { tools: true, reasoning: true }
  }, fetchImpl);

  assert.equal(await loop(modelClient, "openai").run("Score Austin"), "Austin scored 92.");
  assert.equal(call, 2);
});

test("the agent loop executes and continues an Anthropic Messages tool turn", async () => {
  let call = 0;
  const fetchImpl = async (_url, options) => {
    call += 1;
    const body = JSON.parse(options.body);
    if (call === 1) {
      assert.equal(body.tools[0].name, "score_location");
      return Response.json({
        content: [
          { type: "thinking", thinking: "private state", signature: "signed-state" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "score_location",
            input: { location: "Austin" }
          }
        ]
      });
    }
    const assistant = body.messages.find((message) => message.role === "assistant");
    assert.deepEqual(assistant.content[0], {
      type: "thinking",
      thinking: "private state",
      signature: "signed-state"
    });
    const result = body.messages.find((message) =>
      message.role === "user" && message.content.some((block) => block.type === "tool_result")
    );
    assert.equal(result.content[0].tool_use_id, "toolu_1");
    assert.equal(JSON.parse(result.content[0].content).score, 92);
    return Response.json({ content: [{ type: "text", text: "Austin scored 92." }] });
  };
  const modelClient = new AnthropicMessagesClient({
    displayName: "Anthropic",
    apiKey: "test",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5",
    maxCompletionTokens: 4_096,
    requestTimeoutMs: 5_000,
    capabilities: { tools: true, reasoning: true }
  }, fetchImpl);

  assert.equal(await loop(modelClient, "anthropic").run("Score Austin"), "Austin scored 92.");
  assert.equal(call, 2);
});
