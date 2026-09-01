import { createHash } from "node:crypto";
import { digestResearchValue } from "./experimentProtocol.js";

export const HOLOGRAPHIC_WORLD_V2_SCHEMA = "amos.holographic-world-v2";
export const HOLOGRAPHIC_WORLD_V2_VERSION = 1;

const FILLER_MODES = new Set(["unitary", "l2", "raw"]);

/**
 * Experimental real-valued HRR kernel using frequency-unitary atomic codes.
 *
 * This kernel is intentionally isolated from the live swarm runtime. Exact
 * entries remain authoritative; vectors are only lossy retrieval surfaces.
 */
export class UnitaryHolographicMemory {
  constructor({ dimension = 256, namespace = "amos-hrr-v2" } = {}) {
    this.dimension = powerOfTwo(dimension, 16, 4_096, "dimension");
    this.namespace = requiredText(namespace, "namespace", 256);
    this.symbolCache = new Map();
    this.encodingCache = new Map();
  }

  symbol(value) {
    const symbol = requiredText(value, "symbol", 10_000);
    const cached = this.symbolCache.get(symbol);
    if (cached) return [...cached];
    const projected = this.projectUnitary(deterministicBipolar({
      dimension: this.dimension,
      namespace: this.namespace,
      symbol
    }));
    this.symbolCache.set(symbol, projected);
    return [...projected];
  }

  encode(text, { mode = "unitary" } = {}) {
    const normalizedMode = enumValue(mode, FILLER_MODES, "filler mode");
    const source = requiredText(text, "text", 500_000);
    const cacheKey = `${normalizedMode}\0${source}`;
    const cached = this.encodingCache.get(cacheKey);
    if (cached) return [...cached];
    const tokens = tokenize(source);
    const tokenVectors = (tokens.length > 0 ? tokens : ["empty"])
      .map((token) => this.symbol(`token:${token}`));
    const superposition = sumVectors(tokenVectors, this.dimension);
    const encoded = normalizedMode === "unitary"
      ? this.projectUnitary(superposition)
      : normalizedMode === "l2"
        ? normalizeVector(superposition, this.dimension)
        : superposition;
    this.encodingCache.set(cacheKey, encoded);
    return [...encoded];
  }

  projectUnitary(vector) {
    const spectrum = fftReal(validVector(vector, this.dimension, "projection vector"));
    for (let index = 0; index < this.dimension; index += 1) {
      const magnitude = Math.hypot(spectrum.real[index], spectrum.imag[index]);
      if (magnitude <= 1e-12) {
        spectrum.real[index] = 1;
        spectrum.imag[index] = 0;
      } else {
        spectrum.real[index] /= magnitude;
        spectrum.imag[index] /= magnitude;
      }
    }
    return ifftReal(spectrum);
  }

  bind(left, right) {
    return this.bindMany([left, right]);
  }

  bindMany(vectors) {
    if (!Array.isArray(vectors) || vectors.length === 0) {
      throw new Error("HRR binding requires at least one vector");
    }
    const product = {
      real: new Array(this.dimension).fill(1),
      imag: new Array(this.dimension).fill(0)
    };
    for (const [vectorIndex, vector] of vectors.entries()) {
      const spectrum = fftReal(validVector(
        vector,
        this.dimension,
        `binding vector ${vectorIndex}`
      ));
      multiplySpectraInPlace(product, spectrum);
    }
    return ifftReal(product);
  }

  unbind(bound, key) {
    return this.unbindMany(bound, [key]);
  }

