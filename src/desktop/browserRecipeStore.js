import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;
const MAX_RECIPES_PER_OWNER = 50;
const MAX_STEPS = 40;
const MAX_INPUTS = 20;
const MAX_STORE_CHARS = 8 * 1024 * 1024;
const ACTION_KINDS = new Set(["click", "type", "select", "check", "upload", "download"]);

/** Encrypted, identity-pinned local storage for deterministic browser recipes. */
export class BrowserRecipeStore {
  constructor({ filePath, encrypt, decrypt, now = () => new Date(), createId = randomUUID } = {}) {
    if (!filePath) throw new Error("Browser recipes require a storage path");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Browser recipes require operating-system encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.now = now;
    this.createId = createId;
  }

  async list(scope) {
    const owner = normalizeOwner(scope);
    const store = await this.readStore();
    return store.recipes
      .filter((recipe) => sameOwner(recipe.owner, owner))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(publicRecipe);
  }

  async get(scope, id) {
    const owner = normalizeOwner(scope);
    const recipeId = cleanRequired(id, 128, "browser recipe id");
    const store = await this.readStore();
    const recipe = store.recipes.find((item) => item.id === recipeId && sameOwner(item.owner, owner));
    if (!recipe) throw new Error("That browser recipe is not available to this account");
    return structuredClone(recipe);
  }

  async save(scope, draft, input = {}) {
    const owner = normalizeOwner(scope);
    const store = await this.readStore();
    const owned = store.recipes.filter((recipe) => sameOwner(recipe.owner, owner));
    if (owned.length >= MAX_RECIPES_PER_OWNER) {
      throw new Error(`AMOS Desktop keeps up to ${MAX_RECIPES_PER_OWNER} browser recipes per account`);
    }
    const now = this.now().toISOString();
    const recipe = compileRecipe({
      id: this.createId(),
      name: input.name,
      description: input.description,
      draft,
      bindings: input.inputBindings,
      owner,
      createdAt: now,
      updatedAt: now
    });
    store.recipes.push(recipe);
    await this.writeStore(store);
    return publicRecipe(recipe);
  }

  async recordRun(scope, id, { status, checkpoints = [], error = "" } = {}) {
    const owner = normalizeOwner(scope);
    const store = await this.readStore();
    const index = store.recipes.findIndex((recipe) => recipe.id === id && sameOwner(recipe.owner, owner));
    if (index < 0) throw new Error("That browser recipe is not available to this account");
    const recipe = store.recipes[index];
    const completed = status === "completed";
    const drifted = status === "drifted";
    store.recipes[index] = normalizeRecipe({
      ...recipe,
      status: drifted ? "attention" : recipe.status,
      runStats: {
        completed: recipe.runStats.completed + (completed ? 1 : 0),
        failed: recipe.runStats.failed + (!completed ? 1 : 0),
        drifted: recipe.runStats.drifted + (drifted ? 1 : 0),
        lastStatus: status,
        lastRunAt: this.now().toISOString(),
        lastCheckpointCount: Math.min(MAX_STEPS, checkpoints.length),
        lastError: cleanText(error, 500)
      },
      updatedAt: this.now().toISOString()
    });
    await this.writeStore(store);
    return publicRecipe(store.recipes[index]);
  }

  async remove(scope, id) {
    const owner = normalizeOwner(scope);
    const store = await this.readStore();
    const index = store.recipes.findIndex((recipe) => recipe.id === id);
    if (index < 0) return false;
    if (!sameOwner(store.recipes[index].owner, owner)) {
      throw new Error("That browser recipe belongs to another AMOS identity");
    }
    store.recipes.splice(index, 1);
    await this.writeStore(store);
    return true;
  }

