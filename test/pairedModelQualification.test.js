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

test("v2 dependency batch validator checks dependencies, lanes, and tie breaks", () => {
  const response = `function planBatch(tasks, capacity) {
    let best = { score: -1, cost: Infinity, ids: [] };
    for (let mask = 0; mask < 2 ** tasks.length; mask += 1) {
      const selected = tasks.filter((_, index) => mask & (1 << index));
      const ids = selected.map((task) => task.id).sort();
      const selectedIds = new Set(ids);
      const lanes = selected.map((task) => task.lane).filter((lane) => lane != null);
      const cost = selected.reduce((sum, task) => sum + task.cost, 0);
      if (cost > capacity || new Set(lanes).size !== lanes.length) continue;
      if (!selected.every((task) => (task.dependsOn || []).every((id) => selectedIds.has(id)))) continue;
      const score = selected.reduce((sum, task) => sum + task.score, 0);
      const lexical = JSON.stringify(ids);
      const bestLexical = JSON.stringify(best.ids);
      if (score > best.score || (score === best.score && cost < best.cost) ||
          (score === best.score && cost === best.cost && lexical < bestLexical)) {
        best = { score, cost, ids };
      }
    }
    return best.ids;
  }`;
  assert.equal(evaluateJavaScript({ validator: "dependency_batch_v2" }, response).passed, true);
});

test("v2 ledger validator checks new ledgers, gaps, duplicates, and conflicts", () => {
  const response = `function applyLedger(entries, state) {
    const output = JSON.parse(JSON.stringify(state));
    const unique = new Map();
    for (const entry of entries) if (!unique.has(entry.entryId)) unique.set(entry.entryId, entry);
    const ledgers = new Set([...Object.keys(output), ...[...unique.values()].map((entry) => entry.ledgerId)]);
    for (const ledgerId of ledgers) {
      if (!output[ledgerId]) output[ledgerId] = { total: 0, version: 0 };
      const versions = new Map();
      for (const entry of unique.values()) {
        if (entry.ledgerId !== ledgerId || entry.version <= output[ledgerId].version) continue;
        const sameVersion = versions.get(entry.version) || [];
        sameVersion.push(entry);
        versions.set(entry.version, sameVersion);
      }
      while (true) {
        const next = output[ledgerId].version + 1;
        const candidates = versions.get(next);
        if (!candidates || candidates.length !== 1) break;
        output[ledgerId].total += candidates[0].amount;
        output[ledgerId].version = next;
      }
    }
    return output;
  }`;
  assert.equal(evaluateJavaScript({ validator: "ledger_stream_v2" }, response).passed, true);
});

test("v2 critical path validator checks graph validity and lexical ties", () => {
  const response = `function longestBuildPath(tasks) {
    if (tasks.length === 0) return { duration: 0, path: [] };
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const memo = new Map();
    const visiting = new Set();
    function bestTo(id) {
      if (!byId.has(id)) throw new Error("missing dependency");
      if (visiting.has(id)) throw new Error("cycle");
      if (memo.has(id)) return memo.get(id);
      visiting.add(id);
      const task = byId.get(id);
      let prefix = { duration: 0, path: [] };
      for (const dependency of task.dependsOn || []) {
        const candidate = bestTo(dependency);
        if (candidate.duration > prefix.duration ||
            (candidate.duration === prefix.duration && JSON.stringify(candidate.path) < JSON.stringify(prefix.path))) {
          prefix = candidate;
        }
      }
      visiting.delete(id);
      const result = { duration: prefix.duration + task.duration, path: [...prefix.path, id] };
      memo.set(id, result);
      return result;
    }
    let best = null;
    for (const task of tasks) {
      const candidate = bestTo(task.id);
      if (!best || candidate.duration > best.duration ||
          (candidate.duration === best.duration && JSON.stringify(candidate.path) < JSON.stringify(best.path))) best = candidate;
    }
    return best;
  }`;
  assert.equal(evaluateJavaScript({ validator: "critical_path_v2" }, response).passed, true);
});