  unbindMany(bound, keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error("HRR unbinding requires at least one key");
    }
    const spectrum = fftReal(validVector(bound, this.dimension, "bound vector"));
    for (const [keyIndex, key] of keys.entries()) {
      const keySpectrum = fftReal(validVector(
        key,
        this.dimension,
        `unbinding key ${keyIndex}`
      ));
      for (let index = 0; index < this.dimension; index += 1) {
        keySpectrum.imag[index] *= -1;
      }
      multiplySpectraInPlace(spectrum, keySpectrum);
    }
    return ifftReal(spectrum);
  }

  superpose(vectors) {
    return sumVectors(vectors, this.dimension);
  }

  dot(left, right) {
    const a = validVector(left, this.dimension, "left");
    const b = validVector(right, this.dimension, "right");
    return a.reduce((sum, value, index) => sum + (value * b[index]), 0);
  }

  similarity(left, right) {
    const a = normalizeVector(left, this.dimension);
    const b = normalizeVector(right, this.dimension);
    return this.dot(a, b);
  }

  maximumUnitaryError(vector) {
    const spectrum = fftReal(validVector(vector, this.dimension, "unitary vector"));
    return spectrum.real.reduce((maximum, real, index) => Math.max(
      maximum,
      Math.abs(Math.hypot(real, spectrum.imag[index]) - 1)
    ), 0);
  }
}

/**
 * Dual-arm development memory:
 * - itemSearch scans exact per-entry bindings;
 * - hologramSearch unbinds one shared W, then resolves through the exact
 *   dictionary restricted by the typed slot signature.
 *
 * W is a raw sum of bindings and is never projected back onto the unit torus.
 */
export class HolographicWorldV2 {
  constructor({
    memory = new UnitaryHolographicMemory(),
    fillerMode = "unitary",
    boardDigest = null
  } = {}) {
    if (!(memory instanceof UnitaryHolographicMemory)) {
      throw new Error("HolographicWorldV2 requires UnitaryHolographicMemory");
    }
    this.memory = memory;
    this.fillerMode = enumValue(fillerMode, FILLER_MODES, "filler mode");
    this.boardDigest = optionalSha256(boardDigest, "boardDigest");
    this.entries = [];
    this.worldVector = new Array(memory.dimension).fill(0);
    this.slotIndex = new Map();
  }

  observe({
    id,
    kind,
    text,
    phase = "recorded",
    polarity = "positive",
    receiptStatus = "verified",
    evidenceRefs = [],
    verifiedBy
  }) {
    const exact = {
      id: requiredId(id, "entry.id"),
      kind: requiredId(kind, "entry.kind"),
      text: requiredText(text, "entry.text", 100_000),
      phase: requiredId(phase, "entry.phase"),
      polarity: requiredId(polarity, "entry.polarity"),
      receiptStatus: requiredId(receiptStatus, "entry.receiptStatus"),
      evidenceRefs: uniqueIds(evidenceRefs, "entry.evidenceRefs", 1_000),
      verifiedBy: requiredId(verifiedBy, "entry.verifiedBy")
    };
    if (this.entries.some(({ id: existingId }) => existingId === exact.id)) {
      throw new Error(`Duplicate holographic world entry ${exact.id}`);
    }
    const slots = entrySlots(exact);
    const keys = slotKeys(this.memory, slots);
    const filler = this.memory.encode(exact.text, { mode: this.fillerMode });
    const binding = this.memory.bindMany([...keys, filler]);
    const stored = { ...exact, slots, filler, binding };
    this.entries.push(stored);
    for (let index = 0; index < this.memory.dimension; index += 1) {
      this.worldVector[index] += binding[index];
    }
    const signature = slotSignature(slots);
    const group = this.slotIndex.get(signature) || [];
    group.push(stored);
    this.slotIndex.set(signature, group);
    return structuredClone(exact);
  }

  itemSearch(query, { limit = 5 } = {}) {
    const normalized = normalizeQuery(query);
    const filler = this.memory.encode(normalized.text, { mode: this.fillerMode });
    const binding = this.memory.bindMany([
      ...slotKeys(this.memory, entrySlots(normalized)),
      filler
    ]);
    return {
      arm: "unitary-fft-item-memory",
      scanned: this.entries.length,
      results: rankEntries(
        this.entries,
        ({ binding: candidate }) => this.memory.similarity(binding, candidate),
        limit
      )
    };
  }

