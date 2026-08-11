import { createHash, randomUUID } from "node:crypto";

const SESSION_ID = { type: "string", minLength: 8, maxLength: 128 };
const RECIPE_ID = { type: "string", minLength: 8, maxLength: 128 };

export function createBrowserRecipeTools({
  browser,
  store,
  recorder,
  scope,
  present = null,
  resolveAttachment = null,
  registerDownload = null,
  now = () => new Date(),
  createId = randomUUID
} = {}) {
  if (!browser || !store || !recorder || typeof scope !== "function") {
    throw new Error("Browser recipe tools require runtime, storage, recorder, and scope boundaries");
  }

  return [
    {
      name: "browser_recipe_list",
      source: "desktop-local",
      description:
        "List identity-pinned deterministic browser recipes stored on this computer. Recipes contain typed semantic contracts, never selectors, credentials, cookies, paths, or replay authority.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      handler: async () => ({ recipes: await store.list(scope()) })
    },
    {
      name: "browser_recipe_save",
      source: "desktop-local",
      description:
        "Compile the verified steps from one current browser session into an encrypted deterministic recipe. Every typed-text or upload step needs a named runtime input binding. Saving requires exact human review and does not authorize future consequential actions.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["session_id", "name", "input_bindings"],
        properties: {
          session_id: SESSION_ID,
          name: { type: "string", minLength: 1, maxLength: 160 },
          description: { type: "string", maxLength: 1_000 },
          input_bindings: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["step", "input_name"],
              properties: {
                step: { type: "integer", minimum: 1, maximum: 40 },
                input_name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
                label: { type: "string", maxLength: 120 }
              }
            }
          }
        }
      },
      handler: async (args, context) => {
        const currentScope = scope();
        const draft = recorder.draft(args.session_id, currentScope);
        const approved = await context.approvals.confirm(
          recipeSaveApproval(args, draft),
          { kind: "browser-action" }
        );
        if (!approved) return { ok: false, status: "denied", denied: true };
        const recipe = await store.save(currentScope, draft, {
          name: args.name,
          description: args.description,
          inputBindings: args.input_bindings
        });
        return {
          ok: true,
          status: "saved",
          recipe,
          message: "Saved an encrypted deterministic recipe. Future consequence approvals remain separate."
        };
      }
    },
    {
      name: "browser_recipe_run",
      source: "desktop-local",
      description:
        "Run a saved browser recipe as a deterministic typed state machine without an LLM. Exact semantic target drift stops safely. Consequential steps and file transfers still require fresh exact approval. Supply an existing session_id after user login when authentication is required.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["recipe_id", "inputs"],
        properties: {
          recipe_id: RECIPE_ID,
          session_id: SESSION_ID,
          inputs: {
            type: "object",
            additionalProperties: { type: "string", maxLength: 5_000 },
            maxProperties: 20
          }
        }
      },
      handler: async (args, context) => runRecipe({
        browser,
        store,
        scope: scope(),
        recipeId: args.recipe_id,
        sessionId: args.session_id,
        inputs: args.inputs,
        context,
        present,
        resolveAttachment,
        registerDownload,
        now,
        createId
      })
    },
    {
      name: "browser_recipe_remove",
      source: "desktop-local",
      description:
        "Remove one encrypted browser recipe owned by the current AMOS identity after exact human confirmation. This does not affect Platform automations or connectors.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["recipe_id"],
        properties: { recipe_id: RECIPE_ID }
      },
      handler: async (args, context) => {
        const currentScope = scope();
        const recipe = await store.get(currentScope, args.recipe_id);
        const approved = await context.approvals.confirm(
          `Remove the local deterministic browser recipe “${recipe.name}”?\n\nThis affects only this identity on this computer.`,
          { kind: "browser-action" }
        );
        if (!approved) return { ok: false, status: "denied", denied: true };
        return { ok: true, removed: await store.remove(currentScope, recipe.id), recipe_id: recipe.id };
      }
    }
  ];
}

