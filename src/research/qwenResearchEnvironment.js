import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { SYSTEM_PROMPT } from "../prompts.js";
import { currentProductionToolSchemaVersion } from "../model/toolSurfaceQualification.js";
import { OFFLINE_MODEL_MANIFEST } from "../desktop/offlineIntelligence.js";
import { AMOS_LOCAL_HOST } from "../desktop/managedOllamaRuntime.js";
import {
  AMOS_MTPLX_CONTEXT_LENGTH,
  AMOS_MTPLX_HOST
} from "../desktop/managedMtplxRuntime.js";
import {
  MTPLX_QWEN38_MODEL_ID,
  MTPLX_RUNTIME_RELEASE,
  MTPLX_SERVED_MODEL_ID,
  mtplxModelProfile
} from "../desktop/mtplxRuntimeManifest.js";
import {
  OLLAMA_RUNTIME_RELEASE,
  ollamaRuntimeAsset
} from "../desktop/ollamaRuntimeManifest.js";
import { digestResearchValue } from "./experimentProtocol.js";

export const QWEN_RESEARCH_ENVIRONMENT_SCHEMA = "amos.qwen-research-environment";
export const QWEN_RESEARCH_OBSERVATION_SCHEMA = "amos.qwen-research-observation";
export const QWEN_RESEARCH_VERSION = 1;

export const QWEN38_AWS_MODEL_ID = "Qwen/Qwen3.8-27B-FP8";
export const QWEN38_AWS_MODEL_REVISION = "017b9c7af6b5689d5dd426a76e0bc077eb5ca20a";
export const QWEN38_AWS_SERVED_MODEL_ID = "amos-qwen38-27b-fp8";
export const QWEN38_AWS_VLLM_VERSION = "0.27.1";

const QWEN38_AWS_VLLM_PROFILE = Object.freeze({
  id: "aws-g7e-fp8-mtp-v2",
  runtimeVersion: QWEN38_AWS_VLLM_VERSION,
  modelRepository: QWEN38_AWS_MODEL_ID,
  modelRevision: QWEN38_AWS_MODEL_REVISION,
  servedModelId: QWEN38_AWS_SERVED_MODEL_ID,
  precision: "fp8-block-128",
  maxModelLength: 32_768,
  maxConcurrentSequences: 8,
  maxBatchedTokens: 16_384,
  gpuMemoryUtilization: 0.85,
  automaticToolChoice: true,
  toolCallParser: "qwen3_xml",
  reasoningParser: "qwen3",
  prefixCaching: true,
  speculativeMethod: "mtp",
  speculativeTokens: 3
});

