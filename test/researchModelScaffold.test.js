import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_RECOVERY_PROMPT,
  SEQUENTIAL_TOOL_POLICY,
  completionBudget,
  observationIndicatesOutputTruncation,
  requiresVisibleAnswerRecovery,
  runResearchInference,
  withSequentialToolPolicy
} from "../src/research/modelScaffold.js";
import { RESEARCH_TEST_DIGESTS } from "./fixtures/researchProtocolFixtures.js";

test("the research scaffold reserves visible-answer tokens and recovers without more reasoning", async () => {
  const calls = [];
  const worker = {
    async runCase(input) {
      calls.push(structuredClone(input));
      const recovering = input.caseId.endsWith(":answer");
      return observation({
        caseId: input.caseId,
        message: recovering
          ? { role: "assistant", content: "function solved() { return 42; }" }
          : { role: "assistant", content: "", reasoning_content: "I found the solution." },
        outputTokens: recovering ? 30 : 90
      });
    }
  };

  const result = await runResearchInference({
    worker,
    caseId: "coding-001",
    messages: [{ role: "user", content: "Return only the function." }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.a,
    maxOutputTokens: 160,
    answerReserveTokens: 64,
    responseFormat: { type: "json_object" }
  });

  assert.equal(result.recoveryTriggered, true);
  assert.equal(result.message.content, "function solved() { return 42; }");
  assert.equal(calls[0].maxOutputTokens, 96);
  assert.equal(calls[1].maxOutputTokens, 64);
  assert.equal(calls[1].reasoningEffortOverride, "none");
  assert.deepEqual(calls[0].responseFormat, { type: "json_object" });
  assert.deepEqual(calls[1].responseFormat, { type: "json_object" });
  assert.equal(calls[1].messages.at(-1).content, ANSWER_RECOVERY_PROMPT);
  assert.equal(calls[1].messages.at(-2).reasoning_content, "I found the solution.");
  assert.equal(result.metrics.outputTokens, 120);
});

test("the research scaffold serializes dependent tools without mutating the transcript", () => {
  const messages = [{ role: "user", content: "Inspect the campaign." }];
  const tools = [{ type: "function", function: { name: "get_campaign" } }, {
    type: "function",
    function: { name: "get_page_metrics" }
  }];
  const governed = withSequentialToolPolicy(messages, tools);

  assert.equal(messages.length, 1);
  assert.equal(governed[0].role, "system");
  assert.equal(governed[0].content, SEQUENTIAL_TOOL_POLICY);
  assert.equal(governed[1].content, messages[0].content);
});

test("tool calls do not trigger visible-answer recovery", () => {
  assert.equal(requiresVisibleAnswerRecovery({
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call-1", function: { name: "lookup", arguments: "{}" } }]
  }), false);
  assert.deepEqual(
    completionBudget({ maxOutputTokens: 768, answerReserveTokens: 256 }),
    { maxOutputTokens: 768, reasoningPhaseTokens: 512, answerReserveTokens: 256 }
  );
});

test("a truncated partial answer consumes the reserved clean-answer pass", async () => {
  const calls = [];
  const worker = {
    async runCase(input) {
      calls.push(structuredClone(input));
      const recovering = input.caseId.endsWith(":answer");
      return observation({
        caseId: input.caseId,
        message: {
          role: "assistant",
          content: recovering ? "Complete final answer." : "Partial visible answer..."
        },
        outputTokens: recovering ? 20 : 96,
        finishReason: recovering ? "stop" : "length"
      });
    }
  };

  const result = await runResearchInference({
    worker,
    caseId: "planning-001",
    messages: [{ role: "user", content: "Return the complete plan." }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.b,
    maxOutputTokens: 160,
    answerReserveTokens: 64
  });

  assert.equal(result.recoveryTriggered, true);
  assert.equal(result.message.content, "Complete final answer.");
  assert.equal(calls.length, 2);
  assert.equal(observationIndicatesOutputTruncation({
    providerResponse: { choices: [{ finish_reason: "length" }] }
  }), true);
  assert.equal(observationIndicatesOutputTruncation({
    providerResponse: { choices: [{ finish_reason: "stop" }] }
  }), false);
});

test("a custom completeness floor recovers a short visible answer", async () => {
  const calls = [];
  const recoveryPrompt = "Return the complete evidence-grounded answer.";
  const worker = {
    async runCase(input) {
      calls.push(structuredClone(input));
      const recovering = input.caseId.endsWith(":answer");
      return observation({
        caseId: input.caseId,
        message: {
          role: "assistant",
          content: recovering ? "Complete substantive answer." : "Title only"
        },
        outputTokens: recovering ? 25 : 5
      });
    }
  };

  const result = await runResearchInference({
    worker,
    caseId: "planning-completeness-001",
    messages: [{ role: "user", content: "Return the complete plan." }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.b,
    maxOutputTokens: 160,
    answerReserveTokens: 64,
    visibleAnswerValidator: (message) => message.content.length >= 20,
    answerRecoveryPrompt: recoveryPrompt
  });

  assert.equal(result.recoveryTriggered, true);
  assert.equal(result.message.content, "Complete substantive answer.");
  assert.equal(calls[1].messages.at(-1).content, recoveryPrompt);
});

function observation({ caseId, message, outputTokens, finishReason = "stop" }) {
  return {
    caseId,
    message,
    providerResponse: {
      choices: [{ finish_reason: finishReason, message }]
    },
    metrics: {
      wallMilliseconds: 10,
      promptTokens: 20,
      outputTokens,
      cachedInputTokens: 0,
      promptMilliseconds: 2,
      generationMilliseconds: 8,
      promptTokensPerSecond: 10_000,
      generationTokensPerSecond: outputTokens / 0.008,
      sessionCacheHit: null
    }
  };
}