async function runRecipe({
  browser,
  store,
  scope,
  recipeId,
  sessionId,
  inputs,
  context,
  present,
  resolveAttachment,
  registerDownload,
  now,
  createId
}) {
  const recipe = await store.get(scope, recipeId);
  if (recipe.status === "paused") throw new Error("That browser recipe is paused");
  const runtimeInputs = validateInputs(recipe, inputs);
  const checkpoints = [];
  let current = null;
  let currentSessionId = sessionId || null;
  const createdSession = !currentSessionId;
  let downloadedAttachment = null;
  try {
    for (let index = 0; index < recipe.steps.length; index += 1) {
      const step = recipe.steps[index];
      const beforeRevision = current?.page_revision ?? null;
      let result;
      if (step.kind === "open") {
        result = await browser.open(scope, {
          url: step.url,
          sessionId: currentSessionId,
          signal: context.signal
        });
        currentSessionId = result.session_id;
      } else {
        if (!currentSessionId) throw new RecipeDriftError("The recipe has no active browser session");
        if (!current?.elements) {
          current = await browser.snapshot(scope, { sessionId: currentSessionId, signal: context.signal });
        }
        result = step.kind === "wait"
          ? await browser.wait(scope, {
              sessionId: currentSessionId,
              condition: step.condition,
              value: step.value,
              timeoutMs: step.timeoutMs,
              signal: context.signal
            })
          : await executeActionStep({
              browser,
              scope,
              step,
              current,
              runtimeInputs,
              context,
              resolveAttachment,
              registerDownload
            });
      }
      if (result?.takeover_required) {
        throw new RecipeStopError("Authentication or a sensitive field requires direct user takeover", "blocked");
      }
      if (result?.denied) throw new RecipeStopError("The user denied this exact recipe step", "denied");
      downloadedAttachment = result?.downloaded_attachment || downloadedAttachment;
      current = result;
      const receipt = result.action_receipt || result.transfer_receipt || null;
      checkpoints.push({
        step: index + 1,
        step_id: step.id,
        operation: step.kind,
        status: "completed",
        before_page_revision: beforeRevision,
        after_page_revision: result.page_revision ?? null,
        receipt_id: receipt?.receipt_id || null,
        verified: receipt ? receipt.verified === true : true,
        observed_at: result.observed_at || now().toISOString()
      });
      if (typeof present === "function") {
        await present({
          operation: "recipe_checkpoint",
          ...result,
          ...(downloadedAttachment ? { downloaded_attachment: downloadedAttachment } : {}),
          summary: `Recipe “${recipe.name}” completed step ${index + 1} of ${recipe.steps.length}: ${step.kind}.`
        });
      }
    }
    const receipt = recipeRunReceipt({ recipe, checkpoints, current, now, createId });
    const updatedRecipe = await store.recordRun(scope, recipe.id, { status: "completed", checkpoints });
    if (createdSession && currentSessionId) {
      await browser.close(scope, { sessionId: currentSessionId }).catch(() => {});
    }
    return {
      ok: true,
      status: "completed",
      recipe: updatedRecipe,
      session_id: currentSessionId,
      checkpoints,
      recipe_receipt: receipt,
      ...(downloadedAttachment ? { downloaded_attachment: downloadedAttachment } : {}),
      summary: `Completed ${checkpoints.length} deterministic browser recipe steps without model-directed execution.`
    };
  } catch (error) {
    const status = isDriftError(error)
      ? "drifted"
      : error instanceof RecipeStopError ? error.status : "failed";
    await store.recordRun(scope, recipe.id, {
      status,
      checkpoints,
      error: error.message
    }).catch(() => {});
    return {
      ok: false,
      status,
      recipe_id: recipe.id,
      session_id: currentSessionId,
      stopped_at_step: checkpoints.length + 1,
      checkpoints,
      repair_required: status === "drifted",
      takeover_required: status === "blocked",
      message: safeError(error)
    };
  }
}

async function executeActionStep({
  browser,
  scope,
  step,
  current,
  runtimeInputs,
  context,
  resolveAttachment,
  registerDownload
}) {
  const target = resolveTarget(current.elements, step.target, `step ${step.id}`);
  if (step.kind === "upload") {
    if (typeof resolveAttachment !== "function") throw new Error("Browser recipe uploads are unavailable");
    const attachmentId = runtimeInputs[step.inputName];
    const attachment = await resolveAttachment(attachmentId);
    const prepared = await browser.prepareUpload(scope, {
      sessionId: current.session_id,
      ref: target.ref,
      attachment,
      signal: context.signal
    });
    const decision = await approvePrepared(prepared, context, { attachment });
    if (decision) {
      await browser.cancelPreparedUpload(scope, { plan: prepared.plan }).catch(() => {});
      return decision;
    }
    try {
      return await browser.performUpload(scope, {
        plan: prepared.plan,
        approved: true,
        signal: context.signal
      });
    } catch (error) {
      await browser.cancelPreparedUpload(scope, { plan: prepared.plan }).catch(() => {});
      throw error;
    }
  }
  if (step.kind === "download") {
    if (typeof registerDownload !== "function") throw new Error("Browser recipe downloads are unavailable");
    const prepared = await browser.prepareDownload(scope, {
      sessionId: current.session_id,
      ref: target.ref,
      signal: context.signal
    });
    const decision = await approvePrepared(prepared, context);
    if (decision) return decision;
    const completed = await browser.performDownload(scope, {
      plan: prepared.plan,
      approved: true,
      signal: context.signal
    });
    return {
      ...completed.result,
      downloaded_attachment: await registerDownload(completed.transfer)
    };
  }
  const option = step.kind === "select"
    ? resolveTarget(current.elements, { role: "option", name: step.optionName, tag: "option", type: "option", destination: "" }, `option for ${step.id}`)
    : null;
  const prepared = await browser.prepareAction(scope, {
    sessionId: current.session_id,
    kind: step.kind,
    ref: target.ref,
    optionRef: option?.ref,
    text: step.kind === "type" ? runtimeInputs[step.inputName] : undefined,
    replace: step.replace,
    checked: step.checked,
    signal: context.signal
  });
  const decision = await approvePrepared(prepared, context, {
    text: step.kind === "type" ? runtimeInputs[step.inputName] : ""
  });
  if (decision) return decision;
  return browser.performAction(scope, {
    plan: prepared.plan,
    approved: prepared.requires_approval,
    signal: context.signal
  });
}