  hologramSearch(query, { limit = 5 } = {}) {
    const normalized = normalizeQuery(query);
    const slots = entrySlots(normalized);
    const keys = slotKeys(this.memory, slots);
    const filler = this.memory.encode(normalized.text, { mode: this.fillerMode });
    const recovered = this.memory.unbindMany(this.worldVector, keys);
    const normalizedFiller = normalizeVector(filler, this.memory.dimension);
    const presenceScore = this.memory.dot(recovered, normalizedFiller);
    const candidates = this.slotIndex.get(slotSignature(slots)) || [];
    return {
      arm: "unitary-fft-true-hologram",
      presenceScore,
      scanned: candidates.length,
      // Unbinding the typed keys recovers the superposition of every value in
      // that bucket. The exact query filler performs cleanup against the
      // authoritative dictionary; W contributes presence, never authority.
      results: rankEntries(
        candidates,
        ({ filler: candidate }) => this.memory.similarity(filler, candidate),
        limit
      )
    };
  }

  snapshot() {
    const exactEntries = this.entries.map(({ slots: _slots, filler: _filler, binding: _binding, ...entry }) =>
      structuredClone(entry)
    );
    const state = {
      schema: HOLOGRAPHIC_WORLD_V2_SCHEMA,
      version: HOLOGRAPHIC_WORLD_V2_VERSION,
      encoder: "deterministic-hrr-v2-unitary-fft",
      boardDigest: this.boardDigest,
      dimension: this.memory.dimension,
      namespace: this.memory.namespace,
      fillerMode: this.fillerMode,
      readOnly: true,
      updatedBy: "amos-host",
      worldProjected: false,
      retrievalArms: ["unitary-fft-item-memory", "unitary-fft-true-hologram"],
      entries: exactEntries,
      itemDictionary: exactEntries.map(({ id, kind, phase, polarity, receiptStatus, evidenceRefs }) => ({
        id,
        kind,
        phase,
        polarity,
        receiptStatus,
        evidenceRefs
      })),
      representationDigest: digestResearchValue(this.worldVector)
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
    text: requiredText(text, "query.text", 100_000),
    phase: requiredId(phase, "query.phase"),
    polarity: requiredId(polarity, "query.polarity"),
    receiptStatus: requiredId(receiptStatus, "query.receiptStatus")
  };
}

function entrySlots(entry) {
  return {
    phase: entry.phase,
    kind: entry.kind,
    polarity: entry.polarity,
    receiptStatus: entry.receiptStatus
  };
}

function slotKeys(memory, slots) {
  return Object.entries(slots).map(([slot, value]) =>
    memory.symbol(`slot:${slot}:${value}`)
  );
}

function slotSignature(slots) {
  return Object.entries(slots)
    .map(([slot, value]) => `${slot}=${value}`)
    .join("|");
}

function rankEntries(entries, score, limit) {
  const maximum = boundedInteger(limit, 1, 100, "limit");
  return entries
    .map((stored) => {
      const { slots: _slots, filler: _filler, binding: _binding, ...entry } = stored;
      return {
        ...structuredClone(entry),
        similarity: score(stored)
      };
    })
    .sort((left, right) =>
      right.similarity - left.similarity || left.id.localeCompare(right.id)
    )
    .slice(0, maximum);
}

function deterministicBipolar({ dimension, namespace, symbol }) {
  const vector = new Array(dimension);
  let block = Buffer.alloc(0);
  let blockIndex = 0;
  for (let index = 0; index < dimension; index += 1) {
    if (index % 256 === 0) {
      block = createHash("sha256")
        .update(`${namespace}\0${symbol}\0${blockIndex}`)
        .digest();
      blockIndex += 1;
    }
    const bitIndex = index % 256;
    const byte = block[Math.floor(bitIndex / 8)];
    vector[index] = ((byte >> (bitIndex % 8)) & 1) === 1 ? 1 : -1;
  }
  return normalizeVector(vector, dimension);
}

function fftReal(vector) {
  return fft({ real: [...vector], imag: new Array(vector.length).fill(0) }, false);
}

function ifftReal(spectrum) {
  const result = fft({ real: [...spectrum.real], imag: [...spectrum.imag] }, true);
  return result.real.map((value) => Math.abs(value) < 1e-14 ? 0 : value);
}

function fft(input, inverse) {
  const size = input.real.length;
  if (input.imag.length !== size || (size & (size - 1)) !== 0) {
    throw new Error("FFT input must have matching power-of-two dimensions");
  }
  const real = input.real;
  const imag = input.imag;
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imag[index], imag[reversed]] = [imag[reversed], imag[index]];
    }
  }
  for (let width = 2; width <= size; width <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / width;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let weightReal = 1;
      let weightImag = 0;
      for (let offset = 0; offset < width / 2; offset += 1) {
        const even = start + offset;
        const odd = even + (width / 2);
        const oddReal = (real[odd] * weightReal) - (imag[odd] * weightImag);
        const oddImag = (real[odd] * weightImag) + (imag[odd] * weightReal);
        const evenReal = real[even];
        const evenImag = imag[even];
        real[even] = evenReal + oddReal;
        imag[even] = evenImag + oddImag;
        real[odd] = evenReal - oddReal;
        imag[odd] = evenImag - oddImag;
        const nextWeightReal = (weightReal * stepReal) - (weightImag * stepImag);
        weightImag = (weightReal * stepImag) + (weightImag * stepReal);
        weightReal = nextWeightReal;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imag[index] /= size;
    }
  }
  return { real, imag };
}

