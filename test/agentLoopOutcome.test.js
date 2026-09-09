import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../src/agentLoop.js";
import { ToolRegistry } from "../src/tools/registry.js";

function createLoop({ chat, registry = new ToolRegistry(), agent = {} }) {
  return new AgentLoop({
    config: { agent }, registry, approvals: {}, amosClient: {},
    modelClient: { chat }
  });
}

for (const scenario of [
  { name: "repeated writes", reason: "repeated_tool_request", limit: 3 },
  { name: "repeated reads", reason: "repeated_tool_request", limit: 2, readOnly: true },
  { name: "failed repair", reason: "tool_failure", limit: 2, failed: true },
  { name: "varied plans reaching the cycle budget", reason: "tool_cycle_limit", limit: 3, varied: true }
]) {
  test(`${scenario.name} returns useful text without recording successful completion`, async () => {
    const registry = new ToolRegistry();
    let executions = 0;
    let modelCalls = 0;
    const events = [];
    registry.register({
      name: "work_on_artifact", readOnly: scenario.readOnly === true,
      handler: async () => {
        executions += 1;
        return scenario.failed ? { ok: false, error: "Source is unavailable" } : { ok: true, revision: executions };
      }
    });
    const loop = createLoop({
      registry,
      agent: { maxToolCycles: scenario.varied ? scenario.limit : 64 },
      chat: async ({ tools }) => {
        modelCalls += 1;
        assert.ok(modelCalls <= scenario.limit + 1, "the guard must remain bounded");
        return tools.length === 0
          ? { message: { role: "assistant", content: "The draft is saved; checking the form is still unfinished." } }
          : { message: { role: "assistant", content: "", tool_calls: [{
            id: `work-${modelCalls}`, function: {
              name: "work_on_artifact", arguments: JSON.stringify({ revision: scenario.varied ? modelCalls : 1 })
            }
          }] } };
      }
    });
    const answer = await loop.run("Create and check the page", { onEvent: event => events.push(event) });
    assert.match(answer, /still unfinished/);
    assert.equal(executions, scenario.limit);
    assert.equal(loop.lastOutcome?.status, "interrupted");
    assert.equal(loop.lastOutcome?.reason, scenario.reason);
    assert.equal(loop.lastOutcome?.verified, false);
    assert.equal(events.some(event => event.type === "phase" && event.phase === "completed"), false);
    assert.deepEqual(events.filter(event => event.type === "agent_outcome").map(event => event.outcome), [loop.lastOutcome]);
    assert.ok(events.findIndex(event => event.type === "agent_outcome") <
      events.findIndex(event => event.type === "phase" && event.phase === "interrupted"));
  });
}

test("an artifact checker can deliver an incomplete draft without a retry or success outcome", async () => {
  let calls = 0;
  const events = [];
  const loop = createLoop({ chat: async () => {
    calls += 1;
    return { message: { role: "assistant", content: "Draft saved. Mobile layout still needs repair." } };
  } });
  const answer = await loop.run("Create a page", {
    onEvent: event => events.push(event),
    completionGate: async ({ answer, turn }) => {
      assert.match(answer, /Mobile layout/);
      assert.equal(turn, 0);
      return { allow: true, outcome: { status: "interrupted", reason: "verification_incomplete", verified: false } };
    }
  });
  assert.match(answer, /Draft saved/);
  assert.equal(calls, 1);
  assert.equal(loop.lastOutcome?.reason, "verification_incomplete");
  assert.equal(loop.lastOutcome?.status, "interrupted");
  assert.equal(events.some(event => event.phase === "completed"), false);
});

test("a completion gate can repair once then replace an unsupported completion claim", async () => {
  let calls = 0;
  const events = [];
  const loop = createLoop({ chat: async () => {
    calls += 1;
    return { message: { role: "assistant", content: "Everything is verified and ready." } };
  } });
  const answer = await loop.run("Create a page", {
    onEvent: event => events.push(event),
    completionGate: async () => calls === 1
      ? { allow: false, type: "task_progress", stage: "repairing", message: "Check the current page before claiming completion." }
      : { allow: true, answer: "Draft saved; mobile layout remains unchecked.", outcome: { status: "interrupted", reason: "verification_incomplete" } }
  });
  assert.equal(calls, 2);
  assert.equal(answer, "Draft saved; mobile layout remains unchecked.");
  assert.equal(loop.messages.at(-1).content, answer);
  assert.equal(events.filter(event => event.type === "assistant_delta").at(-1).text, answer);
  assert.ok(events.some(event => event.type === "task_progress" && event.stage === "repairing"));
  assert.equal(events.some(event => event.type === "coding_lifecycle"), false);
  assert.equal(loop.lastOutcome?.verified, false);
});

