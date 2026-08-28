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

test("hosted 64k reserves conversation room instead of a quarter of the window for output", () => {
  const compiled = compileModelContext({
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "Update tax_behavior to inclusive on these three Stripe prices" }
    ],
    contextTokens: 65_536,
    maxOutputTokens: 32_768,
    charsPerToken: 2
  });

  assert.equal(compiled.plan.contextTokens, 65_536);
  assert.equal(compiled.plan.reservedOutputTokens, 8_192);
  assert.ok(compiled.plan.messageTokenBudget > 40_000);
  assert.equal(compiled.plan.compacted, false);
});

test("hosted 64k keeps a multi-job operator thread without compacting", () => {
  const tax = {
    role: "user",
    content: "Update tax_behavior to inclusive on price_1ABC, price_1DEF, and price_1GHI"
  };
  const followUp = { role: "user", content: "this issue should be fixed...lets try it again" };
  const compiled = compileModelContext({
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "Help me build a Stripe to QuickBooks integration" },
      { role: "assistant", content: "I will inspect the live Stripe and QBO connections." },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "list", function: { name: "list_connections", arguments: "{}" } }]
      },
      {
        role: "tool",
        tool_call_id: "list",
        content: JSON.stringify({ connections: ["stripe", "quickbooks"], ok: true })
      },
      { role: "user", content: "We need to add these accounts to QBO" },
      { role: "assistant", content: "Adding the QBO accounts next." },
      tax,
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "price-1",
          function: {
            name: "connection_call",
            arguments: JSON.stringify({
              connection: "stripe",
              method: "POST",
              path: "/v1/prices/price_1ABC"
            })
          }
        }]
      },
      {
        role: "tool",
        tool_call_id: "price-1",
        content: JSON.stringify({
          status: 403,
          ok: false,
          path: "/v1/prices/price_1ABC",
          error: "form-urlencoded required",
          body: "<html>403 Forbidden</html>"
        })
      },
      followUp
    ],
    contextTokens: 65_536,
    maxOutputTokens: 8_192,
    charsPerToken: 2,
    activeTask: followUp,
    scratchpad: {
      currentJob: tax.content,
      jobs: [
        { title: "Help me build a Stripe to QuickBooks integration", status: "parked" },
        { title: "We need to add these accounts to QBO", status: "parked" },
        { title: tax.content, status: "current" }
      ]
    }
  });

  assert.equal(compiled.plan.compacted, false);
  assert.ok(
    compiled.messages.some((message) =>
      message.role === "tool" && /403/.test(String(message.content)) && /price_1ABC/.test(String(message.content))
    )
  );
  const text = compiled.messages.map((message) => String(message.content)).join("\n");
  assert.match(text, /<amos_scratchpad>/);
  assert.match(text, /Stripe to QuickBooks integration/);
  assert.match(text, /lets try it again/);
});

test("compaction pins recent user statements, not the first chat message", () => {
  const greeting = { role: "user", content: "hey" };
  const tax = {
    role: "user",
    content: "Update tax_behavior to inclusive on these three Stripe prices"
  };
  const followUp = { role: "user", content: "this issue should be fixed...lets try it again" };
  const compiled = compileModelContext({
    messages: [
      { role: "system", content: "system" },
      greeting,
      { role: "assistant", content: "hello" },
      { role: "user", content: "ok" },
      { role: "assistant", content: "ready" },
      { role: "user", content: "thanks" },
      { role: "assistant", content: "x".repeat(80_000) },
      tax,
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "one", function: { name: "connection_call", arguments: "{}" } }]
      },
      {
        role: "tool",
        tool_call_id: "one",
        content: JSON.stringify({ status: 403, body: "<html>403 Forbidden</html>", ok: false })
      },
      followUp
    ],
    contextTokens: 4_096,
    maxOutputTokens: 1_024,
    charsPerToken: 2,
    activeTask: followUp,
    workingObjective: tax.content,
    recentJobs: [
      "Help me build a Stripe to QuickBooks integration",
      "We need to add these accounts to QBO",
      tax.content
    ]
  });

  const userText = compiled.messages
    .filter((message) => message.role === "user")
    .map((message) => String(message.content))
    .join("\n");
  assert.match(userText, /Update tax_behavior to inclusive/);
  assert.match(userText, /lets try it again/);
  assert.ok(
    compiled.messages.some((message) =>
      message.role === "tool" && /403|Forbidden/.test(String(message.content))
    )
  );
  const compiledText = compiled.messages.map((message) => String(message.content)).join("\n");
  assert.match(compiledText, /desktop_inspect_conversation/);
  assert.match(compiledText, /<amos_scratchpad>/);
  assert.match(compiledText, /add these accounts to QBO/);
  assert.match(compiledText, /Stripe to QuickBooks integration/);
});