const RUNTIMES = new Set(["ollama", "mtplx", "vllm"]);
const PROTOCOLS = new Set(["ollama", "openai"]);
const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "max", "xhigh"]);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SHA_VERSION_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function createQwen38ResearchEnvironment({
  runtime = "mtplx",
  createdAt = new Date().toISOString(),
  runtimeBinaryDigest = null,
  modelArtifactManifestDigest = null,
  platform = process.platform,
  arch = process.arch,
  cpuModel = cpus()[0]?.model || "unknown",
  totalMemoryBytes = totalmem(),
  accelerator = platform === "darwin" && arch === "arm64" ? "apple-metal" : "unknown",
  promptVersion = "qwen38-research-phase0-v1",
  toolSchemaVersion = currentProductionToolSchemaVersion(),
  contextTokens = AMOS_MTPLX_CONTEXT_LENGTH,
  maxOutputTokens = 768,
  temperature = 0,
  reasoningEffort = "none",
  seed = 0,
  sessionCache = true
} = {}) {
  if (!RUNTIMES.has(runtime)) throw new Error(`Unsupported Qwen research runtime: ${runtime}`);
  const catalogModel = OFFLINE_MODEL_MANIFEST.models.find(
    (candidate) => candidate.id === MTPLX_QWEN38_MODEL_ID
  );
  if (!catalogModel?.capabilityContract) {
    throw new Error("The pinned Qwen 3.8 catalog model is unavailable");
  }
  const runtimeDefinition = runtime === "mtplx"
    ? createMtplxDefinition({ platform, arch, cpuModel, modelArtifactManifestDigest })
    : createOllamaDefinition({ platform, arch, modelArtifactManifestDigest, catalogModel });
  const binaryDigest = nullableDigest(runtimeBinaryDigest, "runtimeBinaryDigest");
  const boundToolSchemaVersion = catalogModel.capabilityContract.identity.toolSchemaVersion;

  return validateQwenResearchEnvironment({
    schema: QWEN_RESEARCH_ENVIRONMENT_SCHEMA,
    version: QWEN_RESEARCH_VERSION,
    id: `qwen38-${runtime}-${String(platform).toLowerCase()}-${String(arch).toLowerCase()}`,
    status: binaryDigest ? "pinned" : "draft",
    createdAt: validDate(createdAt, "environment.createdAt").toISOString(),
    model: {
      id: catalogModel.id,
      repository: runtimeDefinition.modelRepository,
      revision: runtimeDefinition.modelRevision,
      quantization: runtimeDefinition.precision,
      artifactManifestDigest: runtimeDefinition.modelArtifactManifestDigest,
      servedModelId: runtimeDefinition.servedModelId
    },
    runtime: {
      id: runtime,
      version: runtimeDefinition.runtimeVersion,
      protocol: runtimeDefinition.protocol,
      profile: runtimeDefinition.profile,
      releaseContractDigest: runtimeDefinition.releaseContractDigest,
      binaryDigest
    },
    prompt: {
      version: requiredId(promptVersion, "environment.prompt.version"),
      systemPromptDigest: digestResearchValue(SYSTEM_PROMPT),
      toolSchemaVersion: shaVersion(toolSchemaVersion, "environment.prompt.toolSchemaVersion"),
      qualificationToolSchemaVersion: shaVersion(
        boundToolSchemaVersion,
        "environment.prompt.qualificationToolSchemaVersion"
      ),
      qualificationBindingCurrent: toolSchemaVersion === boundToolSchemaVersion
    },
    inference: {
      contextTokens,
      maxOutputTokens,
      temperature,
      reasoningEffort,
      seed,
      sessionCache
    },
    hardware: {
      platform: requiredId(platform, "environment.hardware.platform"),
      arch: requiredId(arch, "environment.hardware.arch"),
      cpuModel: requiredText(cpuModel, "environment.hardware.cpuModel", 500),
      totalMemoryBytes,
      accelerator: requiredText(accelerator, "environment.hardware.accelerator", 200)
    }
  });
}

export function createQwen38AwsResearchEnvironment({
  createdAt = new Date().toISOString(),
  containerImageDigest,
  modelArtifactManifestDigest,
  promptVersion = "qwen38-aws-research-phase0-v1",
  toolSchemaVersion = currentProductionToolSchemaVersion(),
  maxOutputTokens = 768,
  temperature = 0,
  reasoningEffort = "low",
  seed = 0,
  sessionCache = true,
  region = "us-east-1",
  availabilityZone = "us-east-1b",
  instanceType = "g7e.2xlarge",
  accelerator = "nvidia-rtx-pro-6000-blackwell-96gb"
} = {}) {
  const imageDigest = sha256(containerImageDigest, "containerImageDigest");
  const artifactDigest = sha256(
    modelArtifactManifestDigest,
    "modelArtifactManifestDigest"
  );
  if (!["none", "low", "medium", "xhigh"].includes(reasoningEffort)) {
    throw new Error("AWS Qwen reasoningEffort must be none, low, medium, or xhigh");
  }
  return validateQwenResearchEnvironment({
    schema: QWEN_RESEARCH_ENVIRONMENT_SCHEMA,
    version: QWEN_RESEARCH_VERSION,
    id: `qwen38-vllm-${region}-${availabilityZone}`,
    status: "pinned",
    createdAt: validDate(createdAt, "environment.createdAt").toISOString(),
    model: {
      id: QWEN38_AWS_MODEL_ID,
      repository: QWEN38_AWS_MODEL_ID,
      revision: QWEN38_AWS_MODEL_REVISION,
      quantization: QWEN38_AWS_VLLM_PROFILE.precision,
      artifactManifestDigest: artifactDigest,
      servedModelId: QWEN38_AWS_SERVED_MODEL_ID
    },
    runtime: {
      id: "vllm",
      version: QWEN38_AWS_VLLM_VERSION,
      protocol: "openai",
      profile: QWEN38_AWS_VLLM_PROFILE.id,
      releaseContractDigest: digestResearchValue({
        profile: QWEN38_AWS_VLLM_PROFILE,
        containerImageDigest: imageDigest
      }),
      binaryDigest: imageDigest
    },
    prompt: {
      version: requiredId(promptVersion, "environment.prompt.version"),
      systemPromptDigest: digestResearchValue(SYSTEM_PROMPT),
      toolSchemaVersion: shaVersion(toolSchemaVersion, "environment.prompt.toolSchemaVersion"),
      qualificationToolSchemaVersion: shaVersion(
        toolSchemaVersion,
        "environment.prompt.qualificationToolSchemaVersion"
      ),
      qualificationBindingCurrent: true
    },
    inference: {
      contextTokens: QWEN38_AWS_VLLM_PROFILE.maxModelLength,
      maxOutputTokens,
      temperature,
      reasoningEffort,
      seed,
      sessionCache
    },
    hardware: {
      platform: "linux",
      arch: "x64",
      cpuModel: `${instanceType} in ${region}/${availabilityZone}`,
      totalMemoryBytes: 64 * 1024 ** 3,
      accelerator: requiredText(accelerator, "environment.hardware.accelerator", 200)
    }
  }, { requirePinned: true });
}

