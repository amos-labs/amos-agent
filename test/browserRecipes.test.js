import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserRecipeRecorder } from "../src/desktop/browserRecipeRecorder.js";
import { BrowserRecipeStore } from "../src/desktop/browserRecipeStore.js";
import { createBrowserRecipeTools } from "../src/tools/browserRecipes.js";

const timestamp = "2026-08-11T12:00:00.000Z";
const scope = {
  boundary: "online",
  subjectId: "user-1",
  tenantId: "tenant-1",
  taskId: "task-1"
};

test("browser recipe recorder keeps verified semantic contracts without typed text, selectors, or paths", () => {
  const recorder = new BrowserRecipeRecorder({ now: () => new Date(timestamp) });
  recorder.record(scope, {
    operation: "open",
    args: { url: "https://example.com/private?record=1" },
    result: browserPage({ url: "https://example.com/form" })
  });
  recorder.record(scope, {
    operation: "type",
    args: {
      session_id: "browser-session-1",
      ref: "el_name",
      text: "confidential customer text",
      selector: "#name",
      path: "/Users/example/secret.txt"
    },
    result: {
      ...browserPage(),
      action_receipt: actionReceipt("type", {
        role: "textbox",
        name: "Customer name",
        tag: "input",
        type: "text"
      }, { characters: 26, sha256: "a".repeat(64), replace: true })
    }
  });

  const draft = recorder.draft("browser-session-1", scope);
  assert.equal(draft.steps.length, 2);
  assert.equal(draft.steps[1].payload.requiresInput, true);
  assert.equal(draft.steps[1].target.name, "Customer name");
  const encoded = JSON.stringify(draft);
  assert.doesNotMatch(encoded, /confidential customer text|#name|\/Users\/example/);
  assert.throws(
    () => recorder.draft("browser-session-1", { ...scope, taskId: "task-2" }),
    /another task|no longer available/
  );
});

test("browser recipe store encrypts identity-pinned typed state machines", async (t) => {
  const fixture = await recipeFixture(t);
  const recipe = await fixture.store.save(scope, recipeDraft(), {
    name: "Submit monthly scorecard",
    description: "Open the scorecard and submit one approved field.",
    inputBindings: [{ step: 3, input_name: "scorecard_note", label: "Scorecard note" }]
  });

  assert.equal(recipe.kind, "browser_recipe");
  assert.deepEqual(recipe.inputs, [{
    name: "scorecard_note",
    label: "Scorecard note",
    type: "string",
    required: true
  }]);
  assert.equal(recipe.steps[2].inputName, "scorecard_note");
  assert.equal(recipe.steps[2].text, undefined);
  const outer = await readFile(fixture.filePath, "utf8");
  assert.doesNotMatch(outer, /Submit monthly scorecard|example\.com|scorecard_note/);
  assert.match(outer, /encryptedRecord/);
  await assert.rejects(
    fixture.store.get({ ...scope, subjectId: "user-2" }, recipe.id),
    /not available/
  );
});

test("browser recipes replay deterministically with exact target approvals and checkpoints", async (t) => {
  const fixture = await recipeFixture(t);
  const recipe = await fixture.store.save(scope, recipeDraft(), {
    name: "Submit monthly scorecard",
    inputBindings: [{ step: 3, input_name: "scorecard_note", label: "Scorecard note" }]
  });
  const calls = [];
  const approvals = [];
  const browser = deterministicBrowser(calls);
  const tools = createBrowserRecipeTools({
    browser,
    store: fixture.store,
    recorder: new BrowserRecipeRecorder(),
    scope: () => scope,
    now: () => new Date(timestamp),
    createId: () => "run-receipt-1",
    present: async (input) => {
      calls.push({ method: "present", operation: input.operation });
      return { id: "canvas-1" };
    }
  });
  assert.deepEqual(tools.map((tool) => tool.name), [
    "browser_recipe_list",
    "browser_recipe_save",
    "browser_recipe_run",
    "browser_recipe_remove"
  ]);

  const result = await tools.find((tool) => tool.name === "browser_recipe_run").handler({
    recipe_id: recipe.id,
    inputs: { scorecard_note: "Revenue is 12% above plan." }
  }, {
    signal: new AbortController().signal,
    approvals: {
      async confirm(message, options) {
        approvals.push({ message, options });
        return true;
      }
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.checkpoints.length, 3);
  assert.equal(result.recipe_receipt.contract, "amos.browser-recipe-run:1");
  assert.equal(result.recipe_receipt.verified, true);
  assert.equal(result.recipe.runStats.completed, 1);
  assert.equal(approvals.length, 2);
  assert.match(approvals[1].message, /Revenue is 12% above plan/);
  assert.equal(calls.filter((call) => call.method === "prepareAction").length, 2);
  assert.equal(calls.some((call) => call.method === "close"), true);
});

test("browser recipe target drift stops without retargeting or performing an action", async (t) => {
  const fixture = await recipeFixture(t);
  const recipe = await fixture.store.save(scope, {
    steps: recipeDraft().steps.slice(0, 2)
  }, { name: "Open and submit", inputBindings: [] });
  let performed = 0;
  const browser = deterministicBrowser([], {
    elements: [{ ref: "el_other", role: "button", name: "Delete", tag: "button", type: "button", href: "" }],
    onPerform: () => { performed += 1; }
  });
  const tools = createBrowserRecipeTools({
    browser,
    store: fixture.store,
    recorder: new BrowserRecipeRecorder(),
    scope: () => scope
  });
  const result = await tools.find((tool) => tool.name === "browser_recipe_run").handler({
    recipe_id: recipe.id,
    inputs: {}
  }, {
    signal: new AbortController().signal,
    approvals: { async confirm() { return true; } }
  });

  assert.equal(result.status, "drifted");
  assert.equal(result.repair_required, true);
  assert.equal(result.stopped_at_step, 2);
  assert.equal(performed, 0);
  assert.match(result.message, /exactly one semantic match/);
  const updated = await fixture.store.get(scope, recipe.id);
  assert.equal(updated.status, "attention");
  assert.equal(updated.runStats.drifted, 1);
});

async function recipeFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "amos-browser-recipes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "browser-recipes.json");
  return {
    filePath,
    store: new BrowserRecipeStore({
      filePath,
      encrypt: (value) => Buffer.from(value).toString("base64"),
      decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
      now: () => new Date(timestamp),
      createId: () => "recipe-123"
    })
  };
}

function recipeDraft() {
  return {
    steps: [
      { kind: "open", url: "https://example.com/scorecard", title: "Scorecard" },
      {
        kind: "click",
        risk: "consequential",
        target: { role: "button", name: "Submit", tag: "button", type: "button", destination: "" },
        payload: {}
      },
      {
        kind: "type",
        risk: "consequential",
        target: { role: "textbox", name: "Scorecard note", tag: "input", type: "text", destination: "" },
        payload: { requiresInput: true, replace: true }
      }
    ]
  };
}

function deterministicBrowser(calls, { elements = null, onPerform = null } = {}) {
  const defaultElements = [
    { ref: "el_submit", role: "button", name: "Submit", tag: "button", type: "button", href: "" },
    { ref: "el_note", role: "textbox", name: "Scorecard note", tag: "input", type: "text", href: "" }
  ];
  let revision = 1;
  return {
    async open(_scope, input) {
      calls.push({ method: "open", input });
      return browserPage({ page_revision: revision, elements: elements || defaultElements });
    },
    async snapshot() {
      calls.push({ method: "snapshot" });
      return browserPage({ page_revision: revision, elements: elements || defaultElements });
    },
    async prepareAction(_scope, input) {
      calls.push({ method: "prepareAction", input });
      const target = (elements || defaultElements).find((item) => item.ref === input.ref);
      return {
        plan: { id: `plan-${revision}`, kind: input.kind },
        requires_approval: true,
        takeover_required: false,
        public_action: {
          action: input.kind,
          origin: "https://example.com",
          page_revision: revision,
          target,
          payload: {}
        },
        observation: browserPage({ page_revision: revision, elements: elements || defaultElements })
      };
    },
    async performAction(_scope, input) {
      calls.push({ method: "performAction", input });
      onPerform?.();
      revision += 1;
      const target = input.plan.kind === "type" ? defaultElements[1] : defaultElements[0];
      return {
        ...browserPage({ page_revision: revision, elements: elements || defaultElements }),
        action_receipt: actionReceipt(input.plan.kind, target, {})
      };
    },
    async close() {
      calls.push({ method: "close" });
      return { status: "closed" };
    }
  };
}

function browserPage(overrides = {}) {
  return {
    ok: true,
    session_id: "browser-session-1",
    url: "https://example.com/scorecard",
    title: "Scorecard",
    page_revision: 1,
    observed_at: timestamp,
    elements: [],
    ...overrides
  };
}

function actionReceipt(action, target, payload) {
  return {
    contract: "amos.browser-action:1",
    receipt_id: `receipt-${action}`,
    action,
    target,
    payload,
    verified: true
  };
}
