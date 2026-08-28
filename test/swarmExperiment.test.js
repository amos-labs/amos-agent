import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SWARM_BUDGET,
  SWARM_COMPLETENESS_RECOVERY_PROMPT,
  SWARM_CONTRIBUTION_LIMITS,
  SWARM_EVIDENCE_BOARD_SCHEMA,
  SWARM_INTEGRATION_LIMITS,
  SwarmEvidenceBoard,
  SwarmExperimentRunner,
  validateSwarmBudget,
  validateSwarmExperimentRun
} from "../src/research/swarmExperiment.js";
import { RESEARCH_TEST_DIGESTS } from "./fixtures/researchProtocolFixtures.js";

test("Swarm Mode v0 runs explorer and builder concurrently through a typed evidence board", async () => {
  const worker = scriptedWorker();
  const runner = new SwarmExperimentRunner({ worker, controlId: "qwen-swarm" });
  const run = await runner.runSwarm({
    missionId: "mission-finance-001",
    objective: "Find the largest measured funnel bottleneck.",
    context: "Visits 1200; playground sessions 120; signups 0.",
    dataManifestDigest: RESEARCH_TEST_DIGESTS.a
  });

  assert.deepEqual(validateSwarmExperimentRun(run), run);
  assert.equal(run.mode, "swarm");
  assert.match(run.result.answer, /^The measured bottleneck is playground-to-signup\./);
  assert.ok(run.result.answer.length >= SWARM_INTEGRATION_LIMITS.minimumAnswerCharacters);
  assert.equal(run.result.confidence, 0.98);
  assert.equal(run.evidenceBoard.schema, SWARM_EVIDENCE_BOARD_SCHEMA);
  assert.deepEqual(run.stages.map((stage) => stage.role), [
    "explorer",
    "builder",
    "verifier",
    "integrator"
  ]);
  assert.equal(run.evidenceBoard.items.length, 3);
  assert.deepEqual(worker.started.slice(0, 2).sort(), ["builder", "explorer"]);
  assert.equal(worker.calls.every((call) => call.responseFormat?.type === "json_schema"), true);
  const contributionSchema = worker.calls[0].responseFormat.json_schema.schema;
  assert.equal(
    contributionSchema.properties.entries.maxItems,
    SWARM_CONTRIBUTION_LIMITS.maximumEntries
  );
  assert.equal(
    contributionSchema.properties.entries.items.properties.statement.maxLength,
    SWARM_CONTRIBUTION_LIMITS.maximumStatementCharacters
  );
  const integratedSchema = worker.calls.at(-1).responseFormat.json_schema.schema;
  assert.equal(
    integratedSchema.properties.answer.minLength,
    SWARM_INTEGRATION_LIMITS.minimumAnswerCharacters
  );
  assert.equal(
    integratedSchema.properties.answer.maxLength,
    SWARM_INTEGRATION_LIMITS.maximumAnswerCharacters
  );
  assert.equal(run.metrics.logicalStages, 4);
  assert.equal(run.metrics.requests, 4);
});

test("the Swarm integrator retries a title-only result and fails closed if recovery stays short", async () => {
  const calls = [];
  const worker = {
    async runCase(input) {
      calls.push(structuredClone(input));
      const role = input.caseId.split(":").at(-2);
      if (role !== "integrator") {
        return fakeObservation(input.caseId, jsonMessage({ entries: [{
          kind: "evidence",
          statement: "A grounded mission fact.",
          sourceRefs: ["mission context"],
          confidence: 1,
          status: "supported"
        }] }));
      }
      return fakeObservation(input.caseId, jsonMessage({
        answer: input.caseId.endsWith(":answer") ? "Still too short." : "Title only",
        confidence: 0.5,
        unresolvedRisks: []
      }));
    }
  };
  const runner = new SwarmExperimentRunner({ worker, controlId: "qwen-swarm" });

  await assert.rejects(
    runner.runSwarm({
      missionId: "mission-short-integrator-001",
      objective: "Return a complete answer.",
      dataManifestDigest: RESEARCH_TEST_DIGESTS.a
    }),
    /at least 1000 characters/
  );
  const integratorCalls = calls.filter((call) => call.caseId.includes(":integrator:"));
  assert.equal(integratorCalls.length, 2);
  assert.equal(
    integratorCalls[1].messages.at(-1).content,
    SWARM_COMPLETENESS_RECOVERY_PROMPT
  );
});

test("direct and swarm controls use stage-specific answer reserves", async () => {
  const calls = [];
  const worker = {
    async runCase(input) {
      calls.push(structuredClone(input));
      const recovered = input.caseId.endsWith(":answer");
      return fakeObservation(
        input.caseId,
        recovered
          ? { role: "assistant", content: "Recovered direct answer." }
          : { role: "assistant", content: "", reasoning_content: "finished reasoning" }
      );
    }
  };
  const runner = new SwarmExperimentRunner({ worker, controlId: "qwen-direct" });
  const run = await runner.runDirect({
    missionId: "mission-direct-001",
    objective: "Return a final answer.",
    dataManifestDigest: RESEARCH_TEST_DIGESTS.b
  });

  assert.equal(run.result.answer, "Recovered direct answer.");
  assert.equal(run.stages[0].recoveryTriggered, true);
  assert.equal(run.metrics.answerRecoveries, 1);
  assert.equal(calls[1].reasoningEffortOverride, "none");
  assert.equal(calls[0].maxOutputTokens, 1536);
  assert.equal(calls[1].maxOutputTokens, 3072);
});

