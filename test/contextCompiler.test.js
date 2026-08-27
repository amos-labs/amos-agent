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

test("context compiler compacts to a preferred local input budget before the hard limit", () => {
  const task = { role: "user", content: "Keep the current objective intact" };
  const messages = [
    { role: "system", content: "system" },
    task,
    { role: "assistant", content: "x".repeat(28_000) },
    { role: "user", content: "Use the evidence and continue" },
    { role: "assistant", content: "y".repeat(12_000) }
  ];
  const compiled = compileModelContext({
    messages,
    contextTokens: 32_768,
    maxOutputTokens: 4_096,
    preferredInputTokens: 4_096,
    activeTask: task
  });

  assert.equal(compiled.plan.compacted, true);
  assert.equal(compiled.plan.compactionReason, "preferred_input_budget");
  assert.equal(compiled.plan.preferredInputTokens, 4_096);
  assert.ok(compiled.plan.estimatedInputTokens <= 4_096);
  assert.match(compiled.messages[1].content, /current objective/);
});

test("hosted cell estimates compact a long tool session into the live 32k window", () => {
  const task = { role: "user", content: "Load company financials and continue" };
  const messages = [
    { role: "system", content: "system" },
    task,
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "one", function: { name: "amos_list_engines", arguments: "{}" } }]
    },
    { role: "tool", tool_call_id: "one", content: JSON.stringify({ engines: "e".repeat(40_000) }) },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "two", function: { name: "amos_load_engine_tools", arguments: "{\"engine\":\"finance\"}" } }]
    },
    { role: "tool", tool_call_id: "two", content: JSON.stringify({ tools: "t".repeat(40_000) }) },
    { role: "user", content: "What do you see?" }
  ];
  const compiled = compileModelContext({
    messages,
    tools: [{ type: "function", function: { name: "amos_list_engines", parameters: { type: "object" } } }],
    contextTokens: 32_768,
    maxOutputTokens: 32_768,
    charsPerToken: 2,
    activeTask: task
  });

  assert.equal(compiled.plan.compacted, true);
  assert.equal(compiled.plan.contextTokens, 32_768);
  assert.ok(compiled.plan.compiledMessageTokens <= compiled.plan.messageTokenBudget);
  assert.ok(
    compiled.plan.estimatedInputTokens + compiled.plan.reservedOutputTokens + compiled.plan.safetyTokens
      <= compiled.plan.contextTokens
  );
});

test("hard context pressure takes precedence over the preferred local budget", () => {
  const task = { role: "user", content: "Keep this task" };
  const compiled = compileModelContext({
    messages: [
      { role: "system", content: "system" },
      task,
      { role: "assistant", content: "x".repeat(24_000) }
    ],
    contextTokens: 4_096,
    maxOutputTokens: 1_024,
    preferredInputTokens: 1_024,
    activeTask: task
  });

  assert.equal(compiled.plan.compacted, true);
  assert.equal(compiled.plan.preferredBudgetExceeded, true);
  assert.equal(compiled.plan.compactionReason, "context_limit");
});
