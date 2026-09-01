import { digestResearchValue } from "./experimentProtocol.js";

export const QWEN_ADAPTER_TRAINING_CONTRACT_SCHEMA =
  "amos.qwen-adapter-training-contract";
export const QWEN_ADAPTER_TRAINING_CONTRACT_VERSION = 1;

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const IMMUTABLE_IMAGE = /@sha256:[a-f0-9]{64}$/;
const S3_URI = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](?:\/[A-Za-z0-9!_.*'()/-]+)?$/;
const REQUIRED_SAFEGUARDS = Object.freeze([
  "publicBenchmarksExcluded",
  "trainingApprovalRequired",
  "hiddenReasoningExcluded",
  "credentialsExcluded",
  "tenantFactsExcluded",
  "sourceSplitsDisjointByMissionFamily"
]);

export function createQwenAdapterStageZeroContract({
  id,
  plan,
  datasetManifest,
  checkpoint,
  trainerImageUri,
  datasetUri,
  outputUri,
  sourceRevision,
  seed = 20260823
}) {
  const normalizedPlan = validatePlan(plan);
  const normalizedDataset = validateStageZeroDataset(datasetManifest, normalizedPlan);
  const normalizedCheckpoint = validateCheckpoint(checkpoint, normalizedPlan);
  const trainingSeed = integer(seed, "seed", 0, 2 ** 31 - 1);
  const contractBase = {
    schema: QWEN_ADAPTER_TRAINING_CONTRACT_SCHEMA,
    version: QWEN_ADAPTER_TRAINING_CONTRACT_VERSION,
    id: requiredId(id, "contract.id"),
    purpose: "pipeline-and-lineage-proof",
    qualityClaimAllowed: false,
    promotionAllowed: false,
    source: {
      revision: gitSha(sourceRevision, "sourceRevision"),
      trainerImageUri: immutableImage(trainerImageUri, "trainerImageUri")
    },
    dataset: {
      uri: s3Uri(datasetUri, "datasetUri"),
      manifestDigest: normalizedDataset.digest,
      trainingFile: {
        path: normalizedDataset.files.trainingSft.path,
        sha256: normalizedDataset.files.trainingSft.sha256,
        rows: normalizedDataset.files.trainingSft.rows
      },
      validationFile: {
        path: normalizedDataset.files.validationSft.path,
        sha256: normalizedDataset.files.validationSft.sha256,
        rows: normalizedDataset.files.validationSft.rows
      },
      holdoutFile: {
        path: normalizedDataset.files.holdoutSft.path,
        sha256: normalizedDataset.files.holdoutSft.sha256,
        rows: normalizedDataset.files.holdoutSft.rows
      },
      safeguards: structuredClone(normalizedDataset.safeguards)
    },
    base: {
      repository: normalizedCheckpoint.repository,
      revision: normalizedCheckpoint.revision,
      checkpointDigest: digestResearchValue(normalizedCheckpoint),
      checkpointBytes: normalizedCheckpoint.checkpointBytes,
      parameterCount: normalizedCheckpoint.parameterCount,
      architecture: normalizedCheckpoint.architecture,
      expectedShardDigests: normalizedCheckpoint.shards.map(({ path, sha256, bytes }) => ({
        path,
        sha256,
        bytes
      }))
    },
    recipe: {
      stage: 0,
      method: "qlora-micro-overfit",
      seed: trainingSeed,
      modelClass: "Qwen3_5ForConditionalGeneration",
      textOnlyExamples: true,
      includeVisionTowerInAdapter: false,
      quantization: {
        loadInBits: 4,
        type: "nf4",
        doubleQuantization: true,
        computeDtype: "bfloat16"
      },
      adapter: {
        type: "lora",
        rank: 16,
        alpha: 32,
        dropout: 0,
        bias: "none",
        targetModules: [
          "q_proj",
          "k_proj",
          "v_proj",
          "o_proj",
          "gate_proj",
          "up_proj",
          "down_proj",
          "in_proj_qkv",
          "in_proj_z",
          "in_proj_b",
          "in_proj_a",
          "out_proj"
        ]
      },
      optimization: {
        epochs: 10,
        microBatchSize: 1,
        gradientAccumulationSteps: 8,
        learningRate: 0.0002,
        weightDecay: 0,
        maximumSequenceTokens: 2048,
        gradientCheckpointing: true,
        loss: "assistant-tokens-only"
      }
    },
    execution: {
      outputUri: s3Uri(outputUri, "outputUri"),
      disposableTrainer: true,
      liveInferenceEndpointMutable: false,
      networkPublicIngressAllowed: false,
      torchNativeJitDisabled: true,
      requireSingleNvidiaGpuWithMinimumMemoryGib: 90
    },
    exitCriteria: {
      tokenizerAndChatTemplatePinned: true,
      allPromptTokensMasked: true,
      minimumSupervisedTokenAccuracy: 0.98,
      adapterReloadRequired: true,
      adapterMustChangeProbe: true,
      baseProbeMustBeBitwiseUnchangedWhenAdapterDisabled: true,
      completeMultimodalBaseMustRemainLoadable: true,
      visionTowerAdapterParametersMustEqual: 0,
      vllmAdapterLoadProofRequired: true
    }
  };
  return { ...contractBase, digest: digestResearchValue(contractBase) };
}

export function validateQwenAdapterStageZeroContract(input) {
  const contract = jsonObject(input, "training contract");
  if (contract.schema !== QWEN_ADAPTER_TRAINING_CONTRACT_SCHEMA) {
    throw new Error(`training contract.schema must be ${QWEN_ADAPTER_TRAINING_CONTRACT_SCHEMA}`);
  }
  if (contract.version !== QWEN_ADAPTER_TRAINING_CONTRACT_VERSION) {
    throw new Error(`training contract.version must be ${QWEN_ADAPTER_TRAINING_CONTRACT_VERSION}`);
  }
  const digest = contract.digest;
  delete contract.digest;
  if (!SHA256.test(String(digest || "")) || digestResearchValue(contract) !== digest) {
    throw new Error("training contract digest does not match its contents");
  }
  if (contract.purpose !== "pipeline-and-lineage-proof" ||
      contract.qualityClaimAllowed !== false || contract.promotionAllowed !== false) {
    throw new Error("stage-zero contract cannot make a quality or promotion claim");
  }
  immutableImage(contract.source?.trainerImageUri, "training contract source image");
  gitSha(contract.source?.revision, "training contract source revision");
  s3Uri(contract.dataset?.uri, "training contract dataset URI");
  s3Uri(contract.execution?.outputUri, "training contract output URI");
  if (contract.recipe?.stage !== 0 || contract.recipe?.method !== "qlora-micro-overfit") {
    throw new Error("training contract must remain the stage-zero QLoRA micro-overfit proof");
  }
  if (contract.recipe?.optimization?.loss !== "assistant-tokens-only") {
    throw new Error("stage-zero training must mask every non-assistant target token");
  }
  if (contract.recipe?.includeVisionTowerInAdapter !== false) {
    throw new Error("the text-only stage-zero adapter cannot target the vision tower");
  }
  if (contract.execution?.liveInferenceEndpointMutable !== false ||
      contract.execution?.disposableTrainer !== true) {
    throw new Error("stage-zero training must be isolated from the live inference endpoint");
  }
  if (contract.execution?.torchNativeJitDisabled !== true) {
    throw new Error("stage-zero training must pin the compiler-free PyTorch eager path");
  }
  return { ...contract, digest };
}

export function validateCheckpoint(input, plan = null) {
  const checkpoint = jsonObject(input, "checkpoint");
  if (checkpoint.schema !== "amos.pinned-upstream-checkpoint" || checkpoint.version !== 1) {
    throw new Error("Unsupported pinned upstream checkpoint manifest");
  }
  const repository = requiredText(checkpoint.repository, "checkpoint.repository", 500);
  if (plan && repository !== plan.base.trainingRepository) {
    throw new Error("checkpoint repository does not match the adapter training plan");
  }
  const revision = gitSha(checkpoint.revision, "checkpoint.revision");
  if (checkpoint.license !== "apache-2.0") {
    throw new Error("stage-zero checkpoint must retain the upstream Apache-2.0 license");
  }
  if (checkpoint.architecture !== "Qwen3_5ForConditionalGeneration" ||
      checkpoint.modelType !== "qwen3_5") {
    throw new Error("checkpoint architecture does not match Qwen3.8-27B");
  }
  const shards = array(checkpoint.shards, "checkpoint.shards");
  if (shards.length !== 18) throw new Error("checkpoint must contain exactly 18 weight shards");
  const normalizedShards = shards.map((shard, index) => {
    const value = jsonObject(shard, `checkpoint.shards[${index}]`);
    const expectedPath = `model-${String(index + 1).padStart(5, "0")}-of-00018.safetensors`;
    if (value.path !== expectedPath) throw new Error(`Unexpected checkpoint shard: ${value.path}`);
    if (!SHA256.test(String(value.sha256 || ""))) {
      throw new Error(`checkpoint shard ${value.path} requires an LFS SHA-256 object id`);
    }
    return {
      path: value.path,
      sha256: value.sha256,
      bytes: integer(value.bytes, `${value.path}.bytes`, 1, Number.MAX_SAFE_INTEGER)
    };
  });
  const checkpointBytes = integer(
    checkpoint.checkpointBytes,
    "checkpoint.checkpointBytes",
    1,
    Number.MAX_SAFE_INTEGER
  );
  if (normalizedShards.reduce((total, shard) => total + shard.bytes, 0) !== checkpointBytes) {
    throw new Error("checkpointBytes does not match the sum of pinned shard sizes");
  }
  return {
    ...checkpoint,
    repository,
    revision,
    checkpointBytes,
    parameterCount: integer(
      checkpoint.parameterCount,
      "checkpoint.parameterCount",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    shards: normalizedShards
  };
}

function validatePlan(input) {
  const plan = jsonObject(input, "adapter training plan");
  if (plan.schema !== "amos.swarm-substrate-adapter-training" || plan.version !== 1) {
    throw new Error("Unsupported adapter training plan");
  }
  if (plan.base?.trainingRepository !== "Qwen/Qwen3.8-27B" ||
      plan.base?.trainingMethod !== "qlora" ||
      plan.base?.trainFromCanonicalCheckpointRatherThanInferenceQuantization !== true) {
    throw new Error("adapter plan must train QLoRA from the canonical Qwen3.8-27B checkpoint");
  }
  const stageZero = plan.trainingLadder?.find(({ stage }) => stage === 0);
  if (!stageZero || stageZero.id !== "pipeline-and-lineage-proof" ||
      stageZero.method !== "qlora-micro-overfit" || stageZero.examples !== 64) {
    throw new Error("adapter plan stage zero must remain the 64-example pipeline proof");
  }
  if (plan.cloudExecution?.trainingEndpointIsDisposable !== true ||
      plan.cloudExecution?.liveInferenceEndpointIsImmutable !== true) {
    throw new Error("adapter plan must isolate disposable training from live inference");
  }
  return plan;
}

function validateStageZeroDataset(input, plan) {
  const manifest = jsonObject(input, "dataset manifest");
  if (manifest.schema !== "amos.native-qwen-dataset" || manifest.version !== 1 ||
      manifest.status !== "qualified") {
    throw new Error("stage-zero dataset manifest must be qualified AMOS-native data");
  }
  if (manifest.planId !== plan.id || manifest.baseModel !== plan.base.model) {
    throw new Error("stage-zero dataset does not match the adapter training plan");
  }
  const claimedDigest = manifest.digest;
  delete manifest.digest;
  if (!SHA256.test(String(claimedDigest || "")) || digestResearchValue(manifest) !== claimedDigest) {
    throw new Error("stage-zero dataset manifest digest does not match its contents");
  }
  const expectedCounts = {
    trainingExamples: 64,
    validationExamples: 16,
    holdoutExamples: 48
  };
  for (const [key, expected] of Object.entries(expectedCounts)) {
    if (manifest.counts?.[key] !== expected) {
      throw new Error(`stage-zero dataset ${key} must equal ${expected}`);
    }
  }
  if (manifest.blockers?.length !== 0) {
    throw new Error("stage-zero dataset cannot contain qualification blockers");
  }
  for (const key of REQUIRED_SAFEGUARDS) {
    if (manifest.safeguards?.[key] !== true) {
      throw new Error(`stage-zero dataset safeguard ${key} must be true`);
    }
  }
  for (const [name, rows] of [
    ["trainingSft", 64],
    ["validationSft", 16],
    ["holdoutSft", 48]
  ]) {
    const file = manifest.files?.[name];
    if (!file || file.rows !== rows || !SHA256.test(String(file.sha256 || ""))) {
      throw new Error(`stage-zero dataset file ${name} is invalid`);
    }
  }
  return { ...manifest, digest: claimedDigest };
}

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value);
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return structuredClone(value);
}

function requiredId(value, label) {
  const id = requiredText(value, label, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
}

function requiredText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function gitSha(value, label) {
  const sha = String(value || "");
  if (!GIT_SHA.test(sha)) throw new Error(`${label} must be a full lowercase Git SHA`);
  return sha;
}

function immutableImage(value, label) {
  const image = requiredText(value, label, 2_000);
  if (!IMMUTABLE_IMAGE.test(image)) throw new Error(`${label} must end in @sha256:<digest>`);
  return image;
}

function s3Uri(value, label) {
  const uri = requiredText(value, label, 2_000);
  if (!S3_URI.test(uri) || uri.includes("..")) throw new Error(`${label} must be a bounded s3:// URI`);
  return uri.replace(/\/$/, "");
}

function integer(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}