test("swarm budgets reserve the integrator and reject impossible allocations", () => {
  assert.deepEqual(validateSwarmBudget(DEFAULT_SWARM_BUDGET), DEFAULT_SWARM_BUDGET);
  assert.throws(
    () => validateSwarmBudget({ maxTotalOutputTokens: 1_000 }),
    /stage allocations exceed/
  );
  assert.throws(
    () => validateSwarmBudget({ maxInferenceCalls: 4 }),
    /maxInferenceCalls of at least 8/
  );
});

test("the research harness fails closed on truncated or malformed model output", async () => {
  const direct = new SwarmExperimentRunner({
    worker: {
      async runCase(input) {
        return fakeObservation(
          input.caseId,
          { role: "assistant", content: "A truncated answer" },
          { finishReason: "length" }
        );
      }
    },
    controlId: "qwen-direct"
  });
  await assert.rejects(
    direct.runDirect({
      missionId: "mission-truncated-001",
      objective: "Return a complete answer.",
      dataManifestDigest: RESEARCH_TEST_DIGESTS.a,
      budget: {
        ...DEFAULT_SWARM_BUDGET,
        directAnswerReserveTokens: 0
      }
    }),
    /exhausted its output budget/
  );

  const malformed = new SwarmExperimentRunner({
    worker: {
      async runCase(input) {
        return fakeObservation(input.caseId, { role: "assistant", content: "not json" });
      }
    },
    controlId: "qwen-swarm"
  });
  await assert.rejects(
    malformed.runSwarm({
      missionId: "mission-malformed-001",
      objective: "Return typed evidence.",
      dataManifestDigest: RESEARCH_TEST_DIGESTS.b,
      budget: { ...DEFAULT_SWARM_BUDGET, answerReserveTokens: 0 }
    }),
    /typed contribution contract/
  );
});

test("the evidence board is append-only and content addressed", () => {
  const board = new SwarmEvidenceBoard({
    missionId: "mission-board-001",
    now: () => new Date("2026-08-22T21:00:00.000Z")
  });
  board.append({
    workerRole: "explorer",
    kind: "evidence",
    statement: "The current approved target is 18%.",
    sourceRefs: ["CFO memo"],
    confidence: 1,
    status: "supported"
  });
  const first = board.snapshot();
  board.append({
    workerRole: "verifier",
    kind: "risk",
    statement: "The older board draft conflicts with the approved memo.",
    sourceRefs: ["Board draft", "CFO memo"],
    confidence: 0.9,
    status: "supported"
  });
  const second = board.snapshot();

  assert.equal(first.items.length, 1);
  assert.equal(second.items.length, 2);
  assert.notEqual(first.digest, second.digest);
});

function scriptedWorker() {
  const started = [];
  const calls = [];
  return {
    started,
    calls,
    async runCase(input) {
      calls.push(structuredClone(input));
      const role = input.caseId.split(":").at(-2);
      started.push(role);
      if (role === "explorer") {
        await Promise.resolve();
        return fakeObservation(input.caseId, jsonMessage({ entries: [{
          kind: "evidence",
          statement: "There are 120 playground sessions and zero signups.",
          sourceRefs: ["mission context"],
          confidence: 1,
          status: "supported"
        }] }));
      }
      if (role === "builder") {
        await Promise.resolve();
        return fakeObservation(input.caseId, jsonMessage({ entries: [{
          kind: "proposal",
          statement: "Prioritize the playground-to-signup conversion step.",
          sourceRefs: ["mission context"],
          confidence: 0.95,
          status: "supported"
        }] }));
      }
      if (role === "verifier") {
        return fakeObservation(input.caseId, jsonMessage({ entries: [{
          kind: "risk",
          statement: "The cause of zero signups is not established by funnel counts alone.",
          sourceRefs: ["typed evidence board"],
          confidence: 0.9,
          status: "supported"
        }] }));
      }
      if (role === "integrator") {
        return fakeObservation(input.caseId, jsonMessage({
          answer: substantiveAnswer("The measured bottleneck is playground-to-signup."),
          confidence: 0.98,
          unresolvedRisks: ["Root cause remains unmeasured."]
        }));
      }
      throw new Error(`Unexpected role ${role}`);
    }
  };
}

function jsonMessage(value) {
  return { role: "assistant", content: JSON.stringify(value) };
}

function substantiveAnswer(prefix) {
  return `${prefix} ${"Ground the recommendation in the typed evidence board and preserve the unresolved causal risk. ".repeat(14)}`;
}

function fakeObservation(caseId, message, { finishReason = "stop" } = {}) {
  return {
    caseId,
    message,
    providerResponse: {
      choices: [{ finish_reason: finishReason, message }]
    },
    metrics: {
      wallMilliseconds: 10,
      promptTokens: 20,
      outputTokens: 9,
      cachedInputTokens: 0,
      promptMilliseconds: 2,
      generationMilliseconds: 8,
      promptTokensPerSecond: 10_000,
      generationTokensPerSecond: 1_125,
      sessionCacheHit: null
    }
  };
}
