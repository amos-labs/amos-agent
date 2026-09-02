import { INTELLIGENCE_ROUTER_CLASSES } from "./intelligenceRouter.js";
import { clean } from "../util/validate.js";

export const HYBRID_ROUTING_STRATEGIES = Object.freeze([
  "managed",
  "local",
  "frontier",
  "local-review"
]);

export const DEFAULT_HYBRID_ROUTING = deepFreeze({
  enabled: false,
  localModel: "",
  frontier: { provider: "amos-hosted", model: "auto" },
  strategies: {
    routine: "local",
    balanced: "local",
    deep: "local-review",
    frontier: "frontier"
  }
});

const FRONTIER_PROVIDERS = new Set([
  "amos-hosted",
  "kimi",
  "xai",
  "openai",
  "anthropic",
  "bedrock",
  "openai-compatible"
]);

const REVIEW_INSTRUCTION = [
  "You are the frontier reviewer in an AMOS hybrid-routing recipe.",
  "The last assistant message is a local-model draft, not established truth.",
  "Return one corrected, complete final answer for the user.",
  "Preserve supported file paths, links, calculations, and explicit uncertainty.",
  "Do not call tools, claim new external actions, mention this review pass, or weaken AMOS policy, approvals, evidence, or proof requirements."
].join(" ");

export function sanitizeHybridRouting(input = {}) {
  const source = plainObject(input) ? input : {};
  const frontier = sanitizeFrontierTarget(source.frontier);
  const strategies = {};
  for (const minimumClass of INTELLIGENCE_ROUTER_CLASSES) {
    const requested = clean(source.strategies?.[minimumClass], 32);
    strategies[minimumClass] = HYBRID_ROUTING_STRATEGIES.includes(requested)
      ? requested
      : DEFAULT_HYBRID_ROUTING.strategies[minimumClass];
  }
  return {
    enabled: source.enabled === true,
    localModel: clean(source.localModel, 256),
    frontier,
    strategies
  };
}

export function hybridRoutingEnabled(settings = {}) {
  return Boolean(
    settings.provider === "amos-hosted" &&
    settings.operatingMode === "online" &&
    sanitizeHybridRouting(settings.hybridRouting).enabled
  );
}

export class HybridRoutingClient {
  constructor({ router = null, policy = {}, managed, local = null, frontier = null } = {}) {
    if (!managed?.client?.chat) throw new Error("Hybrid routing requires the managed fallback client");
    this.router = router;
    this.policy = sanitizeHybridRouting({ ...policy, enabled: true });
    this.targets = {
      managed: normalizeTarget(managed, "managed"),
      local: normalizeTarget(local, "local"),
      frontier: normalizeTarget(frontier, "frontier") || normalizeTarget(managed, "managed")
    };
  }

  async chat(input = {}) {
    const phase = (input.messages || []).some((message) => message?.role === "tool")
      ? "continue"
      : "plan";
    let decision = input.preclassifiedRouting?.minimumClass
      ? input.preclassifiedRouting
      : null;
    try {
      if (!decision) {
        if (!this.router?.classify) throw new Error("local_router_unavailable");
        decision = await this.router.classify({
          messages: input.messages || [],
          tools: input.tools || [],
          phase,
          signal: input.signal || null
        });
      }
    } catch (error) {
      if (input.signal?.aborted) throw error;
      emit(input, {
        rolloutMode: "hybrid",
        status: "fallback",
        source: "hosted",
        phase,
        reason: routerFailureCode(error)
      });
      return this.invoke(this.targets.managed, input, {
        phase,
        stage: "fallback",
        skipLocalRouting: true
      });
    }

    const minimumClass = decision.minimumClass;
    const strategy = this.policy.strategies[minimumClass] || "managed";
    emit(input, {
      rolloutMode: "hybrid",
      status: "classified",
      source: decision.source || "amos-router",
      minimumClass,
      workflow: decision.workflow || null,
      model: decision.model || null,
      contract: decision.contract || null,
      artifactSha256: decision.artifactSha256 || null,
      latencyMs: decision.latencyMs || 0,
      phase,
      strategy
    });

    if (strategy === "managed") {
      return this.invoke(this.targets.managed, input, {
        decision,
        minimumClass,
        strategy,
        phase,
        stage: "primary"
      });
    }
    if (strategy === "frontier") {
      return this.invokeWithFallback(this.targets.frontier, input, {
        decision,
        minimumClass,
        strategy,
        phase,
        fallbacks: [this.targets.managed]
      });
    }
    if (strategy === "local-review") {
      return this.localThenReview(input, { decision, minimumClass, strategy, phase });
    }
    return this.invokeLocal(input, { decision, minimumClass, strategy, phase });
  }