  async readStore() {
    let outer;
    try {
      outer = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { version: VERSION, recipes: [] };
      throw new Error(`Could not read AMOS browser recipes: ${error.message}`);
    }
    if (
      outer?.version !== VERSION ||
      typeof outer.encryptedRecord !== "string" ||
      outer.encryptedRecord.length === 0 ||
      outer.encryptedRecord.length > MAX_STORE_CHARS
    ) {
      throw new Error("Unsupported or corrupted AMOS browser recipe store");
    }
    try {
      const value = JSON.parse(this.decrypt(outer.encryptedRecord));
      if (value?.version !== VERSION || !Array.isArray(value.recipes) || value.recipes.length > 500) {
        throw new Error("invalid browser recipe store contract");
      }
      return { version: VERSION, recipes: value.recipes.map(normalizeRecipe) };
    } catch (error) {
      throw new Error(`Could not decrypt AMOS browser recipes: ${error.message}`);
    }
  }

  async writeStore(store) {
    const value = { version: VERSION, recipes: store.recipes.map(normalizeRecipe) };
    const encryptedRecord = this.encrypt(JSON.stringify(value));
    if (!encryptedRecord || encryptedRecord.length > MAX_STORE_CHARS) {
      throw new Error("Encrypted AMOS browser recipes exceed the local storage limit");
    }
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(
      temporary,
      `${JSON.stringify({ version: VERSION, encryptedRecord }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }
}

function compileRecipe({ id, name, description, draft, bindings, owner, createdAt, updatedAt }) {
  const sourceSteps = Array.isArray(draft?.steps) ? draft.steps : [];
  if (sourceSteps.length === 0 || sourceSteps.length > MAX_STEPS) {
    throw new Error(`A browser recipe needs 1-${MAX_STEPS} verified steps`);
  }
  const bindingMap = normalizeBindings(bindings, sourceSteps.length);
  const inputs = [];
  const seenInputs = new Map();
  const steps = sourceSteps.map((source, index) => {
    const stepNumber = index + 1;
    const binding = bindingMap.get(stepNumber) || null;
    const step = compileStep(source, stepNumber, binding);
    if (step.input) {
      const existing = seenInputs.get(step.input.name);
      if (existing && existing.type !== step.input.type) {
        throw new Error(`Recipe input ${step.input.name} cannot have two types`);
      }
      if (!existing) {
        seenInputs.set(step.input.name, step.input);
        inputs.push(step.input);
      }
      delete step.input;
    }
    return step;
  });
  if (inputs.length > MAX_INPUTS) throw new Error(`A browser recipe supports up to ${MAX_INPUTS} inputs`);
  const origins = [...new Set(steps.filter((step) => step.kind === "open")
    .map((step) => new URL(step.url).origin))];
  return normalizeRecipe({
    id,
    name,
    description,
    version: VERSION,
    status: "ready",
    origins,
    inputs,
    steps,
    owner,
    createdAt,
    updatedAt,
    runStats: emptyRunStats()
  });
}

function compileStep(source, stepNumber, binding) {
  const kind = String(source?.kind || "");
  if (kind === "open") {
    if (binding) throw new Error(`Recipe step ${stepNumber} does not accept an input binding`);
    return { id: `step-${stepNumber}`, kind, url: safeUrl(source.url), retryLimit: 0 };
  }
  if (kind === "wait") {
    if (binding) throw new Error(`Recipe step ${stepNumber} does not accept an input binding`);
    return {
      id: `step-${stepNumber}`,
      kind,
      condition: enumValue(source.condition, new Set(["settled", "url", "text"]), "settled"),
      value: cleanText(source.value, 300),
      timeoutMs: boundedInteger(source.timeoutMs, 5_000, 250, 10_000),
      retryLimit: 0
    };
  }
  if (!ACTION_KINDS.has(kind)) throw new Error(`Recipe step ${stepNumber} has an unsupported operation`);
  const step = {
    id: `step-${stepNumber}`,
    kind,
    risk: kind === "upload" || kind === "download"
      ? "file-transfer"
      : source.risk === "observational" ? "observational" : "consequential",
    target: normalizeTarget(source.target, `recipe step ${stepNumber}`),
    retryLimit: 0
  };
  if (["type", "upload"].includes(kind)) {
    if (!binding) throw new Error(`Recipe step ${stepNumber} (${kind}) requires a named input binding`);
    const input = {
      name: normalizeInputName(binding.inputName),
      label: cleanText(binding.label, 120) || (kind === "upload" ? "Attachment" : step.target.name || "Text"),
      type: kind === "upload" ? "attachment_id" : "string",
      required: true
    };
    step.inputName = input.name;
    step.input = input;
    if (kind === "type") step.replace = source.payload?.replace !== false;
    return step;
  }
  if (binding) throw new Error(`Recipe step ${stepNumber} (${kind}) does not accept an input binding`);
  if (kind === "select") {
    step.optionName = cleanRequired(source.payload?.optionName, 300, `recipe step ${stepNumber} option`);
  }
  if (kind === "check") step.checked = source.payload?.checked === true;
  return step;
}

function normalizeRecipe(input) {
  const steps = boundedArray(input?.steps, MAX_STEPS, "browser recipe steps")
    .map((step, index) => normalizeStoredStep(step, index));
  if (steps.length === 0) throw new Error("A browser recipe cannot be empty");
  const inputs = boundedArray(input?.inputs || [], MAX_INPUTS, "browser recipe inputs")
    .map(normalizeInput);
  const inputNames = new Set(inputs.map((item) => item.name));
  for (const step of steps) {
    if (step.inputName && !inputNames.has(step.inputName)) {
      throw new Error(`Browser recipe step references missing input ${step.inputName}`);
    }
  }
  return {
    version: VERSION,
    id: cleanRequired(input?.id, 128, "browser recipe id"),
    name: cleanRequired(input?.name, 160, "browser recipe name"),
    description: cleanText(input?.description, 1_000),
    status: enumValue(input?.status, new Set(["ready", "paused", "attention"]), "ready"),
    origins: [...new Set(boundedArray(input?.origins || [], 12, "browser recipe origins").map(safeOrigin))],
    inputs,
    steps,
    runStats: normalizeRunStats(input?.runStats),
    owner: normalizeOwner(input?.owner),
    createdAt: timestamp(input?.createdAt),
    updatedAt: timestamp(input?.updatedAt)
  };
}

function normalizeStoredStep(step, index) {
  const kind = String(step?.kind || "");
  const base = {
    id: cleanText(step?.id, 80) || `step-${index + 1}`,
    kind,
    retryLimit: boundedInteger(step?.retryLimit, 0, 0, 2)
  };
  if (kind === "open") return { ...base, url: safeUrl(step.url) };
  if (kind === "wait") {
    return {
      ...base,
      condition: enumValue(step.condition, new Set(["settled", "url", "text"]), "settled"),
      value: cleanText(step.value, 300),
      timeoutMs: boundedInteger(step.timeoutMs, 5_000, 250, 10_000)
    };
  }
  if (!ACTION_KINDS.has(kind)) throw new Error(`Unsupported browser recipe step: ${kind}`);
  const result = {
    ...base,
    risk: kind === "upload" || kind === "download"
      ? "file-transfer"
      : step.risk === "observational" ? "observational" : "consequential",
    target: normalizeTarget(step.target, `browser recipe step ${index + 1}`)
  };
  if (["type", "upload"].includes(kind)) {
    result.inputName = normalizeInputName(step.inputName);
    if (kind === "type") result.replace = step.replace !== false;
  }
  if (kind === "select") result.optionName = cleanRequired(step.optionName, 300, "browser recipe option");
  if (kind === "check") result.checked = step.checked === true;
  return result;
}

function normalizeBindings(input, maxStep) {
  const bindings = boundedArray(input || [], MAX_INPUTS, "browser recipe input bindings");
  const result = new Map();
  for (const value of bindings) {
    const step = boundedInteger(value?.step, 0, 1, maxStep);
    if (!step) throw new Error("A browser recipe input binding needs a valid step number");
    if (result.has(step)) throw new Error(`Browser recipe step ${step} has duplicate input bindings`);
    result.set(step, {
      inputName: normalizeInputName(value.input_name || value.inputName),
      label: cleanText(value.label, 120)
    });
  }
  return result;
}

function normalizeInput(input) {
  return {
    name: normalizeInputName(input?.name),
    label: cleanRequired(input?.label, 120, "browser recipe input label"),
    type: enumValue(input?.type, new Set(["string", "attachment_id"]), "string"),
    required: input?.required !== false
  };
}

function normalizeInputName(value) {
  const name = String(value || "").trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
    throw new Error("Browser recipe input names use lowercase letters, digits, and underscores");
  }
  return name;
}

function normalizeTarget(input, label) {
  const target = {
    role: cleanText(input?.role, 80),
    name: cleanText(input?.name, 300),
    tag: cleanText(input?.tag, 40).toLowerCase(),
    type: cleanText(input?.type, 40).toLowerCase(),
    destination: input?.destination ? safeUrl(input.destination) : ""
  };
  if (!target.name && !target.role && !target.tag) throw new Error(`${label} needs a semantic target contract`);
  return target;
}

function normalizeRunStats(input = {}) {
  return {
    completed: boundedInteger(input.completed, 0, 0, Number.MAX_SAFE_INTEGER),
    failed: boundedInteger(input.failed, 0, 0, Number.MAX_SAFE_INTEGER),
    drifted: boundedInteger(input.drifted, 0, 0, Number.MAX_SAFE_INTEGER),
    lastStatus: cleanText(input.lastStatus, 40),
    lastRunAt: input.lastRunAt ? timestamp(input.lastRunAt) : "",
    lastCheckpointCount: boundedInteger(input.lastCheckpointCount, 0, 0, MAX_STEPS),
    lastError: cleanText(input.lastError, 500)
  };
}

function emptyRunStats() {
  return { completed: 0, failed: 0, drifted: 0, lastStatus: "", lastRunAt: "", lastCheckpointCount: 0, lastError: "" };
}

function publicRecipe(recipe) {
  return {
    id: recipe.id,
    kind: "browser_recipe",
    name: recipe.name,
    description: recipe.description,
    status: recipe.status,
    origins: [...recipe.origins],
    inputs: structuredClone(recipe.inputs),
    steps: structuredClone(recipe.steps),
    runStats: structuredClone(recipe.runStats),
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt
  };
}

function normalizeOwner(scope = {}) {
  return {
    boundary: enumValue(scope.boundary, new Set(["online", "personal"]), "personal"),
    subjectId: cleanRequired(scope.subjectId, 256, "browser recipe subject"),
    tenantId: cleanRequired(scope.tenantId, 256, "browser recipe tenant")
  };
}

function sameOwner(left, right) {
  return left?.boundary === right?.boundary && left?.subjectId === right?.subjectId && left?.tenantId === right?.tenantId;
}

function safeUrl(value) {
  const url = new URL(cleanRequired(value, 2_048, "browser recipe URL"));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Browser recipe URLs must use HTTP(S) without embedded credentials");
  }
  return url.href;
}

function safeOrigin(value) {
  return new URL(safeUrl(value)).origin;
}

function boundedArray(value, max, label) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must contain at most ${max} items`);
  return value;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

function enumValue(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function cleanRequired(value, max, label) {
  const result = cleanText(value, max);
  if (!result) throw new Error(`Missing ${label}`);
  return result;
}

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function timestamp(value) {
  const result = new Date(value || 0);
  if (!Number.isFinite(result.getTime())) throw new Error("Browser recipe timestamps must be valid");
  return result.toISOString();
}

export const browserRecipeLimits = Object.freeze({
  maxRecipesPerOwner: MAX_RECIPES_PER_OWNER,
  maxSteps: MAX_STEPS,
  maxInputs: MAX_INPUTS
});
