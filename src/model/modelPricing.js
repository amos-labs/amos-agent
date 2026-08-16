const USD_PER_MILLION = 1_000_000;
const MICROUSD_PER_USD = 1_000_000;

const RATES = Object.freeze({
  "gpt-5.6-sol": rate(5, 30, 0.5),
  "gpt-5.6-terra": rate(2, 12, 0.2),
  "gpt-5.6-luna": rate(0.2, 1.2, 0.02),
  "claude-fable-5": rate(10, 50, 1),
  "claude-opus-5": rate(5, 25, 0.5),
  "claude-sonnet-5": rate(2, 10, 0.2),
  "openai.gpt-5.6-sol": rate(5, 30, 0.5),
  "openai.gpt-5.6-terra": rate(2, 12, 0.2),
  "openai.gpt-5.6-luna": rate(0.2, 1.2, 0.02),
  "anthropic.claude-fable-5": rate(10, 50, 1),
  "anthropic.claude-opus-5": rate(5, 25, 0.5),
  "anthropic.claude-sonnet-5": rate(2, 10, 0.2),
  "grok-4.6": rate(2, 6, 0.5, { longContextAt: 200_000, longContextMultiplier: 2 }),
  "grok-4.5": rate(2, 6, 0.3, { longContextAt: 200_000, longContextMultiplier: 2 }),
  "grok-4.3": rate(1.25, 2.5, 0.2, { longContextAt: 200_000, longContextMultiplier: 2 }),
  "grok-build-0.1": rate(1, 2, 0.2, { longContextAt: 200_000, longContextMultiplier: 2 }),
  "kimi-k3": rate(3, 15, 0.3),
  "kimi-k2.7-code": rate(0.95, 4, 0.19),
  "kimi-k2.7-code-highspeed": rate(1.9, 8, 0.38),
  "kimi-k2.6": rate(0.95, 4, 0.16)
});

export function modelRate(modelId) {
  const key = String(modelId || "").trim();
  return RATES[key] || null;
}

export function estimateUsageCost({
  model,
  inputTokens = 0,
  outputTokens = 0,
  cachedInputTokens = 0
} = {}) {
  const pricing = modelRate(model);
  const input = boundedTokens(inputTokens);
  const output = boundedTokens(outputTokens);
  const cached = Math.min(boundedTokens(cachedInputTokens), input);
  const uncached = input - cached;
  const totalTokens = input + output;
  if (!pricing) {
    return {
      model: String(model || ""),
      inputTokens: input,
      outputTokens: output,
      cachedInputTokens: cached,
      totalTokens,
      costUsedMicrousd: 0,
      estimated: false
    };
  }
  const multiplier = pricing.longContextAt && input >= pricing.longContextAt
    ? pricing.longContextMultiplier
    : 1;
  const costUsedMicrousd = Math.round(
    (uncached * pricing.inputMicrousdPerToken +
      cached * pricing.cachedInputMicrousdPerToken +
      output * pricing.outputMicrousdPerToken) * multiplier
  );
  return {
    model: String(model || ""),
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    totalTokens,
    costUsedMicrousd,
    estimated: true
  };
}

export function accumulateUsage(current = {}, event = {}) {
  const next = {
    inputTokens: boundedTokens(current.inputTokens) + boundedTokens(event.inputTokens),
    outputTokens: boundedTokens(current.outputTokens) + boundedTokens(event.outputTokens),
    cachedInputTokens: boundedTokens(current.cachedInputTokens) +
      boundedTokens(event.cachedInputTokens),
    totalTokens: boundedTokens(current.totalTokens) + boundedTokens(event.totalTokens),
    costUsedMicrousd: boundedTokens(current.costUsedMicrousd) +
      boundedTokens(event.costUsedMicrousd),
    estimated: current.estimated === true || event.estimated === true,
    models: uniqueModels(
      current.models,
      event.model,
      ...(Array.isArray(event.models) ? event.models : [])
    )
  };
  if (event.model) next.model = String(event.model).slice(0, 256);
  return next;
}

export function formatUsdMicros(microusd) {
  const value = Number(microusd) || 0;
  return `$${(value / MICROUSD_PER_USD).toFixed(value >= 100_000 ? 2 : 4)}`;
}

function rate(inputUsdPerMillion, outputUsdPerMillion, cachedUsdPerMillion = null, options = {}) {
  return Object.freeze({
    inputMicrousdPerToken: usdPerMillionToMicrousd(inputUsdPerMillion),
    outputMicrousdPerToken: usdPerMillionToMicrousd(outputUsdPerMillion),
    cachedInputMicrousdPerToken: usdPerMillionToMicrousd(
      cachedUsdPerMillion == null ? inputUsdPerMillion * 0.1 : cachedUsdPerMillion
    ),
    longContextAt: Number(options.longContextAt) || 0,
    longContextMultiplier: Number(options.longContextMultiplier) || 1
  });
}

function usdPerMillionToMicrousd(usdPerMillion) {
  return (Number(usdPerMillion) * MICROUSD_PER_USD) / USD_PER_MILLION;
}

function boundedTokens(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.trunc(parsed), 100_000_000);
}

function uniqueModels(existing, ...next) {
  const models = [...(Array.isArray(existing) ? existing : [])];
  for (const value of next) {
    const model = String(value || "").trim().slice(0, 256);
    if (model && !models.includes(model)) models.push(model);
  }
  return models.slice(0, 12);
}
