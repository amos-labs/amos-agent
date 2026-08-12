import test from "node:test";
import assert from "node:assert/strict";
import {
  compileVerifiedSft,
  datasetIdentity,
  validateDistillationDataset,
  validateDistillationTrajectory
} from "../src/research/distillationTrajectory.js";

test("verified synthetic trajectory compiles to chat SFT without research metadata", () => {
  const record = fixture();
  assert.equal(validateDistillationTrajectory(record), record);
  const compiled = compileVerifiedSft([record]);
  assert.deepEqual(compiled, [{ messages: [...record.input.messages, ...record.target.messages] }]);
  assert.equal(datasetIdentity([record]).train, 1);
  assert.match(datasetIdentity([record]).sha256, /^[a-f0-9]{64}$/);
});

test("teacher agreement alone cannot promote a trajectory to training gold", () => {
  const record = fixture();
  record.verification.methods = [{ type: "teacher_judge", id: "sonnet" }];
  assert.throws(() => validateDistillationTrajectory(record), /teacher-only verification/);
});

test("workflow families cannot leak across train and evaluation", () => {
  const train = fixture();
  const evaluation = fixture({ id: "authority-002", split: "evaluation" });
  assert.throws(
    () => validateDistillationDataset([train, evaluation]),
    /leaks across train and evaluation/
  );
});

test("product-derived data requires explicit build authority and a consent receipt", () => {
  const record = fixture();
  record.provenance = {
    source_type: "consented_product",
    contains_customer_data: true,
    data_minimized: true,
    consent_receipt_id: "consent-123",
    teacher_models: []
  };
  assert.throws(() => validateDistillationTrajectory(record), /disabled for this build/);
  assert.equal(
    validateDistillationTrajectory(record, { allowConsentedProduct: true }),
    record
  );
});

test("sensitive credential-shaped keys are rejected at any depth", () => {
  const record = fixture();
  record.task.state = { nested: { access_token: "not-even-a-real-token" } };
  assert.throws(() => validateDistillationTrajectory(record), /Sensitive key is not allowed/);
});

test("evaluation records are verified but never emitted into the SFT file", () => {
  const record = fixture({ split: "evaluation" });
  assert.deepEqual(compileVerifiedSft([record]), []);
  assert.equal(compileVerifiedSft([record], { split: "evaluation" }).length, 1);
});

test("tool trajectories can be omitted for a text-only trainer spike", () => {
  const direct = fixture();
  const tool = fixture({ id: "authority-tool-001", family_id: "authority-tools-v1" });
  tool.input.tools = [{ type: "function", function: { name: "read", parameters: {} } }];
  const compiled = compileVerifiedSft([direct, tool], { includeTools: false });
  assert.equal(compiled.length, 1);
  assert.equal(compiled[0].messages.at(-1).content, direct.target.messages[0].content);
});

test("tool-only compilation can produce a bounded template smoke dataset", () => {
  const direct = fixture();
  const firstTool = toolFixture();
  const secondTool = toolFixture();
  secondTool.id = "authority-tool-003";
  secondTool.family_id = "authority-tools-v3";
  const compiled = compileVerifiedSft([direct, firstTool, secondTool], {
    onlyTools: true,
    limit: 1
  });
  assert.equal(compiled.length, 1);
  assert.equal(compiled[0].tools[0].function.name, "read");
  assert.throws(() => compileVerifiedSft([direct], { limit: 0 }), /positive integer/);
});

test("tool trajectories reject undefined calls, malformed arguments, and missing results", () => {
  const undefinedTool = toolFixture();
  undefinedTool.target.messages[0].tool_calls[0].function.name = "write";
  assert.throws(() => validateDistillationTrajectory(undefinedTool), /invalid tool call/);

  const malformedArguments = toolFixture();
  malformedArguments.target.messages[0].tool_calls[0].function.arguments = "{bad";
  assert.throws(() => validateDistillationTrajectory(malformedArguments), /invalid JSON arguments/);

  const missingResult = toolFixture();
  missingResult.target.messages.splice(1, 1);
  assert.throws(() => validateDistillationTrajectory(missingResult), /missing tool results/);
});

function fixture(overrides = {}) {
  return {
    schema: "amos.distillation-trajectory",
    version: 1,
    id: overrides.id || "authority-001",
    family_id: overrides.family_id || "authority-receipts-v1",
    split: overrides.split || "train",
    provenance: {
      source_type: "synthetic",
      contains_customer_data: false,
      synthetic_world_id: "world-authority-v1",
      teacher_models: ["muse-glimmer-30b"]
    },
    task: {
      route: "routine",
      workflow: "authority_and_receipts",
      risk: "medium",
      state: { policy_revision: "r2", executed: false }
    },
    input: {
      messages: [
        { role: "system", content: "Use current authenticated state." },
        { role: "user", content: "Was the proposal executed?" }
      ]
    },
    target: {
      outcome: "local_answer",
      messages: [
        { role: "assistant", content: "No. The current receipt records executed=false." }
      ]
    },
    verification: {
      status: "passed",
      methods: [{ type: "deterministic", id: "receipt-state-v1" }],
      critical_contracts: [
        { id: "no-false-execution", passed: true }
      ]
    },
    efficiency: {
      target_output_tokens: 11,
      max_target_output_tokens: 20
    }
  };
}

function toolFixture() {
  const record = fixture({ id: "authority-tool-002", family_id: "authority-tools-v2" });
  record.input.tools = [{
    type: "function",
    function: {
      name: "read",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  }];
  record.target.messages = [
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "read-1",
        type: "function",
        function: { name: "read", arguments: "{}" }
      }]
    },
    { role: "tool", tool_call_id: "read-1", content: "{\"executed\":false}" },
    { role: "assistant", content: "No. The current receipt records executed=false." }
  ];
  return record;
}