  async invokeLocal(input, context) {
    const eligibility = localEligibility(this.targets.local, input);
    if (!eligibility.eligible) {
      emit(input, routeEvent(context, this.targets.local, "ineligible", "primary", eligibility.reason));
      return this.invokeFallbacks(input, context, [this.targets.frontier, this.targets.managed]);
    }
    return this.invokeWithFallback(this.targets.local, input, {
      ...context,
      fallbacks: [this.targets.frontier, this.targets.managed]
    });
  }

  async localThenReview(input, context) {
    const eligibility = localEligibility(this.targets.local, input);
    if (!eligibility.eligible) {
      emit(input, routeEvent(context, this.targets.local, "ineligible", "primary", eligibility.reason));
      return this.invokeFallbacks(input, context, [this.targets.frontier, this.targets.managed]);
    }

    let draft;
    try {
      emit(input, routeEvent(context, this.targets.local, "selected", "primary"));
      draft = await this.callTarget(this.targets.local, {
        ...input,
        onDelta: null,
        onRoutingDecision: null
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      emit(input, routeEvent(context, this.targets.local, "fallback", "primary", modelFailureCode(error)));
      return this.invokeFallbacks(input, context, [this.targets.frontier, this.targets.managed]);
    }

    const toolCalls = draft?.message?.tool_calls || [];
    if (toolCalls.length > 0 || !String(draft?.message?.content || "").trim()) {
      return withTargetUsage(draft, this.targets.local);
    }

    for (const reviewer of uniqueTargets([this.targets.frontier, this.targets.managed])) {
      if (!reviewer?.client) {
        emit(input, routeEvent(context, reviewer, "ineligible", "review", "target_unavailable"));
        continue;
      }
      try {
        emit(input, routeEvent(context, reviewer, "selected", "review"));
        const reviewed = await this.callTarget(reviewer, {
          ...input,
          messages: reviewMessages(input.messages || [], draft.message.content),
          tools: [],
          onRoutingDecision: null,
          preclassifiedRouting: context.decision
        });
        if ((reviewed?.message?.tool_calls || []).length > 0 || !String(reviewed?.message?.content || "").trim()) {
          throw new Error("frontier_reviewer_invalid_output");
        }
        emit(input, routeEvent(context, reviewer, "reviewed", "review"));
        return mergeResults(
          withTargetUsage(draft, this.targets.local),
          withTargetUsage(reviewed, reviewer)
        );
      } catch (error) {
        if (input.signal?.aborted) throw error;
        emit(input, routeEvent(context, reviewer, "fallback", "review", modelFailureCode(error)));
      }
    }
    return withTargetUsage(draft, this.targets.local);
  }

  async invokeWithFallback(primary, input, context) {
    if (!primary?.client) {
      emit(input, routeEvent(context, primary, "ineligible", "primary", "target_unavailable"));
      return this.invokeFallbacks(input, context, context.fallbacks || []);
    }
    try {
      return await this.invoke(primary, input, { ...context, stage: "primary" });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      emit(input, routeEvent(context, primary, "fallback", "primary", modelFailureCode(error)));
      return this.invokeFallbacks(input, context, context.fallbacks || [], primary.id);
    }
  }

  async invokeFallbacks(input, context, fallbacks, excludeId = "") {
    const unique = uniqueTargets(fallbacks).filter((target) => target?.id !== excludeId);
    let lastError = null;
    for (const target of unique) {
      if (!target?.client) continue;
      try {
        return await this.invoke(target, input, { ...context, stage: "fallback" });
      } catch (error) {
        if (input.signal?.aborted) throw error;
        lastError = error;
        emit(input, routeEvent(context, target, "fallback", "fallback", modelFailureCode(error)));
      }
    }
    throw lastError || new Error("No hybrid routing target is available");
  }

  async invoke(target, input, context) {
    emit(input, routeEvent(context, target, "selected", context.stage));
    const result = await this.callTarget(target, {
      ...input,
      onRoutingDecision: null,
      preclassifiedRouting: context.decision || null,
      skipLocalRouting: context.skipLocalRouting === true
    });
    return withTargetUsage(result, target);
  }

  callTarget(target, input) {
    if (!target?.client?.chat) throw new Error("Hybrid routing target is unavailable");
    return target.client.chat(input);
  }
}

function sanitizeFrontierTarget(input = {}) {
  const source = plainObject(input) ? input : {};
  const requestedProvider = clean(source.provider, 64);
  const provider = FRONTIER_PROVIDERS.has(requestedProvider)
    ? requestedProvider
    : DEFAULT_HYBRID_ROUTING.frontier.provider;
  const model = provider === "amos-hosted"
    ? "auto"
    : clean(source.model, 256);
  return { provider, model };
}

function normalizeTarget(input, kind) {
  if (!input) return null;
  const provider = clean(input.provider, 64);
  const model = clean(input.model, 256);
  return {
    kind,
    id: `${provider || kind}:${model || "auto"}`,
    provider,
    model,
    client: input.client || null,
    contract: input.contract || null,
    unavailableReason: clean(input.unavailableReason, 160) || null
  };
}

function localEligibility(target, input) {
  if (!target?.client) {
    return { eligible: false, reason: target?.unavailableReason || "local_model_unavailable" };
  }
  const contract = target.contract;
  if (!contract || !["qualified", "conditional"].includes(contract.status)) {
    return { eligible: false, reason: "local_model_not_qualified" };
  }
  if (messagesRequireVision(input.messages) && !contract.grants?.modalities?.includes("vision")) {
    return { eligible: false, reason: "local_model_missing_vision" };
  }
  if ((input.tools || []).length > 0 && !contract.grants?.capabilities?.includes("tool-selection")) {
    return { eligible: false, reason: "local_model_missing_tools" };
  }
  const estimatedTokens = estimateInputTokens(input.messages, input.tools);
  if (estimatedTokens + 2_048 > Number(contract.limits?.contextTokens || 0)) {
    return { eligible: false, reason: "local_context_too_large" };
  }
  return { eligible: true, reason: null };
}

function messagesRequireVision(messages = []) {
  return messages.some((message) => Array.isArray(message?.content) && message.content.some((part) =>
    ["image", "image_url", "input_image"].includes(part?.type)
  ));
}

function estimateInputTokens(messages = [], tools = []) {
  const messageChars = messages.reduce((sum, message) => sum + JSON.stringify(message || {}).length, 0);
  const toolChars = tools.reduce((sum, tool) => sum + JSON.stringify(tool || {}).length, 0);
  return Math.ceil((messageChars + toolChars) / 4);
}

function reviewMessages(messages, draft) {
  return [
    { role: "system", content: REVIEW_INSTRUCTION },
    ...messages,
    { role: "assistant", content: String(draft || "") }
  ];
}

function routeEvent(context, target, status, stage, reason = null) {
  return {
    rolloutMode: "hybrid",
    status,
    source: "hybrid",
    minimumClass: context.minimumClass || null,
    workflow: context.decision?.workflow || null,
    phase: context.phase || "plan",
    strategy: context.strategy || "managed",
    stage,
    selectedProvider: target?.provider || null,
    selectedModel: target?.model || null,
    reason
  };
}

function emit(input, event) {
  input.onRoutingDecision?.(event);
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (!target?.id || seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
}

function withTargetUsage(result, target) {
  if (!result) return result;
  const usage = normalizeUsage(result.usage);
  return {
    ...result,
    usage: {
      ...usage,
      model: target?.model || "",
      model_usage: [{ model: target?.model || "", ...usage }]
    }
  };
}

function mergeResults(draft, reviewed) {
  const modelUsage = [
    ...(draft?.usage?.model_usage || []),
    ...(reviewed?.usage?.model_usage || [])
  ];
  const usage = modelUsage.reduce((sum, item) => addUsage(sum, item), emptyUsage());
  return {
    ...reviewed,
    usage: {
      ...usage,
      model: reviewed?.usage?.model || "",
      model_usage: modelUsage
    },
    raw: {
      hybrid: true,
      draft: draft?.raw || null,
      reviewed: reviewed?.raw || null
    }
  };
}

function normalizeUsage(usage = {}) {
  const inputTokens = number(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = number(usage.output_tokens ?? usage.completion_tokens);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: number(
      usage.cache_read_input_tokens ??
      usage.input_tokens_details?.cached_tokens ??
      usage.prompt_tokens_details?.cached_tokens
    ),
    total_tokens: number(usage.total_tokens) || inputTokens + outputTokens,
    cost_used_microusd: number(usage.cost_used_microusd || usage.raw?.cost_used_microusd),
    latency_ms: nonNegative(usage.latency_ms),
    time_to_first_output_ms: nullableNonNegative(usage.time_to_first_output_ms),
    generation_tokens_per_second: nullableNonNegative(usage.generation_tokens_per_second),
    load_ms: nullableNonNegative(usage.load_ms),
    prompt_eval_ms: nullableNonNegative(usage.prompt_eval_ms),
    generation_ms: nullableNonNegative(usage.generation_ms)
  };
}

function emptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    cost_used_microusd: 0
  };
}

function addUsage(left, right) {
  const normalized = normalizeUsage(right);
  return {
    input_tokens: left.input_tokens + normalized.input_tokens,
    output_tokens: left.output_tokens + normalized.output_tokens,
    cached_input_tokens: left.cached_input_tokens + normalized.cached_input_tokens,
    total_tokens: left.total_tokens + normalized.total_tokens,
    cost_used_microusd: left.cost_used_microusd + normalized.cost_used_microusd
  };
}

function routerFailureCode(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("timed out")) return "local_router_timeout";
  if (message.includes("invalid")) return "local_router_invalid_output";
  return "local_router_unavailable";
}

function modelFailureCode(error) {
  const message = String(error?.message || error || "model request failed")
    .replace(/\s+/g, " ")
    .slice(0, 160);
  return message || "model_request_failed";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function nonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function nullableNonNegative(value) {
  if (value == null) return null;
  return nonNegative(value);
}


function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