test("scratch pad is injected even when the window is not compacted", () => {
  const compiled = compileModelContext({
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "try again" }
    ],
    contextTokens: 32_768,
    maxOutputTokens: 1_024,
    workingObjective: "Update tax_behavior to inclusive on these three Stripe prices",
    recentJobs: [
      "Help me build a Stripe to QuickBooks integration",
      "We need to add these accounts to QBO"
    ],
    scratchpad: {
      currentJob: "Update tax_behavior to inclusive on these three Stripe prices",
      jobs: [
        { title: "Help me build a Stripe to QuickBooks integration", status: "parked" },
        { title: "We need to add these accounts to QBO", status: "parked" },
        { title: "Update tax_behavior to inclusive on these three Stripe prices", status: "current" }
      ],
      openLoops: ["Confirm inclusive tax on the three prices"],
      notes: "Stripe writes are form-urlencoded POST."
    }
  });

  assert.equal(compiled.plan.compacted, false);
  const text = compiled.messages.map((message) => String(message.content)).join("\n");
  assert.match(text, /<amos_scratchpad>/);
  assert.match(text, /Act on the current job/);
  assert.doesNotMatch(text, /desktop_inspect_conversation/);
  assert.match(text, /try again/);
  assert.match(text, /Stripe to QuickBooks integration/);
  assert.match(text, /add these accounts to QBO/);
  assert.match(text, /Confirm inclusive tax/);
  assert.match(text, /form-urlencoded POST/);
});

test("follow-up compaction keeps the original objective and latest steering", () => {
  const root = { role: "user", content: "Update tax_behavior to inclusive on these three Stripe prices" };
  const followUp = { role: "user", content: "this issue should be fixed...lets try it again" };
  const compiled = compileModelContext({
    messages: [
      { role: "system", content: "system" },
      root,
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "one", function: { name: "connection_call", arguments: "{}" } }]
      },
      {
        role: "tool",
        tool_call_id: "one",
        content: JSON.stringify({
          status: 403,
          body: "<html>403 Forbidden</html>",
          ok: false
        })
      },
      { role: "assistant", content: "x".repeat(80_000) },
      followUp
    ],
    contextTokens: 4_096,
    maxOutputTokens: 1_024,
    charsPerToken: 2,
    activeTask: followUp
  });

  assert.equal(compiled.plan.compacted, true);
  const userText = compiled.messages
    .filter((message) => message.role === "user")
    .map((message) => String(message.content))
    .join("\n");
  assert.match(userText, /Update tax_behavior to inclusive/);
  assert.match(userText, /lets try it again/);
  assert.ok(
    compiled.messages.some((message) =>
      String(message.content).includes("<amos_scratchpad>")
    )
  );
  assert.ok(
    compiled.messages.some((message) =>
      message.role === "tool" && /403|Forbidden/.test(String(message.content))
    )
  );
});

test("compaction keeps recent Stripe tool evidence instead of the longest early user dump", () => {
  const dump = {
    role: "user",
    content: `Here is the whole company operating dump\n${"PLAN-NOTES ".repeat(8_000)}`
  };
  const tax = {
    role: "user",
    content: "Update tax_behavior to inclusive on price_1ABC, price_1DEF, and price_1GHI"
  };
  const followUp = { role: "user", content: "this issue should be fixed...lets try it again" };
  const compiled = compileModelContext({
    messages: [
      { role: "system", content: "system" },
      dump,
      { role: "assistant", content: "Noted the dump." },
      { role: "user", content: "Help me build a Stripe to QuickBooks integration" },
      { role: "assistant", content: "Working the integration." },
      tax,
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "price-1",
          function: {
            name: "connection_call",
            arguments: JSON.stringify({
              connection: "stripe",
              method: "POST",
              path: "/v1/prices/price_1ABC",
              body: { tax_behavior: "inclusive" }
            })
          }
        }]
      },
      {
        role: "tool",
        tool_call_id: "price-1",
        content: JSON.stringify({
          status: 403,
          ok: false,
          path: "/v1/prices/price_1ABC",
          error: "form-urlencoded required",
          body: "<html>403 Forbidden</html>"
        })
      },
      {
        role: "assistant",
        content: "I'll recover the exact state from the earlier turns and check live systems before I propose anything.\n".repeat(4_000)
      },
      followUp
    ],
    contextTokens: 32_768,
    maxOutputTokens: 8_192,
    charsPerToken: 2,
    activeTask: followUp,
    workingObjective: tax.content,
    recentJobs: [
      "Help me build a Stripe to QuickBooks integration",
      "We need to add these accounts to QBO",
      tax.content
    ]
  });

  assert.equal(compiled.plan.compacted, true);
  const compiledText = compiled.messages.map((message) => String(message.content)).join("\n");
  const dumpChars = (compiledText.match(/PLAN-NOTES/g) || []).length;
  assert.ok(dumpChars < 200, `early dump still dominates the window (${dumpChars} PLAN-NOTES tokens)`);
  assert.ok(
    compiled.messages.some((message) =>
      message.role === "tool" && /403/.test(String(message.content)) && /price_1ABC/.test(String(message.content))
    )
  );
  assert.match(compiledText, /price_1ABC/);
  assert.match(compiledText, /lets try it again/);
  assert.match(compiledText, /tax_behavior/);
  assert.doesNotMatch(compiledText, /I'll recover the exact state from the earlier turns and check live systems before I propose anything\.(?:\nI'll recover){20,}/);
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