for (const reason of ["token_budget_exhausted", "cost_budget_exhausted", "tool_call_budget_exhausted", "wall_time_budget_exhausted", "system_sleep", "user_cancelled"]) {
  test(`${reason} preserves the abort fence and records a bounded terminal outcome`, async () => {
    const abort = new AbortController();
    let calls = 0;
    const loop = createLoop({ chat: async () => {
      calls += 1;
      abort.abort(reason);
      return { message: { role: "assistant", content: "A late answer must not complete the task." } };
    } });
    const events = [];
    await assert.rejects(loop.run("Do some work", { signal: abort.signal, onEvent: event => events.push(event) }), { name: "AbortError" });
    assert.equal(calls, 1, "no synthesis is allowed after the budget/cancel fence");
    assert.equal(loop.lastOutcome?.status, reason === "user_cancelled" ? "cancelled" : "interrupted");
    assert.equal(loop.lastOutcome?.reason, reason);
    assert.equal(loop.lastOutcome?.verified, false);
    assert.equal(events.some(event => event.phase === "completed"), false);
  });
}

test("a simple answer remains one call and clears the previous terminal outcome", async () => {
  let calls = 0;
  const loop = createLoop({ chat: async () => {
    calls += 1;
    assert.equal(loop.lastOutcome, null, "stale outcome must not leak into a new task");
    return { message: { role: "assistant", content: "Hello." } };
  } });
  loop.lastOutcome = { status: "interrupted", reason: "tool_cycle_limit", verified: false };
  assert.equal(await loop.run("Hello"), "Hello.");
  assert.equal(calls, 1);
  assert.equal(loop.lastOutcome?.status, "completed");
  assert.equal(loop.lastOutcome?.reason, "answer_returned");
  assert.equal(loop.lastOutcome?.verified, false, "text completion is not artifact verification");
  loop.clear();
  assert.equal(loop.lastOutcome, null);
});

test("failed guarded synthesis never leaves stale success and preserves the original error", async () => {
  const error = Object.assign(new Error("Provider failed"), { code: "PRIVATE_PROVIDER_DETAIL" });
  const registry = new ToolRegistry();
  registry.register({ name: "read_status", readOnly: true, handler: async () => ({ ok: true }) });
  const loop = createLoop({ registry, chat: async ({ tools }) => {
    if (tools.length === 0) throw error;
    return { message: { role: "assistant", content: "", tool_calls: [{
      id: "read", function: { name: "read_status", arguments: "{}" }
    }] } };
  } });
  const events = [];
  await assert.rejects(loop.run("Inspect the state", { onEvent: event => events.push(event) }), value => value === error);
  assert.equal(loop.lastOutcome?.status, "failed");
  assert.equal(loop.lastOutcome?.reason, "model_failure");
  assert.equal(JSON.stringify(loop.lastOutcome).includes("PRIVATE_PROVIDER_DETAIL"), false);
  assert.equal(events.some(event => event.phase === "completed"), false);
});

for (const parallel of [false, true]) {
  test(`every ${parallel ? "parallel read" : "serial write"} in one response passes the tool-call gate`, async () => {
    const registry = new ToolRegistry();
    const executed = [];
    const gated = [];
    const events = [];
    registry.register({
      name: "edit_artifact", readOnly: parallel, parallelSafe: parallel,
      handler: async args => { executed.push(args); return { ok: true }; }
    });
    let registryExecutions = 0;
    const execute = registry.execute.bind(registry);
    registry.execute = (...args) => { registryExecutions += 1; return execute(...args); };
    let calls = 0;
    const loop = createLoop({ registry, chat: async ({ messages }) => {
      calls += 1;
      if (calls === 1) return { message: { role: "assistant", content: "", tool_calls: [1, 2, 3].map(revision => ({
        id: `write-${revision}`, function: { name: "edit_artifact", arguments: JSON.stringify({ slug: "draft", content: `New HTML ${revision}` }) }
      })) } };
      assert.equal(messages.filter(message => message.role === "tool").length, 3);
      assert.equal(messages.filter(message => message.role === "tool" && message.content.includes("AMOS_TOOL_CALL_GATED")).length, 2);
      return { message: { role: "assistant", content: "Draft saved once. The form check is still required." } };
    } });
    await loop.run("Build a page", {
      onEvent: event => events.push(event),
      toolCallGate: async ({ name, args }) => {
        assert.equal(name, "edit_artifact");
        gated.push(args);
        await Promise.resolve();
        return args.content === "New HTML 1" ? { allow: true } : { allow: false, message: "Check the saved draft before rewriting." };
      },
      completionGate: async () => ({ allow: true, outcome: { status: "interrupted", reason: "verification_incomplete" } })
    });
    assert.equal(calls, 2);
    assert.equal(gated.length, 3, "changed arguments do not skip the gate");
    assert.equal(registryExecutions, 1, "rejected calls cannot reach approvals or handler execution");
    assert.deepEqual(executed, [{ slug: "draft", content: "New HTML 1" }]);
    assert.equal(events.filter(event => event.type === "tool_start").length, 1);
    assert.equal(events.filter(event => event.type === "tool_error" && event.executionMode === "not_executed").length, 2);
  });
}

