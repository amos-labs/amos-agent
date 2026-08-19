import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AMOS_OPERATOR_CONSTITUTION,
  AMOS_OPERATOR_CONSTITUTION_VERSION,
  DEMO_SYSTEM_PROMPT,
  OFFLINE_SYSTEM_PROMPT,
  PERSONAL_SYSTEM_PROMPT,
  SYSTEM_PROMPT
} from "../src/prompts.js";
import {
  buildPromptContract,
  canonicalizePromptTools,
  derivePromptSessionId
} from "../src/model/promptContract.js";
import {
  evaluateCompactionEconomics,
  evaluatePreferredCompaction,
  sharedMessagePrefix
} from "../src/model/promptCachePolicy.js";

test("the company agent grounds capability labels in current platform results", () => {
  assert.match(
    SYSTEM_PROMPT,
    /Never describe data, an engine, a tool, or a feature as connected, enabled, disabled, or locked unless a current platform result explicitly reports that state/
  );
  assert.match(
    SYSTEM_PROMPT,
    /Explain missing evidence or unavailable data in plain language/
  );
});

test("the company agent does not prescribe coaching without user intent or evidence", () => {
  assert.match(
    SYSTEM_PROMPT,
    /Follow the user's objective instead of steering toward a predetermined intervention/
  );
  assert.match(
    SYSTEM_PROMPT,
    /Do not introduce coaching, training, courses, or content unless the user asks for them or cited company evidence makes them relevant/
  );
});

test("the company agent leaves routine workflow narration to Desktop", () => {
  assert.match(SYSTEM_PROMPT, /Desktop already shows the selected workflow/);
  assert.match(SYSTEM_PROMPT, /Do not narrate routine planning/);
});

test("canvas guidance defaults to chat and requires a material visual advantage", () => {
  assert.match(SYSTEM_PROMPT, /Chat is the default/);
  assert.match(SYSTEM_PROMPT, /slightly longer prose does not qualify/);
  assert.match(SYSTEM_PROMPT, /When qualified, use desktop_present_company_view/);
});

test("the shared AMOS constitution is versioned and used on every boundary", () => {
  assert.equal(AMOS_OPERATOR_CONSTITUTION_VERSION, 1);
  assert.match(AMOS_OPERATOR_CONSTITUTION, /Investigate before interrogating/);
  assert.match(AMOS_OPERATOR_CONSTITUTION, /Ask only consequential questions/);
  assert.match(AMOS_OPERATOR_CONSTITUTION, /desktop_request_decision/);
  assert.match(SYSTEM_PROMPT, /call desktop_request_decision/);
  assert.doesNotMatch(AMOS_OPERATOR_CONSTITUTION, /What kind of business/);
  assert.match(AMOS_OPERATOR_CONSTITUTION, /Do not run a personality survey or a fixed questionnaire/);
  for (const prompt of [
    SYSTEM_PROMPT,
    DEMO_SYSTEM_PROMPT,
    PERSONAL_SYSTEM_PROMPT,
    OFFLINE_SYSTEM_PROMPT
  ]) {
    assert.match(prompt, /AMOS Operator constitution v1/);
    assert.match(prompt, /Investigate before interrogating/);
  }
});

test("automation setup waits for understanding instead of launching immediately", () => {
  assert.doesNotMatch(
    SYSTEM_PROMPT,
    /call desktop_begin_automation_setup once with their exact intent/
  );
  assert.match(
    SYSTEM_PROMPT,
    /Inspect available connections, schemas, and relevant company context before asking for discoverable facts/
  );
  assert.match(
    SYSTEM_PROMPT,
    /Call desktop_begin_automation_setup once when the workflow is ready to design, or immediately when the user's specification is already sufficient/
  );
  assert.match(SYSTEM_PROMPT, /Never collect credentials in chat/);
});

