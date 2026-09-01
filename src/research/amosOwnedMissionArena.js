import { digestResearchValue } from "./experimentProtocol.js";

export const AMOS_OWNED_MISSION_VERIFIERS_SCHEMA = "amos.owned-mission-verifiers";
export const AMOS_OWNED_MISSION_VERIFIER_VERSION = 1;

/**
 * Verify visible mission answers with pre-registered, candidate-independent
 * concept assertions. These checks define observable facts, not a solution
 * procedure, and are deliberately insufficient for frontier-quality claims.
 */
export function verifyAmosOwnedMissionAnswer({ mission, verifier, answer }) {
  const normalizedMission = objectValue(mission, "mission");
  const normalizedVerifier = normalizeVerifier(verifier);
  if (normalizedVerifier.missionId !== normalizedMission.id) {
    throw new Error("Mission and verifier IDs do not match");
  }
  const text = String(answer ?? "").trim();
  if (!text) throw new Error("Mission answer must be non-empty text");
  const folded = fold(text);
  const criteria = normalizedVerifier.criteria.map((criterion) => {
    const groups = criterion.requiredConcepts.map((alternatives) => ({
      alternatives,
      matched: alternatives.some((candidate) => folded.includes(fold(candidate)))
    }));
    return {
      id: criterion.id,
      passed: groups.every(({ matched }) => matched),
      groups
    };
  });
  const prohibited = normalizedVerifier.prohibitedConcepts.filter((concept) =>
    folded.includes(fold(concept))
  );
  const passed = criteria.every((criterion) => criterion.passed) && prohibited.length === 0;
  const receipt = {
    schema: "amos.owned-mission-verifier-receipt",
    version: AMOS_OWNED_MISSION_VERIFIER_VERSION,
    missionId: normalizedMission.id,
    verifierId: normalizedVerifier.id,
    verifierDigest: digestResearchValue(normalizedVerifier),
    passed,
    criterionCount: criteria.length,
    passedCriteria: criteria.filter((criterion) => criterion.passed).length,
    failedCriterionIds: criteria.filter((criterion) => !criterion.passed).map(({ id }) => id),
    prohibitedConceptsFound: prohibited,
    criteria
  };
  return { ...receipt, digest: digestResearchValue(receipt) };
}

export function validateAmosOwnedMissionVerifierManifest(input) {
  const manifest = objectValue(input, "verifier manifest");
  if (manifest.schema !== AMOS_OWNED_MISSION_VERIFIERS_SCHEMA ||
      manifest.version !== AMOS_OWNED_MISSION_VERIFIER_VERSION) {
    throw new Error("Unsupported AMOS-owned mission verifier manifest");
  }
  requiredText(manifest.id, "verifier manifest.id");
  if (manifest.dataClassification !== "amos-owned-training-development") {
    throw new Error("Verifier manifest must remain AMOS-owned training development data");
  }
  if (!Array.isArray(manifest.verifiers) || manifest.verifiers.length < 1) {
    throw new Error("Verifier manifest requires at least one verifier");
  }
  const verifiers = manifest.verifiers.map(normalizeVerifier);
  if (new Set(verifiers.map(({ missionId }) => missionId)).size !== verifiers.length) {
    throw new Error("Verifier mission IDs must be unique");
  }
  return { ...manifest, verifiers };
}

function normalizeVerifier(input) {
  const verifier = objectValue(input, "verifier");
  if (!Array.isArray(verifier.criteria) || verifier.criteria.length < 2) {
    throw new Error("Each AMOS-owned mission verifier requires at least two criteria");
  }
  return {
    id: requiredText(verifier.id, "verifier.id"),
    missionId: requiredText(verifier.missionId, "verifier.missionId"),
    family: requiredText(verifier.family, "verifier.family"),
    criteria: verifier.criteria.map((criterion, criterionIndex) => {
      const value = objectValue(criterion, `verifier.criteria[${criterionIndex}]`);
      if (!Array.isArray(value.requiredConcepts) || value.requiredConcepts.length < 1) {
        throw new Error("Verifier criteria require concept groups");
      }
      return {
        id: requiredText(value.id, `verifier.criteria[${criterionIndex}].id`),
        requiredConcepts: value.requiredConcepts.map((group, groupIndex) => {
          if (!Array.isArray(group) || group.length < 1) {
            throw new Error(`Verifier concept group ${groupIndex} must be non-empty`);
          }
          return [...new Set(group.map((concept) => requiredText(
            concept,
            `verifier.criteria[${criterionIndex}].requiredConcepts[${groupIndex}]`
          )))];
        })
      };
    }),
    prohibitedConcepts: Array.isArray(verifier.prohibitedConcepts)
      ? [...new Set(verifier.prohibitedConcepts.map((concept) =>
          requiredText(concept, "verifier.prohibitedConcepts")))]
      : []
  };
}

function fold(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value);
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} must be non-empty text`);
  if (text.length > 20_000) throw new Error(`${label} exceeds 20000 characters`);
  return text;
}
