import test from "node:test";
import assert from "node:assert/strict";
import { SwarmTurnOrchestrator } from "../src/research/swarmTurnGateway.js";

test("the swarm turn gateway fans out proposals, critiques them, and returns one integrated action", async () => {
  const calls = [];
  const traces = [];
  const fetchImpl = async (_url, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload);
    const index = calls.length;
    return new Response(JSON.stringify({
      id: `response-${index}`,
      model: payload.model,
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: `response ${index}` }
      }],
      usage: { prompt_tokens: 10 * index, completion_tokens: index, total_tokens: 11 * index }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  let tick = 0;
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    backendApiKey: "secret",
    fetchImpl,
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    monotonicNow: () => tick += 25,
    onTrace: (trace) => traces.push(trace)
  });

  const result = await gateway.complete({
    model: "gateway-alias",
    messages: [
      { role: "system", content: "Use the terminal protocol." },
      { role: "user", content: "Fix the failing task." }
    ],
    max_tokens: 2_000,
    temperature: 0.4
  });

  assert.equal(calls.length, 4);
  assert.match(calls[0].messages[0].content, /PRIVATE AMOS ROLE/);
  assert.match(calls[1].messages[0].content, /different approach/);
  assert.equal(Object.hasOwn(calls[2], "response_format"), false);
  assert.match(calls[2].messages.at(-1).content, /PRIVATE CANDIDATE BOARD/);
  assert.match(calls[3].messages.at(-1).content, /PRIVATE VERIFIER CRITIQUE/);
  assert.equal(result.choices[0].message.content, "response 4");
  assert.deepEqual(result.usage, {
    prompt_tokens: 100,
    completion_tokens: 10,
    total_tokens: 110
  });
  assert.equal(result.amos_swarm.stageCount, 4);
  assert.equal(traces.length, 1);
  assert.match(traces[0].digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(traces[0].stages.map((stage) => stage.stage), [
    "candidate:primary",
    "candidate:alternative",
    "critic",
    "integrator"
  ]);
});

test("the swarm turn gateway rejects streaming rather than returning a false stream", async () => {
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080/v1",
    backendModel: "qwen-test",
    fetchImpl: async () => assert.fail("the backend must not be called")
  });
  await assert.rejects(
    gateway.complete({
      model: "gateway-alias",
      stream: true,
      messages: [{ role: "user", content: "hello" }]
    }),
    /streaming is not supported/
  );
});