export function validateQwenResearchEnvironment(input, { requirePinned = false } = {}) {
  const environment = cloneJson(input, "Qwen research environment");
  assertExactFields(environment, "environment", [
    "schema",
    "version",
    "id",
    "status",
    "createdAt",
    "model",
    "runtime",
    "prompt",
    "inference",
    "hardware"
  ]);
  if (
    environment.schema !== QWEN_RESEARCH_ENVIRONMENT_SCHEMA ||
    environment.version !== QWEN_RESEARCH_VERSION
  ) {
    throw new Error("Unsupported Qwen research environment schema");
  }
  requiredId(environment.id, "environment.id");
  if (!["draft", "pinned"].includes(environment.status)) {
    throw new Error("environment.status must be draft or pinned");
  }
  if (requirePinned && environment.status !== "pinned") {
    throw new Error("Qwen research execution requires a pinned runtime binary digest");
  }
  validDate(environment.createdAt, "environment.createdAt");

  assertExactFields(environment.model, "environment.model", [
    "id",
    "repository",
    "revision",
    "quantization",
    "artifactManifestDigest",
    "servedModelId"
  ]);
  const expectedModelId = environment.runtime?.id === "vllm"
    ? QWEN38_AWS_MODEL_ID
    : MTPLX_QWEN38_MODEL_ID;
  if (environment.model.id !== expectedModelId) {
    throw new Error("Research environment must use the pinned Qwen 3.8 27B model");
  }
  for (const field of ["repository", "revision", "quantization", "servedModelId"]) {
    requiredId(environment.model[field], `environment.model.${field}`);
  }
  sha256(environment.model.artifactManifestDigest, "environment.model.artifactManifestDigest");

  assertExactFields(environment.runtime, "environment.runtime", [
    "id",
    "version",
    "protocol",
    "profile",
    "releaseContractDigest",
    "binaryDigest"
  ]);
  if (!RUNTIMES.has(environment.runtime.id)) {
    throw new Error(`Unsupported environment runtime: ${environment.runtime.id}`);
  }
  if (!PROTOCOLS.has(environment.runtime.protocol)) {
    throw new Error(`Unsupported environment protocol: ${environment.runtime.protocol}`);
  }
  requiredId(environment.runtime.version, "environment.runtime.version");
  requiredId(environment.runtime.profile, "environment.runtime.profile");
  sha256(environment.runtime.releaseContractDigest, "environment.runtime.releaseContractDigest");
  nullableDigest(environment.runtime.binaryDigest, "environment.runtime.binaryDigest");
  if (environment.status === "pinned" && !environment.runtime.binaryDigest) {
    throw new Error("Pinned research environments require runtime.binaryDigest");
  }
  if (environment.status === "draft" && environment.runtime.binaryDigest) {
    throw new Error("A research environment with runtime.binaryDigest must be pinned");
  }
  const expectedProtocol = environment.runtime.id === "ollama" ? "ollama" : "openai";
  if (environment.runtime.protocol !== expectedProtocol) {
    throw new Error(`${environment.runtime.id} requires the ${expectedProtocol} protocol`);
  }

  assertExactFields(environment.prompt, "environment.prompt", [
    "version",
    "systemPromptDigest",
    "toolSchemaVersion",
    "qualificationToolSchemaVersion",
    "qualificationBindingCurrent"
  ]);
  requiredId(environment.prompt.version, "environment.prompt.version");
  sha256(environment.prompt.systemPromptDigest, "environment.prompt.systemPromptDigest");
  shaVersion(environment.prompt.toolSchemaVersion, "environment.prompt.toolSchemaVersion");
  shaVersion(
    environment.prompt.qualificationToolSchemaVersion,
    "environment.prompt.qualificationToolSchemaVersion"
  );
  if (typeof environment.prompt.qualificationBindingCurrent !== "boolean") {
    throw new Error("environment.prompt.qualificationBindingCurrent must be boolean");
  }
  if (
    environment.prompt.qualificationBindingCurrent !==
    (environment.prompt.toolSchemaVersion === environment.prompt.qualificationToolSchemaVersion)
  ) {
    throw new Error("environment.prompt.qualificationBindingCurrent is inconsistent");
  }

  assertExactFields(environment.inference, "environment.inference", [
    "contextTokens",
    "maxOutputTokens",
    "temperature",
    "reasoningEffort",
    "seed",
    "sessionCache"
  ]);
  boundedInteger(environment.inference.contextTokens, 4_096, 262_144, "environment.inference.contextTokens");
  boundedInteger(environment.inference.maxOutputTokens, 1, 16_384, "environment.inference.maxOutputTokens");
  finiteNumber(environment.inference.temperature, "environment.inference.temperature");
  if (environment.inference.temperature < 0 || environment.inference.temperature > 2) {
    throw new Error("environment.inference.temperature must be between zero and two");
  }
  if (!REASONING_EFFORTS.has(environment.inference.reasoningEffort)) {
    throw new Error("environment.inference.reasoningEffort is unsupported");
  }
  if (
    environment.runtime.id === "vllm" &&
    !["none", "low", "medium", "xhigh"].includes(environment.inference.reasoningEffort)
  ) {
    throw new Error("AWS Qwen reasoning effort is unsupported");
  }
  boundedInteger(environment.inference.seed, 0, 2_147_483_647, "environment.inference.seed");
  if (typeof environment.inference.sessionCache !== "boolean") {
    throw new Error("environment.inference.sessionCache must be boolean");
  }

  assertExactFields(environment.hardware, "environment.hardware", [
    "platform",
    "arch",
    "cpuModel",
    "totalMemoryBytes",
    "accelerator"
  ]);
  requiredId(environment.hardware.platform, "environment.hardware.platform");
  requiredId(environment.hardware.arch, "environment.hardware.arch");
  requiredText(environment.hardware.cpuModel, "environment.hardware.cpuModel", 500);
  boundedInteger(
    environment.hardware.totalMemoryBytes,
    1,
    Number.MAX_SAFE_INTEGER,
    "environment.hardware.totalMemoryBytes"
  );
  requiredText(environment.hardware.accelerator, "environment.hardware.accelerator", 200);
  validatePinnedRuntimeAndModel(environment);
  return environment;
}

