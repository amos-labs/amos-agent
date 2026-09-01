import { digestResearchValue } from "./experimentProtocol.js";
import {
  HolographicWorldV2,
  UnitaryHolographicMemory
} from "./holographicWorldV2.js";

export const DUAL_CHANNEL_HOLOGRAPHIC_WORLD_SCHEMA =
  "amos.dual-channel-holographic-world";

/**
 * Experimental two-channel world memory.
 *
 * The semantic channel may propose related exact entries. It can never grant
 * authority. The identity channel uses an atomic frequency-unitary code over
 * canonical typed content and must resolve through the exact host dictionary.
 */
export class DualChannelHolographicWorld {
  constructor({
    memory = new UnitaryHolographicMemory(),
    semanticFillerMode = "unitary",
    identityThreshold = 0.5,
    boardDigest = null
  } = {}) {
    if (!(memory instanceof UnitaryHolographicMemory)) {
      throw new Error("DualChannelHolographicWorld requires UnitaryHolographicMemory");
    }
    if (!Number.isFinite(identityThreshold)) {
      throw new Error("identityThreshold must be finite");
    }
    this.memory = memory;
    this.identityThreshold = identityThreshold;
    this.semanticWorld = new HolographicWorldV2({
      memory,
      fillerMode: semanticFillerMode,
      boardDigest
    });
    this.identityWorldVector = new Array(memory.dimension).fill(0);
    this.entries = [];
    this.slotIndex = new Map();
  }

  observe(input) {
    const exact = this.semanticWorld.observe(input);
    const slots = typedSlots(exact);
    const identityDigest = canonicalIdentityDigest(exact);
    const identity = this.memory.symbol(`exact-identity:${identityDigest}`);
    const binding = this.memory.bindMany([...slotKeys(this.memory, slots), identity]);
    for (let index = 0; index < this.memory.dimension; index += 1) {
      this.identityWorldVector[index] += binding[index];
    }
    const stored = { ...exact, slots, identityDigest, identity };
    this.entries.push(stored);
    const signature = slotSignature(slots);
    const candidates = this.slotIndex.get(signature) || [];
    candidates.push(stored);
    this.slotIndex.set(signature, candidates);
    return structuredClone(exact);
  }

  identitySearch(query) {
    const normalized = normalizeQuery(query);
    const slots = typedSlots(normalized);
    const identityDigest = canonicalIdentityDigest(normalized);
    const identity = this.memory.symbol(`exact-identity:${identityDigest}`);
    const recovered = this.memory.unbindMany(
      this.identityWorldVector,
      slotKeys(this.memory, slots)
    );
    const presenceScore = this.memory.dot(recovered, identity);
    const candidates = this.slotIndex.get(slotSignature(slots)) || [];
    const matches = candidates
      .filter((candidate) => candidate.identityDigest === identityDigest)
      .map(exactEntry);
    return {
      arm: "unitary-fft-exact-identity",
      identityDigest,
      presenceScore,
      present: presenceScore >= this.identityThreshold,
      scanned: candidates.length,
      matches
    };
  }

  retrieve(query, { limit = 5 } = {}) {
    const semantic = this.semanticWorld.hologramSearch(query, { limit });
    const identity = this.identitySearch(query);
    const authorizedMatches = identity.present
      ? identity.matches.filter(({ receiptStatus, verifiedBy, evidenceRefs }) =>
          receiptStatus === "verified" &&
          typeof verifiedBy === "string" && verifiedBy.length > 0 &&
          Array.isArray(evidenceRefs) && evidenceRefs.length > 0
        )
      : [];
    return {
      semantic,
      identity,
      authorized: authorizedMatches.length > 0,
      authorizedMatches
    };
  }

  snapshot() {
    const semantic = this.semanticWorld.snapshot();
    const exactEntries = this.entries.map(exactEntry);
    const state = {
      schema: DUAL_CHANNEL_HOLOGRAPHIC_WORLD_SCHEMA,
      version: 1,
      dimension: this.memory.dimension,
      identityThreshold: this.identityThreshold,
      boardDigest: semantic.boardDigest,
      semanticRepresentationDigest: semantic.representationDigest,
      identityRepresentationDigest: digestResearchValue(this.identityWorldVector),
      identityWorldProjected: false,
      exactEntriesRemainAuthoritative: true,
      semanticAuthority: false,
      entries: exactEntries
    };
    return { ...state, digest: digestResearchValue(state) };
  }
}

function normalizeQuery({
  kind,
  text,
  phase = "recorded",
  polarity = "positive",
  receiptStatus = "verified"
}) {
  return {
    kind: requiredId(kind, "query.kind"),
    text: requiredText(text, "query.text"),
    phase: requiredId(phase, "query.phase"),
    polarity: requiredId(polarity, "query.polarity"),
    receiptStatus: requiredId(receiptStatus, "query.receiptStatus")
  };
}

function typedSlots(entry) {
  return {
    phase: entry.phase,
    kind: entry.kind,
    polarity: entry.polarity,
    receiptStatus: entry.receiptStatus
  };
}

function canonicalIdentityDigest(entry) {
  return digestResearchValue({
    kind: entry.kind,
    text: entry.text,
    phase: entry.phase,
    polarity: entry.polarity,
    receiptStatus: entry.receiptStatus
  });
}

function slotKeys(memory, slots) {
  return Object.entries(slots).map(([slot, value]) =>
    memory.symbol(`slot:${slot}:${value}`)
  );
}

function slotSignature(slots) {
  return Object.entries(slots).map(([slot, value]) => `${slot}=${value}`).join("|");
}

function exactEntry({ slots: _slots, identity: _identity, identityDigest: _digest, ...entry }) {
  return structuredClone(entry);
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
}

export const dualChannelHolographicWorldInternals = Object.freeze({
  canonicalIdentityDigest,
  slotSignature
});
