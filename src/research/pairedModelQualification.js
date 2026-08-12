import vm from "node:vm";

const SUITE_SCHEMA = "amos.paired-model-qualification-suite";
const SUPPORTED_KINDS = new Set(["choice", "tool_flow", "javascript"]);

export function validatePairedSuite(value) {
  if (value?.schema !== SUITE_SCHEMA || value?.version !== 1) {
    throw new Error(`Expected ${SUITE_SCHEMA} version 1`);
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw new Error("Paired qualification suite requires cases");
  }
  const ids = new Set();
  for (const testCase of value.cases) {
    if (!testCase?.id || ids.has(testCase.id)) {
      throw new Error(`Duplicate or missing paired case id: ${testCase?.id || "(missing)"}`);
    }
    ids.add(testCase.id);
    if (!SUPPORTED_KINDS.has(testCase.kind)) {
      throw new Error(`Unsupported paired case kind for ${testCase.id}: ${testCase.kind}`);
    }
    if (!testCase.prompt || !Number.isInteger(testCase.weight) || testCase.weight < 1) {
      throw new Error(`Paired case ${testCase.id} requires a prompt and positive integer weight`);
    }
    if (testCase.kind === "choice") validateChoice(testCase);
    if (testCase.kind === "tool_flow") validateToolFlow(testCase);
    if (testCase.kind === "javascript" && ![
      "portfolio",
      "event_reconciliation",
      "dependency_batch_v2",
      "ledger_stream_v2",
      "critical_path_v2"
    ].includes(testCase.validator)) {
      throw new Error(`Unsupported JavaScript validator for ${testCase.id}: ${testCase.validator}`);
    }
  }
  return value;
}

export function evaluateChoice(testCase, response) {
  const parsed = parseJsonObject(response);
  const label = String(parsed?.label || "").trim().toUpperCase();
  const reason = normalizedText(parsed?.reason);
  const missingReasonGroups = (testCase.required_reason_groups || []).filter((group) =>
    !group.some((term) => reason.includes(normalizedText(term)))
  );
  const forbidden = (testCase.forbidden_reason_terms || [])
    .filter((term) => reason.includes(normalizedText(term)));
  return {
    passed:
      label === String(testCase.expected_label).toUpperCase() &&
      missingReasonGroups.length === 0 &&
      forbidden.length === 0,
    valid_json: Boolean(parsed),
    label,
    expected_label: testCase.expected_label,
    missing_reason_groups: missingReasonGroups,
    forbidden_reason_terms_present: forbidden
  };
}

export function evaluateToolFinal(testCase, response) {
  const text = normalizedText(response);
  const missing = (testCase.final_must_include_groups || []).filter((group) =>
    !group.some((term) => text.includes(normalizedText(term)))
  );
  const forbidden = (testCase.final_must_not_include || [])
    .filter((term) => text.includes(normalizedText(term)));
  return {
    passed: missing.length === 0 && forbidden.length === 0,
    missing_final_groups: missing,
    forbidden_final_terms_present: forbidden
  };
}

export function evaluateJavaScript(testCase, response) {
  const code = extractCode(response);
  if (testCase.validator === "portfolio") return evaluatePortfolio(code);
  if (testCase.validator === "event_reconciliation") return evaluateEventReconciliation(code);
  if (testCase.validator === "dependency_batch_v2") return evaluateDependencyBatchV2(code);
  if (testCase.validator === "ledger_stream_v2") return evaluateLedgerStreamV2(code);
  if (testCase.validator === "critical_path_v2") return evaluateCriticalPathV2(code);
  throw new Error(`Unsupported JavaScript validator: ${testCase.validator}`);
}

export function toolArguments(call) {
  const value = call?.function?.arguments;
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return null;
  }
}

export function normalizeAssistantToolMessage(message) {
  if (!message || typeof message !== "object") return message;
  if ((message.tool_calls || []).length === 0 || message.content != null) return message;
  return { ...message, content: "" };
}

export function argumentsContain(expected, actual) {
  if (!actual || typeof actual !== "object") return false;
  return Object.entries(expected || {}).every(([key, value]) =>
    JSON.stringify(actual[key]) === JSON.stringify(value)
  );
}

function validateChoice(testCase) {
  if (!testCase.expected_label) {
    throw new Error(`Choice case ${testCase.id} requires expected_label`);
  }
  for (const group of testCase.required_reason_groups || []) {
    if (!Array.isArray(group) || group.length === 0) {
      throw new Error(`Choice case ${testCase.id} has an empty reason group`);
    }
  }
}

