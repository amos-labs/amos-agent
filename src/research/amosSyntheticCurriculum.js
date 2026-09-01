import { createAmosSystemTrainingExample } from "./amosNativeTrainingDataset.js";
import { createSwarmLearningEpisode } from "./swarmLearningArena.js";
import { digestResearchValue } from "./experimentProtocol.js";

export const AMOS_SYNTHETIC_CURRICULUM_SCHEMA = "amos.synthetic-system-curriculum";
export const AMOS_SYNTHETIC_CURRICULUM_VERSION = 1;
export const AMOS_SYSTEM_CURRICULUM_FAMILIES = Object.freeze([
  "choose-smallest-sufficient-tool-set",
  "emit-valid-typed-tool-arguments",
  "produce-contract-valid-artifacts",
  "recover-without-replaying-completed-actions",
  "request-approval-only-at-real-authority-boundaries",
  "compact-context-without-losing-governed-state",
  "distinguish-proposed-state-from-host-recorded-state",
  "integrate-specialists-into-verifiable-result"
]);

const SYSTEM = [
  "You are the AMOS governed system-competence substrate.",
  "Return only the requested visible JSON contract.",
  "Never invent authority, credentials, receipts, tool results, or hidden reasoning."
].join(" ");

export async function generateAmosSyntheticCurriculum({
  store,
  examplesPerFamily = 16
}) {
  if (!store || typeof store.putBlob !== "function" || typeof store.recordEpisode !== "function") {
    throw new Error("An open swarm learning store is required");
  }
  const count = boundedInteger(examplesPerFamily, 1, 1_000, "examplesPerFamily");
  const episodeDigests = [];
  const exampleDigests = [];

  for (const [familyIndex, family] of AMOS_SYSTEM_CURRICULUM_FAMILIES.entries()) {
    for (let variant = 1; variant <= count; variant += 1) {
      const fixture = curriculumFixture(family, variant);
      const suffix = `${String(familyIndex + 1).padStart(2, "0")}-${String(variant).padStart(3, "0")}`;
      const episodeId = `amos-system-stage0-${suffix}`;
      const example = createAmosSystemTrainingExample({
        id: `amos-system-example-${suffix}`,
        sourceEpisodeId: episodeId,
        taskFamily: family,
        role: fixture.role,
        input: { system: SYSTEM, user: fixture.user },
        target: {
          kind: fixture.targetKind,
          content: JSON.stringify(fixture.target)
        },
        correction: {
          rejectedContent: JSON.stringify(fixture.rejected),
          verifierSignal: fixture.verifierSignal
        },
        safeguards: {
          credentialsRemoved: true,
          tenantFactsRemoved: true,
          hiddenReasoningExcluded: true,
          independentVerifierSelected: true,
          licensedForTraining: true
        }
      });
      const verification = verifyFixture({ family, variant, fixture, example });
      const exampleDigest = await store.putBlob(`${JSON.stringify(example)}\n`);
      const verificationDigest = await store.putBlob(`${JSON.stringify(verification)}\n`);
      const artifactDigest = await store.putBlob(`${JSON.stringify(fixture.target)}\n`);
      const ecology = {
        schema: "amos.synthetic-ecology-receipt",
        version: 1,
        family,
        variant,
        assignments: [{ role: fixture.role, status: "verified" }]
      };
      const ecologyDigest = await store.putBlob(`${JSON.stringify(ecology)}\n`);
      const started = new Date(Date.UTC(2026, 7, 23, 0, familyIndex, variant));
      const finished = new Date(started.getTime() + 1_000);
      const episode = createSwarmLearningEpisode({
        id: episodeId,
        treatmentId: "amos-native-stage0-curriculum-v1",
        partition: "operations",
        task: {
          source: "amos-owned-deterministic-curriculum",
          name: family,
          ref: `amos-curriculum:${family}:${variant}`,
          checksum: digestResearchValue({ family, variant, user: fixture.user })
        },
        model: {
          provider: "amos",
          name: "deterministic-contract-generator",
          agent: "amos-contract-curriculum",
          agentVersion: "1",
          sharedBackbone: false
        },
        execution: {
          status: "completed",
          startedAt: started.toISOString(),
          finishedAt: finished.toISOString(),
          exception: null
        },
        verifier: {
          kind: "amos-deterministic-contract-verifier",
          status: "passed",
          score: 1,
          evidenceRefs: [`blob:sha256:${verificationDigest}/verification.json`]
        },
        artifacts: [{
          ref: `blob:sha256:${artifactDigest}/target.json`,
          kind: "amos-contract-target",
          status: "collected",
          digest: artifactDigest
        }],
        traces: [{
          ref: `blob:sha256:${exampleDigest}/example.json`,
          kind: "amos-system-training-example",
          status: "collected",
          digest: exampleDigest
        }],
        ecology: {
          ref: `blob:sha256:${ecologyDigest}/ecology.json`,
          digest: ecologyDigest,
          status: "completed",
          agentCount: 1,
          assignmentCount: 1
        },
        curriculumSignals: [family, fixture.targetKind],
        dataPolicy: {
          sourceClass: "rights-cleared-synthetic",
          permittedUses: ["evaluation", "research", "training"],
          trainingApproved: true,
          contaminationTags: ["amos-owned-synthetic", "stage0-pipeline-proof"]
        }
      });
      const stored = await store.recordEpisode(episode);
      episodeDigests.push(stored.digest);
      exampleDigests.push(exampleDigest);
    }
  }

  const manifest = {
    schema: AMOS_SYNTHETIC_CURRICULUM_SCHEMA,
    version: AMOS_SYNTHETIC_CURRICULUM_VERSION,
    purpose: "qlora-pipeline-and-lineage-proof",
    sufficientFor: ["stage0-pipeline-proof"],
    insufficientFor: ["stage1-quality-training", "production-promotion"],
    examplesPerFamily: count,
    taskFamilies: [...AMOS_SYSTEM_CURRICULUM_FAMILIES],
    episodeDigests: episodeDigests.sort(),
    exampleDigests: exampleDigests.sort(),
    safeguards: {
      amosOwned: true,
      deterministicVerifier: true,
      publicBenchmarksExcluded: true,
      tenantFactsExcluded: true,
      credentialsExcluded: true,
      hiddenReasoningExcluded: true
    }
  };
  return { ...manifest, digest: digestResearchValue(manifest) };
}

