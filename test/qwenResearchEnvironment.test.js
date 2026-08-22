import test from "node:test";
import assert from "node:assert/strict";
import {
  QWEN_RESEARCH_DEFAULT_ENDPOINTS,
  QWEN38_AWS_MODEL_REVISION,
  QwenResearchWorker,
  createQwen38AwsResearchEnvironment,
  createQwen38ResearchEnvironment,
  qwenResearchEnvironmentDigest,
  validateQwenResearchEnvironment,
  validateQwenResearchObservation
} from "../src/research/qwenResearchEnvironment.js";
import { RESEARCH_TEST_DIGESTS } from "./fixtures/researchProtocolFixtures.js";

const HARDWARE = Object.freeze({
  platform: "darwin",
  arch: "arm64",
  cpuModel: "Apple M1 Max",
  totalMemoryBytes: 64 * 1024 ** 3,
  accelerator: "apple-metal"
});

test("a Qwen research environment records draft versus execution-pinned identity", () => {
  const draft = qwenEnvironment({ runtimeBinaryDigest: null });
  assert.equal(draft.status, "draft");
  assert.throws(
    () => validateQwenResearchEnvironment(draft, { requirePinned: true }),
    /requires a pinned runtime binary digest/
  );

  const pinned = qwenEnvironment();
  assert.equal(pinned.status, "pinned");
  assert.equal(pinned.runtime.id, "mtplx");
  assert.equal(pinned.runtime.version, "2.8.3");
  assert.equal(pinned.model.servedModelId, "amos-local-qwen38-mtplx");
  assert.equal(pinned.prompt.qualificationBindingCurrent, false);
  assert.match(qwenResearchEnvironmentDigest(pinned), /^[a-f0-9]{64}$/);
});

test("environment validation rejects model or runtime identity drift", () => {
  const environment = qwenEnvironment();
  const driftedModel = structuredClone(environment);
  driftedModel.model.revision = "main-but-different";
  assert.throws(
    () => validateQwenResearchEnvironment(driftedModel),
    /model.revision does not match the pinned Qwen runtime/
  );

  const driftedRuntime = structuredClone(environment);
  driftedRuntime.runtime.version = "2.8.4";
  assert.throws(
    () => validateQwenResearchEnvironment(driftedRuntime),
    /runtime.version does not match the pinned Qwen runtime/
  );
});

test("the AWS Qwen environment pins the official FP8 artifact and authenticated vLLM runtime", async () => {
  const environment = createQwen38AwsResearchEnvironment({
    createdAt: "2026-08-22T12:00:00.000Z",
    containerImageDigest: RESEARCH_TEST_DIGESTS.a,
    modelArtifactManifestDigest: RESEARCH_TEST_DIGESTS.b,
    toolSchemaVersion: `sha256:${RESEARCH_TEST_DIGESTS.d}`
  });
  assert.equal(environment.runtime.id, "vllm");
  assert.equal(environment.runtime.version, "0.27.1");
  assert.equal(environment.model.revision, QWEN38_AWS_MODEL_REVISION);
  assert.equal(environment.runtime.profile, "aws-g7e-fp8-mtp-v2");
  assert.equal(environment.inference.contextTokens, 32_768);
  assert.equal(environment.inference.reasoningEffort, "low");

  const calls = [];
  const worker = new QwenResearchWorker({
    environment,
    baseUrl: "http://127.0.0.1:18080",
    apiKey: "test-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      if (String(url).endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "amos-qwen38-27b-fp8" }] });
      }
      return jsonResponse({
        choices: [{ message: { role: "assistant", content: "cloud ok" } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 }
      });
    },
    now: sequenceDates([
      "2026-08-22T12:00:00.000Z",
      "2026-08-22T12:00:00.500Z",
      "2026-08-22T12:00:01.000Z",
      "2026-08-22T12:00:01.500Z"
    ]),
    monotonicNow: sequenceNumbers([0, 500, 1_000, 1_500])
  });
  await worker.probe();
  await worker.runCase({
    caseId: "aws-development-001",
    messages: [{ role: "user", content: "Return cloud ok." }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.e
  });
  assert.equal(calls[0].options.headers.authorization, "Bearer test-secret");
  assert.equal(calls[1].body.reasoning_effort, "low");
  await worker.runCase({
    caseId: "aws-development-answer-reserve",
    messages: [{ role: "user", content: "Return the final answer." }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.e,
    reasoningEffortOverride: "none"
  });
  assert.equal(calls[2].body.enable_thinking, false);
  assert.deepEqual(calls[2].body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(Object.hasOwn(calls[2].body, "reasoning_effort"), false);
});

test("the MTPLX research worker probes and records a proof-carrying inference observation", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith("/v1/models")) {
      return jsonResponse({ data: [{ id: "amos-local-qwen38-mtplx" }] });
    }
    return jsonResponse({
      choices: [{ message: { role: "assistant", content: "The measured answer." } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 80 }
      },
      timings: {
        prompt_n: 100,
        prompt_ms: 50,
        predicted_n: 20,
        predicted_ms: 2_000
      },
      mtplx_stats: {
        cached_tokens: 80,
        session_cache_hit: true
      }
    });
  };
  const times = [new Date("2026-08-22T12:00:00.000Z"), new Date("2026-08-22T12:00:02.100Z")];
  const monotonic = [100, 2_200];
  const worker = new QwenResearchWorker({
    environment: qwenEnvironment(),
    baseUrl: QWEN_RESEARCH_DEFAULT_ENDPOINTS.mtplx,
    fetchImpl,
    now: () => times.shift(),
    monotonicNow: () => monotonic.shift()
  });

  const ready = await worker.probe();
  assert.equal(ready.ready, true);
  const observation = await worker.runCase({
    caseId: "development-grounding-001",
    messages: [{ role: "user", content: "Use only the supplied evidence." }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.e,
    repetition: 1,
    promptSessionId: "qwen-phase0-baseline"
  });

  assert.deepEqual(validateQwenResearchObservation(observation), observation);
  assert.equal(observation.metrics.generationTokensPerSecond, 10);
  assert.equal(observation.metrics.promptTokensPerSecond, 2_000);
  assert.equal(observation.metrics.cachedInputTokens, 80);
  assert.equal(observation.metrics.sessionCacheHit, true);
  assert.equal(calls[1].body.enable_thinking, false);
  assert.equal(Object.hasOwn(calls[1].body, "reasoning_effort"), false);
  assert.equal(calls[1].options.headers["X-MTPLX-Session-ID"], "qwen-phase0-baseline");
});

