export const INTELLIGENCE_ROLES = Object.freeze(["planner", "implementer", "checker"]);

export const DEFAULT_INTELLIGENCE_ROLES = Object.freeze({
  enabled: false,
  scope: "coding",
  planner: Object.freeze({ provider: "kimi", model: "kimi-k3" }),
  implementer: Object.freeze({ provider: "xai", model: "grok-4.6" }),
  checker: Object.freeze({ provider: "kimi", model: "kimi-k3" })
});

const ROLE_PROMPTS = Object.freeze({
  planner: [
    "You are the planner for this task.",
    "Inspect, search, and produce a concrete implementation plan.",
    "Do not edit files, apply patches, or run mutating shell commands unless the user explicitly asks you to implement now.",
    "Name the files, checks, risks, and the smallest coherent change.",
    "When the plan is ready, stop or hand off to the implementer."
  ].join(" "),
  implementer: [
    "You are the implementer for this task.",
    "Follow the current plan. Inspect before editing, prefer small apply_patch changes, run the relevant checks, and inspect git_diff before claiming completion.",
    "Do not expand the plan into unrelated refactors.",
    "When the change is verified, stop or hand off to the checker."
  ].join(" "),
  checker: [
    "You are the checker for this task.",
    "Review the current diff, tests, and remaining risk. Do not implement a new design unless you find a blocking defect.",
    "If the work is sound, say what was verified. If it is not, name the exact repair and hand off to the implementer."
  ].join(" ")
});

export function sanitizeIntelligenceRoles(input = {}, { allowDisabled = true } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const enabled = source.enabled === true;
  if (!enabled && allowDisabled) {
    return {
      enabled: false,
      scope: sanitizeScope(source.scope),
      planner: sanitizeRoleSelection(source.planner, DEFAULT_INTELLIGENCE_ROLES.planner),
      implementer: sanitizeRoleSelection(source.implementer, DEFAULT_INTELLIGENCE_ROLES.implementer),
      checker: sanitizeRoleSelection(source.checker, DEFAULT_INTELLIGENCE_ROLES.checker)
    };
  }
  return {
    enabled,
    scope: sanitizeScope(source.scope),
    planner: sanitizeRoleSelection(source.planner, DEFAULT_INTELLIGENCE_ROLES.planner),
    implementer: sanitizeRoleSelection(source.implementer, DEFAULT_INTELLIGENCE_ROLES.implementer),
    checker: sanitizeRoleSelection(source.checker, DEFAULT_INTELLIGENCE_ROLES.checker)
  };
}

export function normalizeIntelligenceRole(value, fallback = "implementer") {
  const role = String(value || "").trim();
  return INTELLIGENCE_ROLES.includes(role) ? role : fallback;
}

export function roleSelection(roles, role) {
  const normalized = normalizeIntelligenceRole(role);
  const pairing = sanitizeIntelligenceRoles(roles);
  return pairing[normalized];
}

export function defaultRoleForWorkflow(workflow, roles = {}) {
  const pairing = sanitizeIntelligenceRoles(roles);
  if (!pairing.enabled) return null;
  const id = String(workflow?.id || "");
  if (id === "code-change" || id === "github-issue-diagnosis" || id === "plan-implement-verify") {
    return "planner";
  }
  if (pairing.scope === "coding") return null;
  return "implementer";
}

export function roleGuidance(role) {
  return ROLE_PROMPTS[normalizeIntelligenceRole(role)] || ROLE_PROMPTS.implementer;
}

export function encodeRoleOption(selection = {}) {
  const provider = clean(selection.provider, 64);
  const model = clean(selection.model, 256);
  return provider && model ? `${provider}:${model}` : "";
}

export function decodeRoleOption(value, fallback = DEFAULT_INTELLIGENCE_ROLES.implementer) {
  const text = String(value || "");
  const index = text.indexOf(":");
  if (index <= 0) return sanitizeRoleSelection(fallback, fallback);
  return sanitizeRoleSelection({
    provider: text.slice(0, index),
    model: text.slice(index + 1)
  }, fallback);
}

export function roleOptionsFromProviders(providers = []) {
  const options = [];
  for (const provider of providers) {
    if (!provider?.id || provider.id === "amos-hosted") continue;
    const models = Array.isArray(provider.models) && provider.models.length > 0
      ? provider.models
      : provider.defaultModel
        ? [{ id: provider.defaultModel, label: provider.defaultModel }]
        : [];
    for (const model of models) {
      if (!model?.id) continue;
      options.push({
        value: encodeRoleOption({ provider: provider.id, model: model.id }),
        label: `${provider.displayName || provider.id} · ${model.label || model.id}`,
        provider: provider.id,
        model: model.id
      });
    }
  }
  return options;
}

function sanitizeRoleSelection(input, fallback) {
  const provider = clean(input?.provider, 64) || fallback.provider;
  const model = clean(input?.model, 256) || fallback.model;
  return { provider, model };
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function sanitizeScope(value) {
  return value === "all" ? "all" : "coding";
}