export function qwenResearchEnvironmentDigest(environment) {
  return digestResearchValue(validateQwenResearchEnvironment(environment));
}

export class QwenResearchWorker {
  constructor({
    environment,
    baseUrl,
    apiKey = null,
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = 10 * 60_000,
    allowRemote = false,
    now = () => new Date(),
    monotonicNow = () => performance.now()
  }) {
    this.environment = validateQwenResearchEnvironment(environment, { requirePinned: true });
    this.baseUrl = normalizedBaseUrl(baseUrl, { allowRemote });
    this.apiKey = apiKey === null ? null : requiredText(apiKey, "apiKey", 2_000);
    if (typeof fetchImpl !== "function") throw new Error("Qwen research worker requires fetch");
    this.fetch = fetchImpl;
    this.requestTimeoutMs = boundedInteger(
      requestTimeoutMs,
      1_000,
      7_200_000,
      "requestTimeoutMs"
    );
    this.now = now;
    this.monotonicNow = monotonicNow;
  }

  async probe({ signal = null } = {}) {
    const protocol = this.environment.runtime.protocol;
    const path = protocol === "openai" ? "/v1/models" : "/api/tags";
    const payload = await this.requestJson(path, { method: "GET", signal });
    const availableModels = protocol === "openai"
      ? (payload.data || []).map((item) => String(item?.id || ""))
      : (payload.models || []).flatMap((item) => [item?.name, item?.model].filter(Boolean).map(String));
    const expected = this.environment.model.servedModelId;
    if (!availableModels.includes(expected)) {
      throw new Error(`Pinned Qwen research model ${expected} is not available from ${this.baseUrl}`);
    }
    return {
      ready: true,
      runtime: this.environment.runtime.id,
      model: expected,
      environmentDigest: qwenResearchEnvironmentDigest(this.environment)
    };
  }

