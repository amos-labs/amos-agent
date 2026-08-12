import test from "node:test";
import assert from "node:assert/strict";
import {
  argumentsContain,
  evaluateChoice,
  evaluateJavaScript,
  evaluateToolFinal,
  normalizeAssistantToolMessage,
  validatePairedSuite
} from "../src/research/pairedModelQualification.js";

test("paired suite validation rejects duplicate and unsupported cases", () => {
  assert.throws(() => validatePairedSuite({
    schema: "amos.paired-model-qualification-suite",
    version: 1,
    cases: [{ id: "x", kind: "unknown", prompt: "x", weight: 1 }]
  }), /Unsupported paired case kind/);
});

test("choice evaluation requires the label and rationale groups", () => {
  const testCase = {
    expected_label: "B",
    required_reason_groups: [["current", "authoritative"], ["executed"]]
  };
  assert.equal(evaluateChoice(testCase, '{"label":"B","reason":"Current receipt says executed"}').passed, true);
  assert.equal(evaluateChoice(testCase, '{"label":"B","reason":"It seems right"}').passed, false);
});

test("tool final evaluation applies required and forbidden contracts", () => {
  const outcome = evaluateToolFinal({
    final_must_include_groups: [["pending"], ["approval"]],
    final_must_not_include: ["launched"]
  }, "The action is pending approval.");
  assert.equal(outcome.passed, true);
  assert.equal(argumentsContain({ id: "a" }, { id: "a", extra: 1 }), true);
});

test("OpenAI tool-call messages normalize null content for strict chat templates", () => {
  const message = {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call-1", function: { name: "read", arguments: "{}" } }]
  };
  assert.deepEqual(normalizeAssistantToolMessage(message), { ...message, content: "" });
  const direct = { role: "assistant", content: null };
  assert.equal(normalizeAssistantToolMessage(direct), direct);
});

test("portfolio validator enforces dependencies, tie breaks, and immutability", () => {
  const response = `function selectPortfolio(items, budget) {
    let best = { value: -1, spend: Infinity, ids: [] };
    for (let mask = 0; mask < 2 ** items.length; mask += 1) {
      const selected = items.filter((_, i) => mask & (1 << i));
      const ids = selected.map((item) => item.id).sort();
      const set = new Set(ids);
      const spend = selected.reduce((sum, item) => sum + item.spend, 0);
      const groups = selected.map((item) => item.group).filter(Boolean);
      const valid = spend <= budget && new Set(groups).size === groups.length &&
        selected.every((item) => (item.requires || []).every((id) => set.has(id)));
      if (!valid) continue;
      const value = selected.reduce((sum, item) => sum + item.value, 0);
      const lexical = JSON.stringify(ids);
      const bestLexical = JSON.stringify(best.ids);
      if (value > best.value || (value === best.value && spend < best.spend) ||
        (value === best.value && spend === best.spend && lexical < bestLexical)) {
        best = { value, spend, ids };
      }
    }
    return best.ids;
  }`;
  assert.equal(evaluateJavaScript({ validator: "portfolio" }, response).passed, true);
});

test("event validator requires contiguous versions and rejects conflicting versions", () => {
  const response = `function reconcileBalances(events, initial) {
    const result = JSON.parse(JSON.stringify(initial));
    const seen = new Map();
    for (const event of events) if (!seen.has(event.eventId)) seen.set(event.eventId, event);
    const grouped = new Map();
    for (const event of seen.values()) {
      if (!grouped.has(event.accountId)) grouped.set(event.accountId, []);
      grouped.get(event.accountId).push(event);
    }
    for (const [accountId, values] of grouped) {
      if (!result[accountId]) result[accountId] = { balance: 0, version: 0 };
      const byVersion = new Map();
      for (const event of values) {
        const group = byVersion.get(event.version) || [];
        group.push(event);
        byVersion.set(event.version, group);
      }
      while (true) {
        const next = result[accountId].version + 1;
        const candidates = byVersion.get(next);
        if (!candidates || candidates.length !== 1) break;
        result[accountId].balance += candidates[0].delta;
        result[accountId].version = next;
      }
    }
    return result;
  }`;
  assert.equal(evaluateJavaScript({ validator: "event_reconciliation" }, response).passed, true);
});