function validateToolFlow(testCase) {
  if (!Array.isArray(testCase.tools) || testCase.tools.length === 0) {
    throw new Error(`Tool-flow case ${testCase.id} requires tools`);
  }
  if (!Array.isArray(testCase.steps) || testCase.steps.length === 0) {
    throw new Error(`Tool-flow case ${testCase.id} requires steps`);
  }
  const names = new Set(testCase.tools.map((tool) => tool.function?.name));
  for (const step of testCase.steps) {
    if (!names.has(step.function)) {
      throw new Error(`Tool-flow case ${testCase.id} references unknown tool ${step.function}`);
    }
  }
}

function evaluatePortfolio(code) {
  const tests = [
    {
      items: [
        { id: "a", spend: 4, value: 8, group: "search", requires: [] },
        { id: "b", spend: 5, value: 11, group: "social", requires: ["d"] },
        { id: "c", spend: 3, value: 7, group: "search", requires: [] },
        { id: "d", spend: 2, value: 3, group: null, requires: [] }
      ],
      budget: 7,
      expected: ["b", "d"]
    },
    {
      items: [
        { id: "alpha", spend: 3, value: 6, group: null, requires: [] },
        { id: "beta", spend: 3, value: 6, group: null, requires: [] },
        { id: "gamma", spend: 6, value: 12, group: null, requires: [] }
      ],
      budget: 6,
      expected: ["alpha", "beta"]
    },
    {
      items: [
        { id: "a", spend: 2, value: 5, group: "g", requires: [] },
        { id: "b", spend: 2, value: 5, group: "g", requires: [] },
        { id: "c", spend: 1, value: 2, group: null, requires: ["missing"] }
      ],
      budget: 3,
      expected: ["a"]
    }
  ];
  return runFunctionTests(code, "selectPortfolio", tests, ({ fn, test }) => {
    const before = JSON.stringify(test.items);
    const output = fn(structuredClone(test.items), test.budget);
    const ids = Array.from(output || [], String);
    return {
      passed:
        JSON.stringify(ids) === JSON.stringify(test.expected) &&
        JSON.stringify(test.items) === before,
      detail: { expected: test.expected, actual: ids }
    };
  });
}

function evaluateEventReconciliation(code) {
  const tests = [
    {
      initial: { a: { balance: 10, version: 1 } },
      events: [
        { eventId: "e3", accountId: "a", version: 3, delta: -2 },
        { eventId: "e2", accountId: "a", version: 2, delta: 5 },
        { eventId: "e2", accountId: "a", version: 2, delta: 5 }
      ],
      expected: { a: { balance: 13, version: 3 } }
    },
    {
      initial: { a: { balance: 4, version: 0 }, b: { balance: 9, version: 2 } },
      events: [
        { eventId: "a2", accountId: "a", version: 2, delta: 7 },
        { eventId: "b3", accountId: "b", version: 3, delta: -4 },
        { eventId: "a3", accountId: "a", version: 3, delta: 2 }
      ],
      expected: { a: { balance: 4, version: 0 }, b: { balance: 5, version: 3 } }
    },
    {
      initial: { a: { balance: 0, version: 0 } },
      events: [
        { eventId: "x", accountId: "a", version: 1, delta: 3 },
        { eventId: "y", accountId: "a", version: 1, delta: 9 },
        { eventId: "z", accountId: "a", version: 2, delta: 2 }
      ],
      expected: { a: { balance: 0, version: 0 } }
    }
  ];
  return runFunctionTests(code, "reconcileBalances", tests, ({ fn, test }) => {
    const initialBefore = JSON.stringify(test.initial);
    const eventsBefore = JSON.stringify(test.events);
    const output = fn(structuredClone(test.events), structuredClone(test.initial));
    return {
      passed:
        JSON.stringify(output) === JSON.stringify(test.expected) &&
        JSON.stringify(test.initial) === initialBefore &&
        JSON.stringify(test.events) === eventsBefore,
      detail: { expected: test.expected, actual: output }
    };
  });
}

function evaluateDependencyBatchV2(code) {
  const tests = [
    {
      tasks: [
        { id: "base", cost: 2, score: 2, lane: null, dependsOn: [] },
        { id: "alpha", cost: 3, score: 8, lane: "growth", dependsOn: ["base"] },
        { id: "beta", cost: 4, score: 9, lane: "growth", dependsOn: [] },
        { id: "gamma", cost: 2, score: 6, lane: null, dependsOn: ["alpha"] }
      ],
      capacity: 7,
      expected: ["alpha", "base", "gamma"]
    },
    {
      tasks: [
        { id: "a", cost: 2, score: 5, lane: null, dependsOn: [] },
        { id: "b", cost: 2, score: 5, lane: null, dependsOn: [] },
        { id: "c", cost: 4, score: 10, lane: null, dependsOn: [] }
      ],
      capacity: 4,
      expected: ["a", "b"]
    },
    {
      tasks: [
        { id: "a", cost: 1, score: 4, lane: "one", dependsOn: ["missing"] },
        { id: "b", cost: 1, score: 4, lane: "one", dependsOn: [] },
        { id: "c", cost: 1, score: 4, lane: "two", dependsOn: [] }
      ],
      capacity: 2,
      expected: ["b", "c"]
    }
  ];
  return runFunctionTests(code, "planBatch", tests, ({ fn, test }) => {
    const before = JSON.stringify(test.tasks);
    const output = Array.from(fn(structuredClone(test.tasks), test.capacity) || [], String);
    return {
      passed: JSON.stringify(output) === JSON.stringify(test.expected) && JSON.stringify(test.tasks) === before,
      detail: { expected: test.expected, actual: output }
    };
  });
}