test("an abort while awaiting the tool-call gate cannot execute the approved action", async () => {
  const abort = new AbortController();
  const registry = new ToolRegistry();
  let executed = 0;
  registry.register({ name: "write", handler: async () => { executed += 1; return { ok: true }; } });
  const loop = createLoop({ registry, chat: async () => ({ message: {
    role: "assistant", content: "", tool_calls: [{ id: "w", function: { name: "write", arguments: "{}" } }]
  } }) });
  await assert.rejects(loop.run("Write the artifact", {
    signal: abort.signal,
    toolCallGate: async () => { abort.abort("user_cancelled"); return { allow: true }; }
  }), { name: "AbortError" });
  assert.equal(executed, 0);
  assert.equal(loop.lastOutcome?.status, "cancelled");
});

test("an exhausted budget during the completion gate cannot turn a late approval into success", async () => {
  const abort = new AbortController();
  const events = [];
  const loop = createLoop({ chat: async () => ({ message: { role: "assistant", content: "Draft ready." } }) });
  await assert.rejects(loop.run("Create a page", {
    signal: abort.signal,
    onEvent: event => events.push(event),
    completionGate: async () => {
      abort.abort("wall_time_budget_exhausted");
      return { allow: true, outcome: { status: "completed", reason: "verified_delivery", verified: true } };
    }
  }), { name: "AbortError" });
  assert.deepEqual(loop.lastOutcome, { status: "interrupted", reason: "wall_time_budget_exhausted", verified: false });
  assert.equal(events.some(event => event.phase === "completed"), false);
});

test("malformed gate outcomes cannot create success or carry private detail into outcome events", async () => {
  const events = [];
  const loop = createLoop({ chat: async () => ({ message: { role: "assistant", content: "The draft has limitations." } }) });
  await loop.run("Create a page", {
    onEvent: event => events.push(event),
    completionGate: async () => ({ allow: true, outcome: {
      status: "success", reason: "PRIVATE_ERROR_TEXT", verified: true, detail: "private payload"
    } })
  });
  assert.deepEqual(loop.lastOutcome, { status: "interrupted", reason: "incomplete", verified: false });
  assert.deepEqual(events.filter(event => event.type === "agent_outcome")[0].outcome, loop.lastOutcome);
});

test("steering received during an independent completion check invalidates that verdict and continues", async () => {
  const queued = [];
  const events = [];
  let modelCalls = 0;
  let checks = 0;
  const loop = createLoop({ chat: async ({ messages }) => {
    modelCalls += 1;
    if (modelCalls === 1) return { message: { role: "assistant", content: "The dark draft is finished." } };
    assert.match(messages.at(-1).content, /Use a lighter theme/);
    return { message: { role: "assistant", content: "The lighter draft is finished." } };
  } });
  const answer = await loop.run("Create a dark landing page", {
    onEvent: event => events.push(event),
    takeSteering: () => queued.splice(0),
    completionGate: async () => {
      checks += 1;
      if (checks === 1) {
        queued.push("Use a lighter theme instead.");
        return { allow: true, answer: "The old dark theme passed review.", outcome: { status: "completed", reason: "verified_delivery", verified: true } };
      }
      return { allow: true, answer: "The lighter draft was checked.", outcome: { status: "completed", reason: "answer_returned", verified: false } };
    }
  });
  assert.equal(answer, "The lighter draft was checked.");
  assert.equal(modelCalls, 2);
  assert.equal(checks, 2);
  assert.equal(events.filter(event => event.type === "agent_outcome").length, 1);
  assert.deepEqual(loop.lastOutcome, { status: "completed", reason: "answer_returned", verified: false });
  assert.equal(events.some(event => event.type === "assistant_delta" && event.text === "The old dark theme passed review."), false);
});