test("the swarm turn gateway recovers a reasoning-only integration without replaying candidates", async () => {
  const calls = [];
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    internalMaxTokens: 1_024,
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      calls.push(payload);
      const index = calls.length;
      const exhausted = index === 4;
      return new Response(JSON.stringify({
        id: `response-${index}`,
        model: payload.model,
        choices: [{
          index: 0,
          finish_reason: exhausted ? "length" : "stop",
          message: exhausted
            ? { role: "assistant", content: null, reasoning: "unfinished reasoning" }
            : { role: "assistant", content: `visible response ${index}` }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await gateway.complete({
    model: "gateway-alias",
    messages: [{ role: "user", content: "Fix the task." }],
    max_tokens: 256
  });

  assert.equal(calls.length, 5);
  assert.equal(calls[4].enable_thinking, false);
  assert.deepEqual(calls[4].chat_template_kwargs, { enable_thinking: false });
  assert.equal(calls[4].max_tokens, 1_024);
  assert.equal(result.choices[0].message.content, "visible response 5");
  assert.equal(result.amos_swarm.stageCount, 5);
  assert.deepEqual(result.usage, {
    prompt_tokens: 50,
    completion_tokens: 25,
    total_tokens: 75
  });
});

test("the swarm turn gateway recovers an exhausted critic before integration", async () => {
  const calls = [];
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    internalMaxTokens: 1_024,
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      calls.push(payload);
      const index = calls.length;
      const exhaustedCritic = index === 3;
      return new Response(JSON.stringify({
        id: `response-${index}`,
        model: payload.model,
        choices: [{
          index: 0,
          finish_reason: exhaustedCritic ? "length" : "stop",
          message: exhaustedCritic
            ? { role: "assistant", content: null, reasoning: "unfinished critique" }
            : { role: "assistant", content: `visible response ${index}` }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await gateway.complete({
    model: "gateway-alias",
    messages: [{ role: "user", content: "Fix the task." }],
    max_tokens: 256
  });

  assert.equal(calls.length, 5);
  assert.equal(calls[3].enable_thinking, false);
  assert.match(calls[4].messages.at(-1).content, /visible response 4/);
  assert.equal(result.choices[0].message.content, "visible response 5");
  assert.equal(result.amos_swarm.stageCount, 5);
});

test("the swarm turn gateway budgets private evidence inside the backend context", async () => {
  const calls = [];
  const traces = [];
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    backendContextTokens: 32_768,
    contextSafetyTokens: 1_024,
    internalMaxTokens: 4_096,
    onTrace: (trace) => traces.push(trace),
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      calls.push(payload);
      const index = calls.length;
      const content = index < 4 ? `response-${index}-${"x".repeat(20_000)}` : "final";
      return new Response(JSON.stringify({
        id: `response-${index}`,
        model: payload.model,
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content }
        }],
        usage: { prompt_tokens: 22_000, completion_tokens: 100, total_tokens: 22_100 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await gateway.complete({
    model: "gateway-alias",
    messages: [{ role: "user", content: "Solve the state-heavy task." }],
    max_tokens: 4_096
  });

  const evidenceCharacterBudget = (32_768 - 22_000 - 4_096 - 1_024) * 3;
  assert.equal(calls.length, 4);
  assert.ok(calls[2].messages.at(-1).content.length <= evidenceCharacterBudget);
  assert.ok(calls[3].messages.at(-1).content.length <= evidenceCharacterBudget);
  assert.equal(calls[3].max_tokens, 4_096);
  assert.equal(result.choices[0].message.content, "final");
  assert.equal(traces[0].contextBudget.basePromptTokens, 22_000);
  assert.equal(
    traces[0].contextBudget.integrator.maximumEvidenceCharacters,
    evidenceCharacterBudget
  );
});

test("the swarm turn gateway reduces private-stage output near the context boundary", async () => {
  const calls = [];
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    backendContextTokens: 32_768,
    contextSafetyTokens: 1_024,
    internalMaxTokens: 4_096,
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      calls.push(payload);
      const index = calls.length;
      return new Response(JSON.stringify({
        id: `response-${index}`,
        model: payload.model,
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: `response ${index}` }
        }],
        usage: { prompt_tokens: 30_000, completion_tokens: 10, total_tokens: 30_010 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  await gateway.complete({
    model: "gateway-alias",
    messages: [{ role: "user", content: "Return one bounded action." }],
    max_tokens: 4_096
  });

  assert.equal(calls[2].max_tokens, 1_488);
  assert.equal(calls[3].max_tokens, 1_488);
  assert.ok(calls[2].messages.at(-1).content.length <= 768);
  assert.ok(calls[3].messages.at(-1).content.length <= 768);
});

test("the swarm turn gateway returns a completed candidate when private stages cannot fit", async () => {
  const calls = [];
  const traces = [];
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    backendContextTokens: 32_768,
    contextSafetyTokens: 1_024,
    internalMaxTokens: 4_096,
    onTrace: (trace) => traces.push(trace),
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      calls.push(payload);
      const index = calls.length;
      return new Response(JSON.stringify({
        id: `response-${index}`,
        model: payload.model,
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: `candidate ${index}` }
        }],
        usage: { prompt_tokens: 31_500, completion_tokens: 100, total_tokens: 31_600 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await gateway.complete({
    model: "gateway-alias",
    messages: [{ role: "user", content: "Compact the nearly full context." }],
    max_tokens: 4_096
  });

  assert.equal(calls.length, 2);
  assert.equal(result.choices[0].message.content, "candidate 1");
  assert.equal(result.amos_swarm.mode, "direct-context-fallback");
  assert.equal(result.amos_swarm.stageCount, 2);
  assert.equal(traces[0].contextBudget.critic.availableTokens, 244);
  assert.equal(traces[0].contextBudget.integrator, null);
});

test("the swarm gateway implements the Platform Mission worker contract and self-heals malformed plans", async () => {
  const calls = [];
  const traces = [];
  const validPlan = {
    decision: "tool",
    summary: "Run the next bounded prospecting batch",
    verb: "run_prospecting_batch",
    args: { campaign_id: "campaign-1", batch_size: 25 },
    checkpoint: { next_offset: 25 }
  };
  const gateway = new SwarmTurnOrchestrator({
    backendBaseUrl: "http://127.0.0.1:18080",
    backendModel: "qwen-test",
    internalMaxTokens: 1_024,
    onTrace: (trace) => traces.push(trace),
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      calls.push(payload);
      const index = calls.length;
      const content = index === 5
        ? JSON.stringify(validPlan)
        : index === 4
          ? "I think the mission should keep researching."
          : `candidate evidence ${index}`;
      return new Response(JSON.stringify({
        id: `response-${index}`,
        model: payload.model,
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content }
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const missionEnvelope = {
    contract: "amos-mission-worker:2026-09-06",
    mission: {
      tenant_id: "tenant-1",
      mission_id: "mission-1",
      contract_id: "contract-1",
      objective: "Find the next qualified contacts",
      completion_condition: { kind: "metric_threshold", target: 500 },
      verification_policy: {
        schema_version: "1",
        requirements: [{ id: "completion_condition" }]
      },
      allowed_operations: [{ operation: "run_prospecting_batch" }],
      budgets: { max_tool_calls: 20 },
      checkpoint: {},
      recent_steps: [],
      operation_schemas: {},
      open_decision_answer: null,
      recovery_feedback: {
        kind: "usage_accounting",
        no_company_effect: true,
        safe_to_retry: true
      },
      planner_attempt: 2
    },
    output_schema: {
      tool: { decision: "tool", summary: "...", verb: "...", args: {}, checkpoint: {} }
    }
  };

  const result = await gateway.complete({
    model: "amos-swarm",
    messages: [
      { role: "system", content: "Return one governed Mission plan." },
      { role: "user", content: JSON.stringify(missionEnvelope) }
    ],
    max_tokens: 1_024
  });

  assert.equal(calls.length, 5);
  assert.equal(calls[4].enable_thinking, false);
  assert.match(calls[4].messages.at(-1).content, /immutable AMOS Mission worker contract/);
  assert.deepEqual(JSON.parse(result.choices[0].message.content), validPlan);
  assert.equal(result.amos_swarm.mission.missionId, "mission-1");
  assert.equal(result.amos_swarm.mission.contractId, "contract-1");
  assert.equal(result.amos_swarm.mission.planDecision, "tool");
  assert.equal(result.amos_swarm.mission.contractSatisfied, true);
  assert.equal(result.amos_swarm.mission.recoveryKind, "usage_accounting");
  assert.match(result.amos_swarm.mission.recoveryFeedbackDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(traces[0].stages.map(({ stage }) => stage), [
    "candidate:primary",
    "candidate:alternative",
    "critic",
    "integrator",
    "mission:contract-recovery"
  ]);
  assert.equal(traces[0].mission.verificationPolicyDigest.length, 64);
  assert.equal(traces[0].mission.plannerAttempt, 2);
  assert.equal(traces[0].mission.recoveryKind, "usage_accounting");
});