test("the Ollama research path uses the same pinned model with thinking disabled", async () => {
  const calls = [];
  const environment = createQwen38ResearchEnvironment({
    runtime: "ollama",
    createdAt: "2026-08-22T11:00:00.000Z",
    runtimeBinaryDigest: RESEARCH_TEST_DIGESTS.a,
    toolSchemaVersion: `sha256:${RESEARCH_TEST_DIGESTS.d}`,
    ...HARDWARE
  });
  const worker = new QwenResearchWorker({
    environment,
    baseUrl: QWEN_RESEARCH_DEFAULT_ENDPOINTS.ollama,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
      return jsonResponse({
        message: { role: "assistant", content: "ok" },
        prompt_eval_count: 10,
        prompt_eval_duration: 100_000_000,
        eval_count: 5,
        eval_duration: 500_000_000
      });
    },
    now: sequenceDates([
      "2026-08-22T12:00:00.000Z",
      "2026-08-22T12:00:00.600Z"
    ]),
    monotonicNow: sequenceNumbers([0, 600])
  });
  const observation = await worker.runCase({
    caseId: "development-structured-001",
    messages: [{ role: "user", content: "Return ok." }],
    dataManifestDigest: RESEARCH_TEST_DIGESTS.e
  });

  assert.equal(calls[0].body.think, false);
  assert.equal(calls[0].body.model, environment.model.id);
  assert.equal(observation.metrics.generationTokensPerSecond, 10);
});

test("phase-zero workers reject remote endpoints and over-budget output requests", async () => {
  const environment = qwenEnvironment();
  assert.throws(
    () => new QwenResearchWorker({
      environment,
      baseUrl: "https://untrusted.example.com",
      fetchImpl: async () => jsonResponse({})
    }),
    /must be loopback-only/
  );

  const worker = new QwenResearchWorker({
    environment,
    baseUrl: QWEN_RESEARCH_DEFAULT_ENDPOINTS.mtplx,
    fetchImpl: async () => jsonResponse({})
  });
  await assert.rejects(
    () => worker.runCase({
      caseId: "too-large",
      messages: [{ role: "user", content: "test" }],
      dataManifestDigest: RESEARCH_TEST_DIGESTS.e,
      maxOutputTokens: environment.inference.maxOutputTokens + 1
    }),
    /maxOutputTokens must be an integer/
  );
});

function qwenEnvironment(overrides = {}) {
  return createQwen38ResearchEnvironment({
    runtime: "mtplx",
    createdAt: "2026-08-22T11:00:00.000Z",
    runtimeBinaryDigest: RESEARCH_TEST_DIGESTS.a,
    toolSchemaVersion: `sha256:${RESEARCH_TEST_DIGESTS.d}`,
    ...HARDWARE,
    ...overrides
  });
}

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function sequenceDates(values) {
  const dates = values.map((value) => new Date(value));
  return () => dates.shift();
}

function sequenceNumbers(values) {
  return () => values.shift();
}