  async runCase({
    caseId,
    messages,
    tools = [],
    dataManifestDigest,
    repetition = 1,
    maxOutputTokens = this.environment.inference.maxOutputTokens,
    reasoningEffortOverride = null,
    promptSessionId = null,
    signal = null
  }) {
    requiredId(caseId, "caseId");
    validateMessages(messages);
    validateTools(tools);
    sha256(dataManifestDigest, "dataManifestDigest");
    boundedInteger(repetition, 1, 10_000, "repetition");
    boundedInteger(maxOutputTokens, 1, this.environment.inference.maxOutputTokens, "maxOutputTokens");
    if (
      reasoningEffortOverride !== null &&
      !REASONING_EFFORTS.has(reasoningEffortOverride)
    ) {
      throw new Error("reasoningEffortOverride is unsupported");
    }
    if (promptSessionId !== null) requiredId(promptSessionId, "promptSessionId");

    const request = buildInferenceRequest({
      environment: this.environment,
      messages,
      tools,
      maxOutputTokens,
      reasoningEffortOverride
    });
    const requestDigest = digestResearchValue({
      caseId,
      dataManifestDigest,
      repetition,
      promptSessionId,
      request
    });
    const startedAt = this.now().toISOString();
    const monotonicStartedAt = this.monotonicNow();
    const path = this.environment.runtime.protocol === "openai"
      ? "/v1/chat/completions"
      : "/api/chat";
    const headers = promptSessionId && this.environment.inference.sessionCache
      ? {
          "X-MTPLX-Session-ID": promptSessionId,
          "X-AMOS-Prompt-Contract": this.environment.prompt.toolSchemaVersion
        }
      : {};
    const raw = await this.requestJson(path, {
      method: "POST",
      headers,
      body: request,
      signal
    });
    const concludedAt = this.now().toISOString();
    const wallMilliseconds = Math.max(0, this.monotonicNow() - monotonicStartedAt);
    const message = this.environment.runtime.protocol === "openai"
      ? raw?.choices?.[0]?.message
      : raw?.message;
    if (!message || typeof message !== "object") {
      throw new Error("Qwen research response did not include a message");
    }
    const metrics = inferenceMetrics(raw, wallMilliseconds);
    const observation = {
      schema: QWEN_RESEARCH_OBSERVATION_SCHEMA,
      version: QWEN_RESEARCH_VERSION,
      caseId,
      repetition,
      dataManifestDigest,
      environmentDigest: qwenResearchEnvironmentDigest(this.environment),
      requestDigest,
      responseDigest: digestResearchValue(raw),
      messageDigest: digestResearchValue(message),
      startedAt,
      concludedAt,
      status: "completed",
      metrics,
      message,
      providerResponse: raw
    };
    return validateQwenResearchObservation(observation);
  }

  async requestJson(path, { method, headers = {}, body = null, signal = null }) {
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...headers
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: combinedSignal
      });
    } catch (error) {
      if (combinedSignal.aborted) {
        throw new Error(`Qwen research request timed out or was aborted after ${this.requestTimeoutMs}ms`);
      }
      throw error;
    }
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("Qwen research endpoint returned invalid JSON");
    }
    if (!response.ok) {
      const detail = String(payload?.error?.message || payload?.error || text || response.status)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      throw new Error(`Qwen research endpoint returned ${response.status}: ${detail}`);
    }
    return payload;
  }
}