function evaluateLedgerStreamV2(code) {
  const tests = [
    {
      state: { x: { total: 10, version: 1 } },
      entries: [
        { entryId: "x3", ledgerId: "x", version: 3, amount: -4 },
        { entryId: "x2", ledgerId: "x", version: 2, amount: 9 },
        { entryId: "x2", ledgerId: "x", version: 2, amount: 9 }
      ],
      expected: { x: { total: 15, version: 3 } }
    },
    {
      state: {},
      entries: [
        { entryId: "a2", ledgerId: "a", version: 2, amount: 8 },
        { entryId: "b1", ledgerId: "b", version: 1, amount: 5 }
      ],
      expected: { a: { total: 0, version: 0 }, b: { total: 5, version: 1 } }
    },
    {
      state: { x: { total: 2, version: 0 } },
      entries: [
        { entryId: "left", ledgerId: "x", version: 1, amount: 3 },
        { entryId: "right", ledgerId: "x", version: 1, amount: 7 },
        { entryId: "later", ledgerId: "x", version: 2, amount: 11 }
      ],
      expected: { x: { total: 2, version: 0 } }
    }
  ];
  return runFunctionTests(code, "applyLedger", tests, ({ fn, test }) => {
    const entriesBefore = JSON.stringify(test.entries);
    const stateBefore = JSON.stringify(test.state);
    const output = fn(structuredClone(test.entries), structuredClone(test.state));
    return {
      passed:
        JSON.stringify(output) === JSON.stringify(test.expected) &&
        JSON.stringify(test.entries) === entriesBefore &&
        JSON.stringify(test.state) === stateBefore,
      detail: { expected: test.expected, actual: output }
    };
  });
}

function evaluateCriticalPathV2(code) {
  const tests = [
    {
      tasks: [
        { id: "compile", duration: 4, dependsOn: ["lint"] },
        { id: "lint", duration: 2, dependsOn: [] },
        { id: "docs", duration: 3, dependsOn: [] },
        { id: "ship", duration: 1, dependsOn: ["compile", "docs"] }
      ],
      expected: { duration: 7, path: ["lint", "compile", "ship"] }
    },
    {
      tasks: [
        { id: "a", duration: 2, dependsOn: [] },
        { id: "b", duration: 3, dependsOn: ["a"] },
        { id: "c", duration: 2, dependsOn: [] },
        { id: "d", duration: 3, dependsOn: ["c"] }
      ],
      expected: { duration: 5, path: ["a", "b"] }
    },
    { tasks: [], expected: { duration: 0, path: [] } }
  ];
  const outcome = runFunctionTests(code, "longestBuildPath", tests, ({ fn, test }) => {
    const before = JSON.stringify(test.tasks);
    const output = fn(structuredClone(test.tasks));
    return {
      passed: JSON.stringify(output) === JSON.stringify(test.expected) && JSON.stringify(test.tasks) === before,
      detail: { expected: test.expected, actual: output }
    };
  });
  if (!outcome.passed) return outcome;
  try {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(`"use strict";\n${code}`, sandbox, { timeout: 1_000 });
    const fn = sandbox.longestBuildPath;
    assertThrows(fn, [{ id: "a", duration: 1, dependsOn: ["missing"] }]);
    assertThrows(fn, [
      { id: "a", duration: 1, dependsOn: ["b"] },
      { id: "b", duration: 1, dependsOn: ["a"] }
    ]);
    return outcome;
  } catch (error) {
    return { passed: false, error: error.message, code };
  }
}

function assertThrows(fn, input) {
  let threw = false;
  try {
    fn(structuredClone(input));
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("longestBuildPath must throw for invalid dependency graphs");
}

function runFunctionTests(code, functionName, tests, execute) {
  try {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(`"use strict";\n${code}`, sandbox, { timeout: 1_000 });
    const fn = sandbox[functionName];
    if (typeof fn !== "function") {
      return { passed: false, error: `${functionName} is not defined`, code };
    }
    const outcomes = tests.map((test) => execute({ fn, test }));
    return {
      passed: outcomes.every((outcome) => outcome.passed),
      outcomes,
      code
    };
  } catch (error) {
    return { passed: false, error: error.message, code };
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(stripFence(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stripFence(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractCode(value) {
  const text = String(value || "").trim();
  const match = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  return (match?.[1] || text).trim();
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
