import { digestResearchValue } from "./experimentProtocol.js";
import {
  ORGANISM_CONTRACT_VERSION,
  STRATEGY_GENE_PROCEDURE_SCHEMA,
} from "./organismContracts.js";

/** Convert a host-observed swarm procedure into the organism's portable gene contract. */
export function extractVerifiedSwarmProcedure({ ecology, episode }) {
  if (
    !ecology
    || ecology.schema !== "amos.holographic-swarm-harbor-run"
    || !Array.isArray(ecology.outcomeMemories)
    || episode?.outcome?.kind !== "verified-pass"
    || episode?.verifier?.status !== "passed"
  ) return null;
  const candidates = ecology.outcomeMemories
    .filter(validOutcomeMemory)
    .map((memory) => ({ memory, procedure: memory.attemptedStrategy.procedure }))
    .filter(({ procedure }) => validProcedure(procedure))
    .sort((left, right) =>
      Number(right.procedure.observedEffects?.promoted === true)
        - Number(left.procedure.observedEffects?.promoted === true)
      || Number(right.memory.reward?.amount || 0) - Number(left.memory.reward?.amount || 0)
      || String(left.memory.id).localeCompare(String(right.memory.id))
    );
  const selected = candidates[0];
  if (!selected) return null;
  const { memory, procedure } = selected;
  const operation = procedure.operation || {};
  const preconditions = procedure.preconditions || {};
  const portability = procedure.portability || {};
  const role = String(portability.role || memory.attemptedStrategy.role || "specialist").slice(0, 200);
  const steps = [operation.hypothesis, operation.nextAction]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().slice(0, 2_000));
  if (steps.length === 0) return null;
  const failedCheckIds = stringList(preconditions.failedCheckIds, 64);
  const repairSignals = stringList(preconditions.repairSignals, 64);
  const stateSignature = String(procedure.stateSignature || "");
  const evidenceRefs = [...new Set([
    ...(Array.isArray(memory.evidenceRefs) ? memory.evidenceRefs : []),
    ...(Array.isArray(episode.verifier.evidenceRefs) ? episode.verifier.evidenceRefs : []),
  ].map(String).filter(Boolean))].sort();
  if (evidenceRefs.length === 0) return null;
  const taskPhase = String(memory.stateBefore?.boardPhase || "unknown").slice(0, 200);
  return {
    schema: STRATEGY_GENE_PROCEDURE_SCHEMA,
    schemaVersion: ORGANISM_CONTRACT_VERSION,
    spec: {
      name: `learned-${safeId(role)}-${stateSignature.slice(0, 12) || "procedure"}`,
      preconditions: {
        phases: [taskPhase],
        artifactClasses: ["candidate-mutation"],
        failureModes: [...new Set([...repairSignals, ...failedCheckIds])].sort(),
        toolFamilies: operation.transport ? [String(operation.transport).slice(0, 200)] : [],
      },
      rolePolicy: { [role]: operation.transport ? [String(operation.transport).slice(0, 200)] : [] },
      retrievalRecipe: [
        `match-state-signature:${stateSignature || digestResearchValue(preconditions)}`,
        "resolve-current-host-evidence",
      ],
      procedure: steps,
      stopConditions: [
        ...failedCheckIds.map((id) => `resolved:${id}`),
        "official-verifier-passes",
      ],
      rightsTags: [
        `source-class:${episode.dataPolicy.sourceClass}`,
        ...episode.dataPolicy.permittedUses.map((use) => `permitted-use:${use}`),
      ].sort(),
      contaminationTags: [...episode.dataPolicy.contaminationTags].sort(),
    },
    parentIds: [],
    evidenceRefs,
  };
}

export function createVerifiedProcedureApproval({ trace, receiptIdPrefix = "gene-approved" }) {
  if (trace?.outcome?.kind !== "verified-success" || trace?.procedure === null) return null;
  const traceDigest = digestResearchValue(trace);
  const candidateId = `candidate_${digestResearchValue({
    traceDigest,
    procedure: trace.procedure,
  }).slice(0, 24)}`;
  return {
    trialId: trace.trialId,
    receipt: {
      id: `${receiptIdPrefix}-${candidateId.slice("candidate_".length)}`,
      missionId: trace.runId,
      kind: "gene-approved",
      issuedAt: trace.finishedAt,
      payloadDigest: digestResearchValue({
        candidateId,
        evidenceRefs: trace.procedure.evidenceRefs,
      }),
      authority: "host",
    },
  };
}

function validOutcomeMemory(memory) {
  return memory
    && memory.schema === "amos.holographic-outcome-memory"
    && memory.verifiedBy === "amos-host-outcome-boundary"
    && memory.authority?.hostObservedOnly === true
    && memory.authority?.grantsCompletionCredit === false
    && memory.attemptedStrategy
    && Array.isArray(memory.evidenceRefs)
    && memory.evidenceRefs.length > 0;
}

function validProcedure(procedure) {
  return procedure
    && procedure.schema === "amos.holographic-procedural-gene"
    && procedure.version === 1
    && procedure.authority?.retrievalOnly === true
    && procedure.authority?.grantsCompletionCredit === false
    && procedure.portability?.taskSpecificIdentifiersExcluded === true;
}

function stringList(value, limit) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim().slice(0, 200)))].sort().slice(0, limit)
    : [];
}

function safeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "specialist";
}