function multiplySpectraInPlace(target, factor) {
  for (let index = 0; index < target.real.length; index += 1) {
    const real = (target.real[index] * factor.real[index]) -
      (target.imag[index] * factor.imag[index]);
    const imag = (target.real[index] * factor.imag[index]) +
      (target.imag[index] * factor.real[index]);
    target.real[index] = real;
    target.imag[index] = imag;
  }
}

function sumVectors(vectors, dimension) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new Error("HRR superposition requires at least one vector");
  }
  const result = new Array(dimension).fill(0);
  for (const [vectorIndex, vector] of vectors.entries()) {
    const valid = validVector(vector, dimension, `superposition vector ${vectorIndex}`);
    for (let index = 0; index < dimension; index += 1) result[index] += valid[index];
  }
  return result;
}

function normalizeVector(vector, dimension) {
  const valid = validVector(vector, dimension, "vector");
  const magnitude = Math.sqrt(valid.reduce((sum, value) => sum + (value * value), 0));
  if (magnitude === 0) return new Array(dimension).fill(0);
  return valid.map((value) => value / magnitude);
}

function validVector(vector, dimension, label) {
  if (!Array.isArray(vector) || vector.length !== dimension) {
    throw new Error(`${label} must contain exactly ${dimension} dimensions`);
  }
  return vector.map((value) => {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite value`);
    return value;
  });
}

function tokenize(text) {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) || [])];
}

function powerOfTwo(value, minimum, maximum, label) {
  const parsed = boundedInteger(value, minimum, maximum, label);
  if ((parsed & (parsed - 1)) !== 0) throw new Error(`${label} must be a power of two`);
  return parsed;
}

function requiredText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function requiredId(value, label) {
  const id = requiredText(value, label, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
}

function uniqueIds(values, label, maximum) {
  if (!Array.isArray(values) || values.length > maximum) {
    throw new Error(`${label} must be an array with no more than ${maximum} entries`);
  }
  return [...new Set(values.map((value, index) => requiredId(value, `${label}[${index}]`)))];
}

function optionalSha256(value, label) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`${label} is unsupported`);
  return value;
}

export const holographicWorldV2Internals = Object.freeze({
  fft,
  normalizeVector,
  slotSignature
});
