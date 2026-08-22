import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes
} from "node:crypto";
import {
  RESEARCH_PROTOCOL_VERSION,
  digestResearchValue,
  evaluateResearchPromotion
} from "./experimentProtocol.js";

export const RESEARCH_EVALUATION_ATTESTATION_SCHEMA =
  "amos.research-evaluation-attestation";
export const RESEARCH_EVALUATION_ATTESTATION_ALGORITHM = "Ed25519";

/**
 * Create a portable evaluator attestation. The signing key belongs to the
 * evaluator boundary and must never be made available to the candidate or
 * proposer.
 */
export function createResearchEvaluationAttestation({
  proposal,
  evaluationManifest,
  outcome,
  evaluator,
  privateKey,
  keyId,
  issuedAt = new Date().toISOString()
}) {
  const signingKey = normalizePrivateKey(privateKey);
  const decision = evaluateResearchPromotion({ proposal, evaluationManifest, outcome });
  const payload = buildPayload({ decision, evaluator, issuedAt });
  const unsignedAttestation = {
    schema: RESEARCH_EVALUATION_ATTESTATION_SCHEMA,
    version: RESEARCH_PROTOCOL_VERSION,
    algorithm: RESEARCH_EVALUATION_ATTESTATION_ALGORITHM,
    keyId: requiredId(keyId, "attestation.keyId"),
    payload
  };
  const signingDigest = digestResearchValue(unsignedAttestation);
  const signature = signBytes(null, Buffer.from(signingDigest, "hex"), signingKey);

  return {
    ...unsignedAttestation,
    signature: signature.toString("base64")
  };
}

/**
 * Verify both the Ed25519 signature and the semantic binding to the supplied
 * proposal, evaluation manifest, outcome, and deterministic promotion result.
 */
export function verifyResearchEvaluationAttestation({
  attestation: inputAttestation,
  proposal,
  evaluationManifest,
  outcome,
  publicKey
}) {
  const attestation = validateResearchEvaluationAttestation(inputAttestation);
  const verificationKey = normalizePublicKey(publicKey);
  const decision = evaluateResearchPromotion({ proposal, evaluationManifest, outcome });
  const expectedPayload = buildPayload({
    decision,
    evaluator: attestation.payload.evaluator,
    issuedAt: attestation.payload.issuedAt
  });

  if (digestResearchValue(attestation.payload) !== digestResearchValue(expectedPayload)) {
    throw new Error("Evaluation attestation does not match the supplied research evidence");
  }

  const signingDigest = digestResearchValue(unsignedAttestation(attestation));
  const signature = decodeSignature(attestation.signature);
  if (!verifyBytes(null, Buffer.from(signingDigest, "hex"), verificationKey, signature)) {
    throw new Error("Evaluation attestation signature is invalid");
  }

  return { valid: true, attestation, decision };
}

export function validateResearchEvaluationAttestation(input) {
  const attestation = cloneJson(input, "Evaluation attestation");
  assertExactFields(attestation, "attestation", [
    "schema",
    "version",
    "algorithm",
    "keyId",
    "payload",
    "signature"
  ]);
  if (
    attestation.schema !== RESEARCH_EVALUATION_ATTESTATION_SCHEMA ||
    attestation.version !== RESEARCH_PROTOCOL_VERSION
  ) {
    throw new Error("Unsupported evaluation attestation schema");
  }
  if (attestation.algorithm !== RESEARCH_EVALUATION_ATTESTATION_ALGORITHM) {
    throw new Error("Evaluation attestation algorithm must be Ed25519");
  }
  requiredId(attestation.keyId, "attestation.keyId");
  validatePayload(attestation.payload);
  decodeSignature(attestation.signature);
  return attestation;
}