test("consultative doctrine is not a questionnaire, regex router, or second model", async () => {
  const prompts = await readFile(new URL("../src/prompts.js", import.meta.url), "utf8");
  assert.doesNotMatch(prompts, /services · trades · e-commerce/);
  assert.doesNotMatch(prompts, /ask what kind of business they run/i);
  assert.match(prompts, /Do not implement this as a fixed question list/);
  assert.match(prompts, /Explicit collaboration preferences change presentation only/);
  assert.match(prompts, /or a second model call to classify personality or the next move/);
  assert.doesNotMatch(prompts, /from ["'].*workflows\.js["']/);
  assert.doesNotMatch(prompts, /selectWorkflow|phrase\/regex/);
});

test("prompt contracts are stable across object property insertion order", () => {
  const leftTools = [{
    type: "function",
    function: {
      name: "lookup",
      description: "Read data",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search" } },
        required: ["query"]
      }
    }
  }];
  const rightTools = [{
    function: {
      parameters: {
        required: ["query"],
        properties: { query: { description: "Search", type: "string" } },
        type: "object"
      },
      description: "Read data",
      name: "lookup"
    },
    type: "function"
  }];
  const base = {
    provider: "openai-compatible",
    model: "qwen3.8-27b",
    tokenizer: "qwen3.8",
    chatTemplate: "qwen3.8-tools-v1",
    reasoningEffort: "medium",
    systemPrompt: "Operate safely",
    activeToolkits: ["workspace", "core"],
    authorityBoundary: { workspace: "/tmp/project", mode: "offline" },
    tenantBoundary: { tenantId: "tenant-secret" }
  };

  const left = buildPromptContract({ ...base, tools: leftTools });
  const right = buildPromptContract({ ...base, tools: rightTools });

  assert.equal(left.sha256, right.sha256);
  assert.equal(left.toolSchemaSha256, right.toolSchemaSha256);
  assert.deepEqual(canonicalizePromptTools(leftTools), canonicalizePromptTools(rightTools));
  assert.doesNotMatch(JSON.stringify(left), /tenant-secret|\/tmp\/project|Operate safely/);
});

test("prompt contracts change for material schema order, prompt, or reasoning changes", () => {
  const tool = (name) => ({ type: "function", function: { name, parameters: { type: "object" } } });
  const base = { model: "qwen", systemPrompt: "A", tools: [tool("one"), tool("two")] };

  assert.notEqual(
    buildPromptContract(base).sha256,
    buildPromptContract({ ...base, tools: [...base.tools].reverse() }).sha256
  );
  assert.notEqual(
    buildPromptContract(base).sha256,
    buildPromptContract({ ...base, systemPrompt: "B" }).sha256
  );
  assert.notEqual(
    buildPromptContract(base).sha256,
    buildPromptContract({ ...base, reasoningEffort: "high" }).sha256
  );
});

test("prompt session ids are opaque, stable, and boundary pinned", () => {
  const input = {
    sessionKey: "task-123",
    tenantBoundary: { tenantId: "tenant-secret" },
    authorityBoundary: { workspace: "/private/customer" }
  };
  const first = derivePromptSessionId(input);
  const second = derivePromptSessionId(input);

  assert.equal(first, second);
  assert.match(first, /^amos-[a-f0-9]{48}$/);
  assert.doesNotMatch(first, /task|tenant|customer/);
  assert.notEqual(first, derivePromptSessionId({
    ...input,
    tenantBoundary: { tenantId: "another-tenant" }
  }));
  assert.equal(derivePromptSessionId({}), null);
});

test("compaction waits for projected savings to repay the cache rebuild", () => {
  assert.deepEqual(evaluateCompactionEconomics({
    tokensSaved: 1_000,
    rebuildTokens: 5_000,
    expectedFutureTurns: 4,
    rebuildMargin: 1.25
  }), {
    version: 1,
    shouldCompact: false,
    reason: "cache_rebuild_cost",
    tokensSaved: 1_000,
    rebuildTokens: 5_000,
    expectedFutureTurns: 4,
    rebuildMargin: 1.25,
    projectedSavingsTokens: 4_000,
    requiredSavingsTokens: 6_250
  });
  assert.equal(evaluateCompactionEconomics({
    tokensSaved: 2_000,
    rebuildTokens: 5_000,
    expectedFutureTurns: 4
  }).shouldCompact, true);
});

test("preferred compaction measures exact-prefix reuse before rewriting", () => {
  const previous = [
    { role: "system", content: "policy" },
    { role: "user", content: "task" },
    { role: "assistant", content: "x".repeat(8_000) }
  ];
  const exact = [...previous, { role: "user", content: "continue" }];
  const compacted = [
    previous[0],
    previous[1],
    { role: "assistant", content: "Earlier evidence summary" },
    exact[3]
  ];
  const decision = evaluatePreferredCompaction({
    previousMessages: previous,
    exactMessages: exact,
    compactedMessages: compacted,
    contractReused: true,
    expectedFutureTurns: 1
  });

  assert.equal(sharedMessagePrefix(previous, exact), 3);
  assert.equal(sharedMessagePrefix(previous, compacted), 2);
  assert.equal(decision.shouldCompact, true);
  assert.ok(decision.exactReusableTokens > decision.compactedReusableTokens);
  assert.ok(decision.tokensSaved > decision.rebuildTokens);
});
