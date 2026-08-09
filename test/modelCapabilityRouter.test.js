import test from "node:test";
import assert from "node:assert/strict";
import { digestJson } from "../src/model/capabilityContract.js";
import { routeModelStep } from "../src/model/capabilityRouter.js";

test("router selects the least expensive model that cleared every hard floor", () => {
  const local = contract({
    id: "local:ollama:capable",
    deployment: "local",
    capabilities: ["tenant-boundary", "dependent-tool-sequencing"],
    workflows: ["dependent-tool-analysis"],
    autonomy: ["observe", "draft", "propose"],
    costClass: "local"
  });
  const managed = contract({
    id: "managed:openai:frontier",
    deployment: "managed",
    capabilities: ["tenant-boundary", "dependent-tool-sequencing", "approval-state-integrity"],
    workflows: ["dependent-tool-analysis", "approval-aware-action"],
    autonomy: ["observe", "draft", "propose", "execute"],
    costClass: "frontier"
  });

  const routed = routeModelStep({
    requirements: {
      capabilities: ["dependent-tool-sequencing"],
      workflows: ["dependent-tool-analysis"],
      autonomy: "propose"
    },
    candidates: [managed, local]
  });

  assert.equal(routed.selected.contract.id, local.id);
  assert.equal(routed.escalation, null);
});

test("consequential execution rejects a model that failed approval-state narration", () => {
  const local = contract({
    id: "local:ollama:conditional",
    deployment: "local",
    capabilities: ["tenant-boundary", "dependent-tool-sequencing"],
    autonomy: ["observe", "draft", "propose", "execute"],
    costClass: "local"
  });

  const routed = routeModelStep({
    requirements: { autonomy: "execute" },
    candidates: [local]
  });

  assert.equal(routed.selected, null);
  assert.equal(routed.escalation.code, "no-qualified-model");
  assert.ok(routed.rejected[0].reasons.some((reason) =>
    reason.code === "execution-floor-not-qualified"
  ));
});

test("routing rejects missing modality, tenant policy, context, and stale evidence", () => {
  const candidate = contract({
    id: "managed:vendor:text-only",
    deployment: "managed",
    provider: "vendor-a",
    contextTokens: 32000,
    evaluatedAt: "2026-01-01T00:00:00.000Z"
  });
  const routed = routeModelStep({
    requirements: {
      modalities: ["vision"],
      minimumContextTokens: 64000,
      maximumEvidenceAgeDays: 30
    },
    policy: { allowedProviders: ["vendor-b"] },
    candidates: [candidate],
    now: new Date("2026-08-09T00:00:00.000Z")
  });
  const codes = routed.rejected[0].reasons.map((reason) => reason.code);
  assert.ok(codes.includes("missing-modality"));
  assert.ok(codes.includes("provider-not-allowed"));
  assert.ok(codes.includes("context-limit-too-small"));
  assert.ok(codes.includes("evidence-too-old"));
});

test("experimental and malformed contracts are not silently admitted", () => {
  const experimental = contract({ id: "local:ollama:experimental", status: "experimental" });
  const routed = routeModelStep({ candidates: [experimental, { id: "marketing-only" }] });

  assert.equal(routed.selected, null);
  assert.deepEqual(
    routed.rejected.map((item) => item.reasons[0].code),
    ["status-not-allowed", "invalid-contract"]
  );
});

test("routing is stable when qualified candidates have equal cost and latency", () => {
  const beta = contract({ id: "managed:vendor:beta" });
  const alpha = contract({ id: "managed:vendor:alpha" });
  const routed = routeModelStep({ candidates: [beta, alpha] });
  assert.equal(routed.selected.contract.id, "managed:vendor:alpha");
});

function contract({
  id = "managed:vendor:model",
  status = "conditional",
  deployment = "managed",
  provider = "vendor",
  capabilities = [],
  workflows = [],
  autonomy = ["observe"],
  modalities = ["text"],
  contextTokens = 128000,
  evaluatedAt = "2026-08-01T00:00:00.000Z",
  costClass = "balanced",
  latencyClass = "interactive"
} = {}) {
  const identity = {
    provider,
    model: id.split(":").at(-1),
    protocol: "native",
    deployment,
    promptVersion: "test-prompt-v1",
    toolSchemaVersion: "test-tools-v1"
  };
  return {
    schema: "amos.model-capability-contract",
    version: 1,
    id,
    identity,
    evidence: {
      suite: "amos-model-capability",
      suiteVersion: 1,
      sourceSchema: "test",
      sourceVersion: 1,
      reportDigest: digestJson({ id }),
      evaluatedAt,
      trust: deployment === "local" ? "measured-local" : "measured-managed",
      repetitions: 3,
      complete: true
    },
    status,
    grants: { modalities, capabilities, workflows, autonomy },
    failures: status === "qualified" ? [] : [{ scenario: "known-floor", capabilities: [], detail: "test" }],
    limits: { contextTokens },
    performance: {
      score: status === "qualified" ? 1 : 0,
      maximum: 1,
      passRate: status === "qualified" ? 1 : 0,
      wallSeconds: 1,
      tokensPerSecond: 10,
      latencyClass,
      costClass
    }
  };
}