function buildPayload({ decision, evaluator, issuedAt }) {
  validateEvaluator(evaluator);
  const normalizedIssuedAt = validDate(issuedAt, "attestation.payload.issuedAt").toISOString();
  return {
    evaluator: {
      id: evaluator.id,
      version: evaluator.version,
      environmentDigest: evaluator.environmentDigest
    },
    issuedAt: normalizedIssuedAt,
    experimentId: decision.experimentId,
    candidateId: decision.candidateId,
    proposalDigest: decision.evidence.proposalDigest,
    evaluationManifestDigest: decision.evidence.evaluationManifestDigest,
    outcomeDigest: decision.evidence.outcomeDigest,
    promotionDecisionDigest: digestResearchValue(decision),
    eligible: decision.eligible,
    reasons: [...decision.reasons]
  };
}

function unsignedAttestation(attestation) {
  return {
    schema: attestation.schema,
    version: attestation.version,
    algorithm: attestation.algorithm,
    keyId: attestation.keyId,
    payload: attestation.payload
  };
}

function validatePayload(payload) {
  assertExactFields(payload, "attestation.payload", [
    "evaluator",
    "issuedAt",
    "experimentId",
    "candidateId",
    "proposalDigest",
    "evaluationManifestDigest",
    "outcomeDigest",
    "promotionDecisionDigest",
    "eligible",
    "reasons"
  ]);
  validateEvaluator(payload.evaluator);
  validDate(payload.issuedAt, "attestation.payload.issuedAt");
  requiredId(payload.experimentId, "attestation.payload.experimentId");
  requiredId(payload.candidateId, "attestation.payload.candidateId");
  for (const field of [
    "proposalDigest",
    "evaluationManifestDigest",
    "outcomeDigest",
    "promotionDecisionDigest"
  ]) {
    sha256(payload[field], `attestation.payload.${field}`);
  }
  if (typeof payload.eligible !== "boolean") {
    throw new Error("attestation.payload.eligible must be boolean");
  }
  if (
    !Array.isArray(payload.reasons) ||
    payload.reasons.some((reason) => typeof reason !== "string" || !reason.trim())
  ) {
    throw new Error("attestation.payload.reasons must be an array of non-empty strings");
  }
  if (new Set(payload.reasons).size !== payload.reasons.length) {
    throw new Error("attestation.payload.reasons contains duplicates");
  }
  const sortedReasons = [...payload.reasons].sort();
  if (JSON.stringify(sortedReasons) !== JSON.stringify(payload.reasons)) {
    throw new Error("attestation.payload.reasons must be sorted");
  }
  if (payload.eligible && payload.reasons.length > 0) {
    throw new Error("An eligible attestation cannot contain rejection reasons");
  }
  if (!payload.eligible && payload.reasons.length === 0) {
    throw new Error("An ineligible attestation must contain a rejection reason");
  }
}

function validateEvaluator(evaluator) {
  assertExactFields(evaluator, "attestation.payload.evaluator", [
    "id",
    "version",
    "environmentDigest"
  ]);
  requiredId(evaluator.id, "attestation.payload.evaluator.id");
  requiredId(evaluator.version, "attestation.payload.evaluator.version");
  sha256(
    evaluator.environmentDigest,
    "attestation.payload.evaluator.environmentDigest"
  );
}

function normalizePrivateKey(input) {
  let key;
  try {
    key = input?.type === "private" ? input : createPrivateKey(input);
  } catch {
    throw new Error("Evaluation attestation private key is invalid");
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") {
    throw new Error("Evaluation attestation private key must be Ed25519");
  }
  return key;
}

function normalizePublicKey(input) {
  let key;
  try {
    key = input?.type === "public" ? input : createPublicKey(input);
  } catch {
    throw new Error("Evaluation attestation public key is invalid");
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    throw new Error("Evaluation attestation public key must be Ed25519");
  }
  return key;
}

function decodeSignature(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("attestation.signature must be canonical base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    throw new Error("attestation.signature must be a 64-byte Ed25519 signature");
  }
  return decoded;
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
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} must be a non-empty string`);
  if (text.length > 200) throw new Error(`${label} exceeds 200 characters`);
  return text;
}

function sha256(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
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