export function validateQwenResearchObservation(input) {
  const observation = cloneJson(input, "Qwen research observation");
  assertExactFields(observation, "observation", [
    "schema",
    "version",
    "caseId",
    "repetition",
    "dataManifestDigest",
    "environmentDigest",
    "requestDigest",
    "responseDigest",
    "messageDigest",
    "startedAt",
    "concludedAt",
    "status",
    "metrics",
    "message",
    "providerResponse"
  ]);
  if (
    observation.schema !== QWEN_RESEARCH_OBSERVATION_SCHEMA ||
    observation.version !== QWEN_RESEARCH_VERSION
  ) {
    throw new Error("Unsupported Qwen research observation schema");
  }
  requiredId(observation.caseId, "observation.caseId");
  boundedInteger(observation.repetition, 1, 10_000, "observation.repetition");
  for (const field of [
    "dataManifestDigest",
    "environmentDigest",
    "requestDigest",
    "responseDigest",
    "messageDigest"
  ]) {
    sha256(observation[field], `observation.${field}`);
  }
  const started = validDate(observation.startedAt, "observation.startedAt");
  const concluded = validDate(observation.concludedAt, "observation.concludedAt");
  if (concluded < started) throw new Error("observation.concludedAt precedes startedAt");
  if (observation.status !== "completed") throw new Error("observation.status must be completed");
  validateInferenceMetrics(observation.metrics);
  if (!plainObject(observation.message)) throw new Error("observation.message must be an object");
  if (digestResearchValue(observation.message) !== observation.messageDigest) {
    throw new Error("observation.messageDigest does not match the message");
  }
  if (!plainObject(observation.providerResponse)) {
    throw new Error("observation.providerResponse must be an object");
  }
  if (digestResearchValue(observation.providerResponse) !== observation.responseDigest) {
    throw new Error("observation.responseDigest does not match the provider response");
  }
  return observation;
}

function createMtplxDefinition({ platform, arch, cpuModel, modelArtifactManifestDigest }) {
  const profile = mtplxModelProfile({ platform, arch, cpuModel });
  if (!profile) throw new Error(`MTPLX research is unsupported on ${platform}-${arch}`);
  const artifactDigest = modelArtifactManifestDigest ||
    profile.runtimeManifestSha256 || profile.conversionManifestSha256;
  if (!artifactDigest) {
    throw new Error("MTPLX research requires a pinned model artifact manifest digest");
  }
  sha256(artifactDigest, "modelArtifactManifestDigest");
  return {
    runtimeVersion: MTPLX_RUNTIME_RELEASE.version,
    protocol: "openai",
    profile: profile.id,
    servedModelId: MTPLX_SERVED_MODEL_ID,
    modelRepository: profile.repository,
    modelRevision: profile.revision,
    precision: profile.precision,
    modelArtifactManifestDigest: artifactDigest,
    releaseContractDigest: digestResearchValue(MTPLX_RUNTIME_RELEASE)
  };
}

function createOllamaDefinition({ platform, arch, modelArtifactManifestDigest, catalogModel }) {
  const asset = ollamaRuntimeAsset(platform, arch);
  const artifactDigest = modelArtifactManifestDigest || catalogModel.source.ollamaManifestDigest;
  sha256(artifactDigest, "modelArtifactManifestDigest");
  return {
    runtimeVersion: OLLAMA_RUNTIME_RELEASE.version,
    protocol: "ollama",
    profile: "qwen38-q4-k-m",
    servedModelId: catalogModel.id,
    modelRepository: catalogModel.source.repository,
    modelRevision: catalogModel.source.revision,
    precision: catalogModel.capabilityContract.identity.quantization,
    modelArtifactManifestDigest: artifactDigest,
    releaseContractDigest: digestResearchValue({ release: OLLAMA_RUNTIME_RELEASE, asset })
  };
}