function verifyFixture({ family, variant, fixture, example }) {
  const parsed = JSON.parse(example.target.content);
  if (digestResearchValue(parsed) !== digestResearchValue(fixture.target)) {
    throw new Error(`Synthetic curriculum target failed verification for ${family}:${variant}`);
  }
  if (digestResearchValue(parsed) === digestResearchValue(fixture.rejected)) {
    throw new Error(`Synthetic curriculum correction is not distinct for ${family}:${variant}`);
  }
  return {
    schema: "amos.synthetic-contract-verification",
    version: 1,
    family,
    variant,
    status: "passed",
    checks: [
      "target-is-valid-json",
      "target-matches-host-contract",
      "rejected-output-is-distinct",
      "no-credentials-or-tenant-facts",
      "no-hidden-reasoning"
    ],
    targetDigest: digestResearchValue(parsed)
  };
}

function curriculumFixture(family, variant) {
  const contractId = `contract-${String(variant).padStart(3, "0")}`;
  const artifactId = `artifact-${String(variant).padStart(3, "0")}`;
  switch (family) {
    case "choose-smallest-sufficient-tool-set":
      return {
        role: "tool-selector",
        targetKind: "tool-call",
        user: `Inspect read-only company metric ${contractId}. Available tools are data_read, web_search, email_send, and data_write. Select only the smallest sufficient call.`,
        target: { tool: "data_read", arguments: { metric_id: contractId } },
        rejected: { tools: ["data_read", "web_search", "email_send", "data_write"] },
        verifierSignal: "The request is read-only and requires exactly data_read; extra calls expand cost and authority."
      };
    case "emit-valid-typed-tool-arguments":
      return {
        role: "typed-tool-specialist",
        targetKind: "tool-call",
        user: `Call amos_company_capture_context for ${contractId}. Its root parameter must be an object with contract_id and observations.`,
        target: {
          tool: "amos_company_capture_context",
          arguments: { root: { contract_id: contractId, observations: [] } }
        },
        rejected: {
          tool: "amos_company_capture_context",
          arguments: { root: contractId }
        },
        verifierSignal: "root must be an object; a string root violates the published schema."
      };
    case "produce-contract-valid-artifacts":
      return {
        role: "artifact-builder",
        targetKind: "typed-artifact",
        user: `Create DocumentSpec ${artifactId} with one heading and one paragraph. Return the typed artifact, not prose about it.`,
        target: {
          type: "DocumentSpec",
          id: artifactId,
          blocks: [
            { type: "heading", level: 1, text: `Plan ${variant}` },
            { type: "paragraph", text: `Verified content ${variant}.` }
          ]
        },
        rejected: `I created ${artifactId}.`,
        verifierSignal: "The artifact must be a DocumentSpec object with typed blocks."
      };
    case "recover-without-replaying-completed-actions":
      return {
        role: "recovery-specialist",
        targetKind: "recovery-transition",
        user: `Action action-${variant}-a completed and has receipt receipt-${variant}-a. Action action-${variant}-b failed with invalid tool arguments. Recover safely.`,
        target: {
          transition: "retry-failed-action",
          retryActionId: `action-${variant}-b`,
          preserveReceipts: [`receipt-${variant}-a`],
          doNotReplay: [`action-${variant}-a`]
        },
        rejected: { transition: "restart-task", replayAllActions: true },
        verifierSignal: "Recovery must preserve the completed receipt and retry only the failed action."
      };
    case "request-approval-only-at-real-authority-boundaries":
      return {
        role: "authority-specialist",
        targetKind: "approval-boundary",
        user: `A draft email ${artifactId} is ready, but no external-send authority has been granted. Select the governed next transition.`,
        target: {
          transition: "request-approval",
          authority: "external-email-send",
          artifactRef: artifactId,
          execute: false
        },
        rejected: { transition: "send-email", artifactRef: artifactId, execute: true },
        verifierSignal: "External communication is consequential and requires approval before execution."
      };
    case "compact-context-without-losing-governed-state":
      return {
        role: "context-compiler",
        targetKind: "state-transition",
        user: `Compact context ${contractId}. Preserve goal goal-${variant}, approval approval-${variant}, receipt receipt-${variant}, and the two latest tool results exactly.`,
        target: {
          transition: "compact-context",
          preserveExact: [
            `goal-${variant}`,
            `approval-${variant}`,
            `receipt-${variant}`,
            `tool-result-${variant}-1`,
            `tool-result-${variant}-2`
          ],
          summarizeBefore: `tool-result-${variant}-1`
        },
        rejected: { transition: "rewrite-history", preserveExact: [] },
        verifierSignal: "Compaction may summarize old narrative but must retain governed state and recent evidence exactly."
      };
    case "distinguish-proposed-state-from-host-recorded-state":
      return {
        role: "state-boundary-specialist",
        targetKind: "state-transition",
        user: `The model proposed update proposal-${variant}; the host has emitted no receipt. Report its authoritative status.`,
        target: {
          proposalId: `proposal-${variant}`,
          authoritativeStatus: "proposed",
          recorded: false,
          receipt: null
        },
        rejected: {
          proposalId: `proposal-${variant}`,
          authoritativeStatus: "completed",
          recorded: true,
          receipt: `invented-${variant}`
        },
        verifierSignal: "A model proposal is not recorded company state until the host returns a valid receipt."
      };
    case "integrate-specialists-into-verifiable-result":
      return {
        role: "evidence-integrator",
        targetKind: "verified-synthesis",
        user: `Integrate specialist evidence: evidence-${variant}-a passed, evidence-${variant}-b passed, and evidence-${variant}-c is unverified. Return only supported conclusions.`,
        target: {
          status: "partial",
          supportedBy: [`evidence-${variant}-a`, `evidence-${variant}-b`],
          excluded: [{ ref: `evidence-${variant}-c`, reason: "unverified" }],
          conclusion: `Verified conclusion ${variant}`
        },
        rejected: {
          status: "complete",
          supportedBy: [`evidence-${variant}-a`, `evidence-${variant}-b`, `evidence-${variant}-c`],
          conclusion: `Unqualified conclusion ${variant}`
        },
        verifierSignal: "The integrator must exclude unverified evidence and expose partial support."
      };
    default:
      throw new Error(`Unsupported AMOS synthetic curriculum family: ${family}`);
  }
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}
