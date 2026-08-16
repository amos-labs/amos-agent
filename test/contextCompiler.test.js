import test from "node:test";
import assert from "node:assert/strict";
import {
  compileModelContext,
  estimateMessageTokens
} from "../src/model/contextCompiler.js";

test("context compiler preserves the task and bounds old tool evidence to the selected model", () => {
  const task = { role: "user", content: `Analyze this evidence\n${"a".repeat(10_000)}` };
  const messages = [
    { role: "system", content: "system" },
    task,
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "one", function: { name: "read_data", arguments: "{}" } }]
    },
    { role: "tool", tool_call_id: "one", content: JSON.stringify({ rows: "b".repeat(20_000) }) },
    { role: "assistant", content: "Continue with the measured evidence." }
  ];
  const compiled = compileModelContext({
    messages,
    tools: [{ type: "function", function: { name: "read_data", parameters: { type: "object" } } }],
    contextTokens: 4_096,
    maxOutputTokens: 1_024,
    activeTask: task
  });

  assert.equal(compiled.messages[0].role, "system");
  assert.equal(compiled.messages[1].role, "user");
  assert.match(compiled.messages[1].content, /Analyze this evidence/);
  assert.equal(compiled.plan.compacted, true);
  assert.ok(compiled.plan.compiledMessageTokens <= compiled.plan.messageTokenBudget);
  assert.ok(
    compiled.plan.estimatedInputTokens + compiled.plan.reservedOutputTokens + compiled.plan.safetyTokens <=
      compiled.plan.contextTokens
  );
});

test("context estimates image payloads without counting base64 transport bytes as text tokens", () => {
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: "Inspect this image" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${"x".repeat(200_000)}` } }
    ]
  }];
  assert.ok(estimateMessageTokens(messages) < 2_000);
});
