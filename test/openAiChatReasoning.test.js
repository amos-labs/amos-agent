import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStandardReasoningEffort,
  normalizeTemplateReasoningStrength,
  openAiChatReasoningFields
} from "../src/model/openAiChatReasoning.js";

test("standard reasoning is forwarded through the OpenAI field and chat template", () => {
  assert.deepEqual(openAiChatReasoningFields({
    reasoningEffort: "high",
    reasoningBudgetTokens: 2_048
  }), {
    reasoning_effort: "high",
    reasoning_budget_tokens: 2_048,
    chat_template_kwargs: { reasoning_effort: "high" }
  });
});

test("Muse-style reasoning strength stays inside chat_template_kwargs", () => {
  assert.deepEqual(openAiChatReasoningFields({ reasoningStrength: "xhigh" }), {
    chat_template_kwargs: { reasoning_strength: "xhigh" }
  });
});

test("reasoning dialects cannot be mixed in one request", () => {
  assert.throws(
    () => openAiChatReasoningFields({ reasoningEffort: "high", reasoningStrength: "high" }),
    /either reasoning effort or template reasoning strength/
  );
  assert.throws(
    () => openAiChatReasoningFields({ reasoningStrength: "high", reasoningBudgetTokens: 512 }),
    /budget tokens are not defined/
  );
});

test("reasoning normalizers preserve their distinct supported values", () => {
  assert.equal(normalizeStandardReasoningEffort("MAX"), "max");
  assert.equal(normalizeTemplateReasoningStrength("XHIGH"), "xhigh");
  assert.throws(() => normalizeTemplateReasoningStrength("max"), /Unsupported reasoning strength/);
  assert.throws(() => normalizeStandardReasoningEffort("xhigh"), /Unsupported reasoning effort/);
});
