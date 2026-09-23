import { MODEL_PROTOCOLS } from "./protocol.js";

const MANTLE_REGIONS = Object.freeze([
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-south-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-south-1",
  "eu-north-1",
  "sa-east-1",
  "us-gov-west-1"
]);

const GPT_56_REGIONS = Object.freeze(["us-east-1", "us-east-2", "us-west-2"]);
const GPT_56_SOL_REGIONS = Object.freeze(["us-east-1", "us-east-2"]);
const GPT_6_SOL_LUNA_REGIONS = Object.freeze(["us-east-1"]);
const GPT_6_ASTRA_REGIONS = Object.freeze(["us-west-2"]);
const CLAUDE_5_VERIFIED_REGIONS = Object.freeze(["us-east-1"]);
// Mantle regions from the 2026-09-22 availability note. bedrock-runtime calls
// use us.|eu.|au.|jp.|global.anthropic.claude-opus-5-5, not this foundation id.
const OPUS_55_MANTLE_REGIONS = Object.freeze(["us-east-1", "ap-southeast-4"]);

export const BEDROCK_MANTLE_CATALOG = Object.freeze({
  schema: "amos.bedrock-mantle-catalog:1",
  verifiedAt: "2026-09-23",
  defaultRegion: "us-east-1",
  regions: MANTLE_REGIONS,
  originTemplate: "https://bedrock-mantle.{region}.api.aws",
  sources: Object.freeze([
    "https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/inference-messages-api.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-sol.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-terra.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-luna.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5-1.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html",
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html"
  ]),
  defaultModel: "openai.gpt-5.6-terra",
  models: Object.freeze([
    model({
      id: "openai.gpt-6-luna",
      label: "GPT-6 Luna",
      family: "OpenAI",
      protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
      endpointPath: "/openai/v1",
      authScheme: "bearer",
      regions: GPT_6_SOL_LUNA_REGIONS,
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
      capabilities: { tools: true, vision: true, reasoning: true, encryptedReasoning: false }
    }),
    model({
      id: "openai.gpt-6-sol",
      label: "GPT-6 Sol",
      family: "OpenAI",
      protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
      endpointPath: "/openai/v1",
      authScheme: "bearer",
      regions: GPT_6_SOL_LUNA_REGIONS,
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
      capabilities: { tools: true, vision: true, reasoning: true, encryptedReasoning: false }
    }),
    model({
      id: "openai.gpt-6-astra",
      label: "GPT-6 Astra",
      family: "OpenAI",
      protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
      endpointPath: "/openai/v1",
      authScheme: "bearer",
      regions: GPT_6_ASTRA_REGIONS,
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
      capabilities: { tools: true, vision: true, reasoning: true, encryptedReasoning: false }
    }),
    model({
      id: "openai.gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      family: "OpenAI",
      protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
      endpointPath: "/openai/v1",
      authScheme: "bearer",
      regions: GPT_56_REGIONS,
      capabilities: { tools: true, vision: true, reasoning: true, encryptedReasoning: false }
    }),
    model({
      id: "openai.gpt-5.6-terra",
      label: "GPT-5.6 Terra",
      family: "OpenAI",
      protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
      endpointPath: "/openai/v1",
      authScheme: "bearer",
      regions: GPT_56_REGIONS,
      capabilities: { tools: true, vision: true, reasoning: true, encryptedReasoning: false }
    }),
    model({
      id: "openai.gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      family: "OpenAI",
      protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
      endpointPath: "/openai/v1",
      authScheme: "bearer",
      regions: GPT_56_SOL_REGIONS,
      capabilities: { tools: true, vision: true, reasoning: true, encryptedReasoning: false }
    }),
    model({
      id: "openai.gpt-oss-20b",
      label: "GPT OSS 20B",
      family: "OpenAI",
      aliases: ["openai.gpt-oss-20b-1:0"],
      protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
      endpointPath: "/v1",
      authScheme: "bearer",
      regions: MANTLE_REGIONS,
      capabilities: { tools: true, vision: false, reasoning: true, encryptedReasoning: false }
    }),
    model({
      id: "openai.gpt-oss-120b",
      label: "GPT OSS 120B",
      family: "OpenAI",
      aliases: ["openai.gpt-oss-120b-1:0"],
      protocol: MODEL_PROTOCOLS.OPENAI_RESPONSES,
      endpointPath: "/v1",
      authScheme: "bearer",
      regions: MANTLE_REGIONS,
      capabilities: { tools: true, vision: false, reasoning: true, encryptedReasoning: false }
    }),
    model({
      id: "anthropic.claude-fable-5-1",
      label: "Claude Fable 5.1",
      family: "Anthropic",
      protocol: MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      endpointPath: "/anthropic/v1",
      authScheme: "x-api-key",
      apiVersion: "2023-06-01",
      supportedReasoningEfforts: ["low", "medium", "high", "max"],
      defaultReasoningEffort: "medium",
      regions: CLAUDE_5_VERIFIED_REGIONS,
      capabilities: { tools: true, vision: true, reasoning: true }
    }),
    model({
      id: "anthropic.claude-fable-5",
      label: "Claude Fable 5",
      family: "Anthropic",
      protocol: MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      endpointPath: "/anthropic/v1",
      authScheme: "x-api-key",
      apiVersion: "2023-06-01",
      supportedReasoningEfforts: ["low", "medium", "high", "max"],
      defaultReasoningEffort: "medium",
      regions: CLAUDE_5_VERIFIED_REGIONS,
      dataRetention: {
        requiredMode: "provider_data_share",
        dataSharedWithProvider: true,
        maximumRetentionDays: 30
      },
      capabilities: { tools: true, vision: true, reasoning: true }
    }),
    model({
      id: "anthropic.claude-sonnet-5",
      label: "Claude Sonnet 5",
      family: "Anthropic",
      protocol: MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      endpointPath: "/anthropic/v1",
      authScheme: "x-api-key",
      apiVersion: "2023-06-01",
      supportedReasoningEfforts: ["low", "medium", "high", "max"],
      defaultReasoningEffort: "medium",
      regions: CLAUDE_5_VERIFIED_REGIONS,
      capabilities: { tools: true, vision: true, reasoning: true }
    }),
    model({
      id: "anthropic.claude-opus-5-5",
      label: "Claude Opus 5.5",
      family: "Anthropic",
      protocol: MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      endpointPath: "/anthropic/v1",
      authScheme: "x-api-key",
      apiVersion: "2023-06-01",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
      regions: OPUS_55_MANTLE_REGIONS,
      capabilities: { tools: true, vision: true, reasoning: true }
    }),
    model({
      id: "anthropic.claude-opus-5",
      label: "Claude Opus 5",
      family: "Anthropic",
      protocol: MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      endpointPath: "/anthropic/v1",
      authScheme: "x-api-key",
      apiVersion: "2023-06-01",
      supportedReasoningEfforts: ["low", "medium", "high", "max"],
      defaultReasoningEffort: "medium",
      regions: CLAUDE_5_VERIFIED_REGIONS,
      capabilities: { tools: true, vision: true, reasoning: true }
    })
  ])
});

function model(input) {
  return Object.freeze({
    ...input,
    aliases: Object.freeze([...(input.aliases || [])]),
    regions: Object.freeze([...(input.regions || [])]),
    supportedReasoningEfforts: Object.freeze([...(input.supportedReasoningEfforts || [])]),
    dataRetention: input.dataRetention ? Object.freeze({ ...input.dataRetention }) : null,
    capabilities: Object.freeze({ ...(input.capabilities || {}) })
  });
}