function validatePinnedRuntimeAndModel(environment) {
  if (environment.runtime.id === "vllm") {
    const expected = {
      runtimeVersion: QWEN38_AWS_VLLM_VERSION,
      protocol: "openai",
      profile: QWEN38_AWS_VLLM_PROFILE.id,
      servedModelId: QWEN38_AWS_SERVED_MODEL_ID,
      modelRepository: QWEN38_AWS_MODEL_ID,
      modelRevision: QWEN38_AWS_MODEL_REVISION,
      precision: QWEN38_AWS_VLLM_PROFILE.precision,
      releaseContractDigest: digestResearchValue({
        profile: QWEN38_AWS_VLLM_PROFILE,
        containerImageDigest: environment.runtime.binaryDigest
      })
    };
    validatePinnedBindings(environment, expected);
    return;
  }
  const catalogModel = OFFLINE_MODEL_MANIFEST.models.find(
    (candidate) => candidate.id === MTPLX_QWEN38_MODEL_ID
  );
  if (!catalogModel?.source || !catalogModel.capabilityContract) {
    throw new Error("The pinned Qwen 3.8 catalog model is unavailable");
  }
  let expected;
  if (environment.runtime.id === "ollama") {
    const asset = ollamaRuntimeAsset(
      environment.hardware.platform,
      environment.hardware.arch
    );
    expected = {
      runtimeVersion: OLLAMA_RUNTIME_RELEASE.version,
      protocol: "ollama",
      profile: "qwen38-q4-k-m",
      servedModelId: catalogModel.id,
      modelRepository: catalogModel.source.repository,
      modelRevision: catalogModel.source.revision,
      precision: catalogModel.capabilityContract.identity.quantization,
      modelArtifactManifestDigest: catalogModel.source.ollamaManifestDigest,
      releaseContractDigest: digestResearchValue({ release: OLLAMA_RUNTIME_RELEASE, asset })
    };
  } else {
    const profile = mtplxModelProfile({
      platform: environment.hardware.platform,
      arch: environment.hardware.arch,
      cpuModel: environment.hardware.cpuModel
    });
    if (!profile) {
      throw new Error("Environment hardware does not support the pinned MTPLX profile");
    }
    expected = {
      runtimeVersion: MTPLX_RUNTIME_RELEASE.version,
      protocol: "openai",
      profile: profile.id,
      servedModelId: MTPLX_SERVED_MODEL_ID,
      modelRepository: profile.repository,
      modelRevision: profile.revision,
      precision: profile.precision,
      modelArtifactManifestDigest: profile.runtimeManifestSha256 ||
        profile.conversionManifestSha256 || null,
      releaseContractDigest: digestResearchValue(MTPLX_RUNTIME_RELEASE)
    };
  }
  validatePinnedBindings(environment, expected);
}

function validatePinnedBindings(environment, expected) {
  const bindings = [
    [environment.runtime.version, expected.runtimeVersion, "runtime.version"],
    [environment.runtime.protocol, expected.protocol, "runtime.protocol"],
    [environment.runtime.profile, expected.profile, "runtime.profile"],
    [environment.runtime.releaseContractDigest, expected.releaseContractDigest, "runtime.releaseContractDigest"],
    [environment.model.servedModelId, expected.servedModelId, "model.servedModelId"],
    [environment.model.repository, expected.modelRepository, "model.repository"],
    [environment.model.revision, expected.modelRevision, "model.revision"],
    [environment.model.quantization, expected.precision, "model.quantization"]
  ];
  if (expected.modelArtifactManifestDigest) {
    bindings.push([
      environment.model.artifactManifestDigest,
      expected.modelArtifactManifestDigest,
      "model.artifactManifestDigest"
    ]);
  }
  for (const [actual, pinned, field] of bindings) {
    if (actual !== pinned) throw new Error(`environment.${field} does not match the pinned Qwen runtime`);
  }
}

function buildInferenceRequest({
  environment,
  messages,
  tools,
  maxOutputTokens,
  reasoningEffortOverride = null
}) {
  const reasoningEffort = reasoningEffortOverride || environment.inference.reasoningEffort;
  if (environment.runtime.protocol === "openai") {
    return {
      model: environment.model.servedModelId,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(tools.length > 1 ? { parallel_tool_calls: false } : {}),
      stream: false,
      temperature: environment.inference.temperature,
      seed: environment.inference.seed,
      max_tokens: maxOutputTokens,
      ...(reasoningEffort === "none"
        ? { enable_thinking: false }
        : { reasoning_effort: reasoningEffort }),
      chat_template_kwargs: reasoningEffort === "none"
        ? { enable_thinking: false }
        : { reasoning_effort: reasoningEffort }
    };
  }
  return {
    model: environment.model.servedModelId,
    messages,
    ...(tools.length > 0 ? { tools } : {}),
    stream: false,
    think: reasoningEffort === "none" ? false : reasoningEffort,
    options: {
      temperature: environment.inference.temperature,
      seed: environment.inference.seed,
      num_ctx: environment.inference.contextTokens,
      num_predict: maxOutputTokens
    }
  };
}