async function approvePrepared(prepared, context, payload = {}) {
  if (prepared.takeover_required) {
    return {
      ...prepared.observation,
      ok: false,
      status: "blocked",
      takeover_required: true
    };
  }
  if (!prepared.requires_approval) return null;
  const approved = await context.approvals.confirm(
    recipeStepApproval(prepared.public_action, payload),
    { kind: "browser-action" }
  );
  if (approved) return null;
  return {
    ...prepared.observation,
    ok: false,
    status: "denied",
    denied: true
  };
}

function resolveTarget(elements, contract, label) {
  const candidates = (Array.isArray(elements) ? elements : []).filter((element) => {
    if (element.disabled) return false;
    if (contract.role && element.role !== contract.role) return false;
    if (contract.name && element.name !== contract.name) return false;
    if (contract.tag && element.tag !== contract.tag) return false;
    if (contract.type && element.type !== contract.type) return false;
    if (contract.destination && element.href !== contract.destination) return false;
    return true;
  });
  if (candidates.length !== 1) {
    throw new RecipeDriftError(
      `${label} expected exactly one semantic match but found ${candidates.length}; AMOS did not retarget it`
    );
  }
  return candidates[0];
}

function validateInputs(recipe, input) {
  const values = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const expected = new Set(recipe.inputs.map((item) => item.name));
  for (const key of Object.keys(values)) {
    if (!expected.has(key)) throw new Error(`Unexpected browser recipe input: ${key}`);
  }
  const result = {};
  for (const descriptor of recipe.inputs) {
    const value = values[descriptor.name];
    if (typeof value !== "string" || value.length === 0 || value.length > 5_000) {
      throw new Error(`Browser recipe input ${descriptor.name} is required`);
    }
    result[descriptor.name] = value;
  }
  return result;
}

function recipeSaveApproval(args, draft) {
  return [
    "Save this deterministic browser recipe on this computer?",
    "",
    `Name: ${args.name}`,
    `Verified steps: ${draft.steps.length}`,
    `Origins: ${[...new Set(draft.steps.filter((step) => step.url).map((step) => new URL(step.url).origin))].join(", ")}`,
    `Runtime inputs: ${(args.input_bindings || []).map((binding) => `${binding.input_name} (step ${binding.step})`).join(", ") || "none"}`,
    "",
    "The recipe stores semantic contracts only—no selectors, typed text, credentials, cookies, file paths, or approval authority.",
    "Future consequential steps still require fresh exact approval."
  ].join("\n");
}

function recipeStepApproval(action, payload) {
  const details = [
    "A deterministic AMOS browser recipe reached a consequential step:",
    "",
    `Origin: ${action.origin}`,
    `Page revision: ${action.page_revision}`,
    `Action: ${action.action}`,
    `Target: ${action.target?.role || action.target?.tag || "element"}${action.target?.name ? ` — ${action.target.name}` : ""}`
  ];
  if (action.action === "type") {
    const text = String(payload.text || "");
    details.push(`Text: ${JSON.stringify(text.slice(0, 500))}${text.length > 500 ? "…" : ""}`);
  }
  if (action.action === "upload") {
    details.push(
      `Attachment: ${payload.attachment?.name}`,
      `SHA-256: ${payload.attachment?.sha256}`
    );
  }
  details.push("", "Approval applies only to this live page revision, exact target, and payload.");
  return details.join("\n");
}

function recipeRunReceipt({ recipe, checkpoints, current, now, createId }) {
  return {
    contract: "amos.browser-recipe-run:1",
    receipt_id: createId(),
    recipe_id: recipe.id,
    recipe_version: recipe.version,
    recipe_sha256: createHash("sha256").update(JSON.stringify({
      origins: recipe.origins,
      inputs: recipe.inputs,
      steps: recipe.steps
    })).digest("hex"),
    status: "completed",
    checkpoint_count: checkpoints.length,
    checkpoint_receipts: checkpoints.map((checkpoint) => checkpoint.receipt_id).filter(Boolean),
    final_url: current?.url || "",
    final_page_revision: current?.page_revision ?? null,
    executed_at: now().toISOString(),
    verified: checkpoints.every((checkpoint) => checkpoint.verified === true)
  };
}

function safeError(error) {
  return String(error?.message || "Browser recipe stopped safely").replace(/(?:\/[^\s]+)+/g, "[local path]").slice(0, 500);
}

function isDriftError(error) {
  return error instanceof RecipeDriftError ||
    /(?:semantic match|target changed|reference expired|page revision|take a fresh snapshot|no longer visible)/i
      .test(String(error?.message || ""));
}

class RecipeDriftError extends Error {}

class RecipeStopError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
