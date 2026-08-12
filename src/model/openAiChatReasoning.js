const STANDARD_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "max"]);
const TEMPLATE_REASONING_STRENGTHS = new Set(["low", "medium", "high", "xhigh"]);

export function normalizeStandardReasoningEffort(value) {
  return normalizeNamedValue(value, STANDARD_REASONING_EFFORTS, "reasoning effort");
}

export function normalizeTemplateReasoningStrength(value) {
  return normalizeNamedValue(value, TEMPLATE_REASONING_STRENGTHS, "reasoning strength");
}

export function openAiChatReasoningFields({
  reasoningEffort = null,
  reasoningStrength = null,
  reasoningBudgetTokens = null
} = {}) {
  const effort = normalizeStandardReasoningEffort(reasoningEffort);
  const strength = normalizeTemplateReasoningStrength(reasoningStrength);
  if (effort && strength) {
    throw new Error("Choose either reasoning effort or template reasoning strength, not both");
  }
  if (strength && reasoningBudgetTokens != null) {
    throw new Error("Reasoning budget tokens are not defined for template reasoning strength");
  }

  if (strength) {
    return {
      chat_template_kwargs: { reasoning_strength: strength }
    };
  }

  if (!effort && reasoningBudgetTokens == null) return {};
  return {
    reasoning_effort: effort || undefined,
    reasoning_budget_tokens: reasoningBudgetTokens ?? undefined,
    chat_template_kwargs: effort && effort !== "none"
      ? { reasoning_effort: effort }
      : undefined
  };
}

function normalizeNamedValue(value, allowed, label) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (allowed.has(normalized)) return normalized;
  throw new Error(`Unsupported ${label}: ${value}`);
}