function inferenceMetrics(raw, wallMilliseconds) {
  const openAiUsage = raw?.usage || {};
  const timings = raw?.timings || {};
  const promptTokens = firstFinite(raw?.prompt_eval_count, timings.prompt_n, openAiUsage.prompt_tokens, 0);
  const outputTokens = firstFinite(raw?.eval_count, timings.predicted_n, openAiUsage.completion_tokens, 0);
  const promptMilliseconds = firstFinite(
    nanosecondsToMilliseconds(raw?.prompt_eval_duration),
    timings.prompt_ms,
    0
  );
  const generationMilliseconds = firstFinite(
    nanosecondsToMilliseconds(raw?.eval_duration),
    timings.predicted_ms,
    wallMilliseconds
  );
  const cachedInputTokens = firstFinite(
    openAiUsage?.prompt_tokens_details?.cached_tokens,
    raw?.mtplx_stats?.cached_tokens,
    0
  );
  return {
    wallMilliseconds: Math.round(wallMilliseconds),
    promptTokens: Math.max(0, Math.round(promptTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
    cachedInputTokens: Math.max(0, Math.round(cachedInputTokens)),
    promptMilliseconds: Math.max(0, Math.round(promptMilliseconds)),
    generationMilliseconds: Math.max(0, Math.round(generationMilliseconds)),
    promptTokensPerSecond: rate(promptTokens, promptMilliseconds),
    generationTokensPerSecond: rate(outputTokens, generationMilliseconds),
    sessionCacheHit: typeof raw?.mtplx_stats?.session_cache_hit === "boolean"
      ? raw.mtplx_stats.session_cache_hit
      : null
  };
}

function validateInferenceMetrics(metrics) {
  assertExactFields(metrics, "observation.metrics", [
    "wallMilliseconds",
    "promptTokens",
    "outputTokens",
    "cachedInputTokens",
    "promptMilliseconds",
    "generationMilliseconds",
    "promptTokensPerSecond",
    "generationTokensPerSecond",
    "sessionCacheHit"
  ]);
  for (const field of [
    "wallMilliseconds",
    "promptTokens",
    "outputTokens",
    "cachedInputTokens",
    "promptMilliseconds",
    "generationMilliseconds"
  ]) {
    boundedInteger(metrics[field], 0, Number.MAX_SAFE_INTEGER, `observation.metrics.${field}`);
  }
  for (const field of ["promptTokensPerSecond", "generationTokensPerSecond"]) {
    const value = metrics[field];
    if (value !== null) {
      finiteNumber(value, `observation.metrics.${field}`);
      if (value < 0) throw new Error(`observation.metrics.${field} must be non-negative`);
    }
  }
  if (metrics.sessionCacheHit !== null && typeof metrics.sessionCacheHit !== "boolean") {
    throw new Error("observation.metrics.sessionCacheHit must be boolean or null");
  }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.some((message) => !plainObject(message))) {
    throw new Error("messages must be a non-empty array of objects");
  }
  for (const [index, message] of messages.entries()) {
    if (!["system", "user", "assistant", "tool"].includes(message.role)) {
      throw new Error(`messages[${index}].role is unsupported`);
    }
    if (!Object.hasOwn(message, "content") && !Array.isArray(message.tool_calls)) {
      throw new Error(`messages[${index}] requires content or tool_calls`);
    }
  }
  digestResearchValue(messages);
}

function validateTools(tools) {
  if (!Array.isArray(tools) || tools.some((tool) => !plainObject(tool))) {
    throw new Error("tools must be an array of objects");
  }
  digestResearchValue(tools);
}

function normalizedBaseUrl(value, { allowRemote }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Qwen research worker baseUrl must be a valid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Qwen research worker baseUrl must use HTTP or HTTPS");
  }
  if (!allowRemote && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Phase-0 Qwen research endpoints must be loopback-only");
  }
  return url.toString().replace(/\/$/, "");
}

function rate(tokens, milliseconds) {
  return milliseconds > 0 && tokens > 0
    ? Number((tokens / (milliseconds / 1_000)).toFixed(3))
    : null;
}

function nanosecondsToMilliseconds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed / 1_000_000 : null;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function assertExactFields(value, label, fields) {
  if (!plainObject(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label}.${field} is required`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label}.${field} is not allowed`);
  }
}

function requiredId(value, label) {
  return requiredText(value, label, 200);
}

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} must be a non-empty string`);
  if (text.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return text;
}

function nullableDigest(value, label) {
  if (value === null || value === undefined || value === "") return null;
  sha256(value, label);
  return value;
}

function sha256(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function shaVersion(value, label) {
  if (!SHA_VERSION_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be a sha256-prefixed digest`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function validDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}

function cloneJson(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const QWEN_RESEARCH_DEFAULT_ENDPOINTS = Object.freeze({
  ollama: `http://${AMOS_LOCAL_HOST}`,
  mtplx: `http://${AMOS_MTPLX_HOST}`
});
