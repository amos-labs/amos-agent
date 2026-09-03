const USD_PER_MILLION = 1_000_000;
const MICROUSD_PER_USD = 1_000_000;

const RATES = Object.freeze({
  "gpt-6-astra": rate(10, 50, 1, {
    longContextAt: 272_000,
    inputLongContextMultiplier: 2,
    outputLongContextMultiplier: 1.5
  }),
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
  const longContext = pricing.longContextAt && input >= pricing.longContextAt;
  const inputMultiplier = longContext ? pricing.inputLongContextMultiplier : 1;
  const outputMultiplier = longContext ? pricing.outputLongContextMultiplier : 1;
  const costUsedMicrousd = Math.round(
    (uncached * pricing.inputMicrousdPerToken +
      cached * pricing.cachedInputMicrousdPerToken) * inputMultiplier +
      output * pricing.outputMicrousdPerToken * outputMultiplier
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
  const priorPerformance = normalizeUsagePerformance(current.performance);
  const latencyMs = boundedDuration(event.latencyMs);
  const timeToFirstOutputMs = optionalDuration(event.timeToFirstOutputMs);
  const promptEvalMs = optionalDuration(event.promptEvalMs);
  const generationMs = optionalDuration(event.generationMs);
  const outputTokens = boundedTokens(event.outputTokens);
  const requestCount = priorPerformance.requestCount + 1;
  const generationOutputTokens = priorPerformance.generationOutputTokens +
    (generationMs == null ? 0 : outputTokens);
  const totalGenerationMs = priorPerformance.totalGenerationMs + (generationMs || 0);
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
    ),
    requestedRuntime: String(
      event.requestedRuntime || current.requestedRuntime || ""
    ).slice(0, 32),
    runtime: String(event.runtime || current.runtime || "").slice(0, 32),
    runtimeFallbacks: boundedTokens(current.runtimeFallbacks) + (event.fallbackUsed === true ? 1 : 0),
    fallbackReason: event.fallbackReason
      ? String(event.fallbackReason).slice(0, 500)
      : current.fallbackReason || null,
    performance: {
      requestCount,
      totalLatencyMs: priorPerformance.totalLatencyMs + latencyMs,
      averageLatencyMs: Math.round((priorPerformance.totalLatencyMs + latencyMs) / requestCount),
      maxLatencyMs: Math.max(priorPerformance.maxLatencyMs, latencyMs),
      totalTimeToFirstOutputMs: priorPerformance.totalTimeToFirstOutputMs +
        (timeToFirstOutputMs || 0),
      timeToFirstOutputSamples: priorPerformance.timeToFirstOutputSamples +
        (timeToFirstOutputMs == null ? 0 : 1),
      averageTimeToFirstOutputMs: averageMeasured(
        priorPerformance.totalTimeToFirstOutputMs + (timeToFirstOutputMs || 0),
        priorPerformance.timeToFirstOutputSamples + (timeToFirstOutputMs == null ? 0 : 1)
      ),
      totalPromptEvalMs: priorPerformance.totalPromptEvalMs + (promptEvalMs || 0),
      promptEvalSamples: priorPerformance.promptEvalSamples + (promptEvalMs == null ? 0 : 1),
      totalGenerationMs,
      generationSamples: priorPerformance.generationSamples + (generationMs == null ? 0 : 1),
      generationOutputTokens,
      generationTokensPerSecond: totalGenerationMs > 0 && generationOutputTokens > 0
        ? Number((generationOutputTokens / (totalGenerationMs / 1_000)).toFixed(2))
        : null
    }
  };
  if (event.model) next.model = String(event.model).slice(0, 256);
  return next;
}

function normalizeUsagePerformance(value = {}) {
  return {
    requestCount: boundedTokens(value.requestCount),
    totalLatencyMs: boundedDuration(value.totalLatencyMs),
    maxLatencyMs: boundedDuration(value.maxLatencyMs),
    totalTimeToFirstOutputMs: boundedDuration(value.totalTimeToFirstOutputMs),
    timeToFirstOutputSamples: boundedTokens(value.timeToFirstOutputSamples),
    totalPromptEvalMs: boundedDuration(value.totalPromptEvalMs),
    promptEvalSamples: boundedTokens(value.promptEvalSamples),
    totalGenerationMs: boundedDuration(value.totalGenerationMs),
    generationSamples: boundedTokens(value.generationSamples),
    generationOutputTokens: boundedTokens(value.generationOutputTokens)
  };
}

function optionalDuration(value) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(Math.round(parsed), 24 * 60 * 60 * 1_000);
}

function boundedDuration(value) {
  return optionalDuration(value) || 0;
}

function averageMeasured(total, samples) {
  return samples > 0 ? Math.round(total / samples) : null;
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
    inputLongContextMultiplier: Number(
      options.inputLongContextMultiplier ?? options.longContextMultiplier
    ) || 1,
    outputLongContextMultiplier: Number(
      options.outputLongContextMultiplier ?? options.longContextMultiplier
    ) || 1
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
