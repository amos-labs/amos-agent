export const EXPERT_TRACE_SCHEMA = "amos.expert-routing-trace";
export const EXPERT_TRACE_VERSION = 1;
export const EXPERT_CACHE_POLICIES = Object.freeze(["lru", "lfu", "slru", "tinylfu"]);

const MAX_TRACE_LINES = 2_000_000;
const PHASES = new Set(["prefill", "decode"]);
const METADATA_KEYS = new Set([
  "type",
  "schema",
  "version",
  "model",
  "layers",
  "experts_per_layer",
  "active_experts",
  "expert_bytes",
  "weight_store_bytes",
  "shared_resident_bytes",
  "source_revision",
  "created_at"
]);
const TOKEN_KEYS = new Set([
  "type",
  "trace_id",
  "token_index",
  "phase",
  "workflow",
  "experts"
]);

export function parseExpertTrace(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("Expert trace is empty");
  if (lines.length > MAX_TRACE_LINES) {
    throw new Error(`Expert trace exceeds ${MAX_TRACE_LINES} records`);
  }

  const records = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Expert trace line ${index + 1} is not valid JSON: ${error.message}`);
    }
  });
  const metadata = normalizeMetadata(records[0]);
  const tokens = records.slice(1).map((record, index) =>
    normalizeToken(record, metadata, index + 2)
  );
  if (tokens.length === 0) throw new Error("Expert trace contains no token records");
  return { metadata, tokens };
}

export function simulateExpertCache(
  trace,
  {
    policy = "lru",
    slotsPerLayer = 32
  } = {}
) {
  const metadata = normalizeNormalizedMetadata(trace?.metadata);
  const tokens = Array.isArray(trace?.tokens) ? trace.tokens : [];
  const normalizedPolicy = normalizePolicy(policy);
  const slots = boundedInteger(slotsPerLayer, 1, metadata.expertsPerLayer, "slotsPerLayer");
  const caches = Array.from(
    { length: metadata.layers },
    () => createCache(normalizedPolicy, slots, metadata.activeExperts)
  );
  const totals = emptyCounter();
  const byPhase = {
    prefill: emptyCounter(),
    decode: emptyCounter()
  };
  const byWorkflow = new Map();
  const coldBytesPerToken = [];
  const coldRangesPerToken = [];
  const reuseTokenDistances = [];
  const lastSeenToken = new Map();

  for (let tokenOrdinal = 0; tokenOrdinal < tokens.length; tokenOrdinal += 1) {
    const token = tokens[tokenOrdinal];
    const normalizedToken = normalizeNormalizedToken(token, metadata);
    const phaseCounter = byPhase[normalizedToken.phase];
    const workflowCounter = byWorkflow.get(normalizedToken.workflow) || emptyCounter();
    let tokenMisses = 0;
    const missesByLayer = Array.from({ length: metadata.layers }, () => []);

    for (let layer = 0; layer < metadata.layers; layer += 1) {
      for (const expertId of normalizedToken.experts[layer]) {
        const reuseKey = `${layer}:${expertId}`;
        const lastSeen = lastSeenToken.get(reuseKey);
        if (lastSeen !== undefined) reuseTokenDistances.push(tokenOrdinal - lastSeen);
        lastSeenToken.set(reuseKey, tokenOrdinal);
        const hit = caches[layer].access(expertId);
        incrementCounter(totals, hit);
        incrementCounter(phaseCounter, hit);
        incrementCounter(workflowCounter, hit);
        if (!hit) {
          tokenMisses += 1;
          missesByLayer[layer].push(expertId);
        }
      }
    }
    byWorkflow.set(normalizedToken.workflow, workflowCounter);
    coldBytesPerToken.push(tokenMisses * metadata.expertBytes);
    coldRangesPerToken.push(
      missesByLayer.reduce((sum, ids) => sum + contiguousRangeCount(ids), 0)
    );
  }

  return {
    model: metadata.model,
    policy: normalizedPolicy,
    slotsPerLayer: slots,
    layers: metadata.layers,
    expertsPerLayer: metadata.expertsPerLayer,
    activeExperts: metadata.activeExperts,
    tokenCount: tokens.length,
    cacheFootprintBytes: slots * metadata.layers * metadata.expertBytes,
    estimatedResidentBytes:
      metadata.sharedResidentBytes + slots * metadata.layers * metadata.expertBytes,
    ...finishCounter(totals),
    coldBytes: totals.misses * metadata.expertBytes,
    coldBytesPerToken: {
      mean: average(coldBytesPerToken),
      p50: percentile(coldBytesPerToken, 0.50),
      p95: percentile(coldBytesPerToken, 0.95),
      p99: percentile(coldBytesPerToken, 0.99),
      maximum: Math.max(...coldBytesPerToken, 0)
    },
    coldRangesPerToken: {
      mean: average(coldRangesPerToken),
      p95: percentile(coldRangesPerToken, 0.95),
      maximum: Math.max(...coldRangesPerToken, 0)
    },
    reuseTokenDistance: {
      observations: reuseTokenDistances.length,
      mean: average(reuseTokenDistances),
      p50: percentile(reuseTokenDistances, 0.50),
      p95: percentile(reuseTokenDistances, 0.95),
      maximum: Math.max(...reuseTokenDistances, 0)
    },
    phases: Object.fromEntries(
      Object.entries(byPhase).map(([name, counter]) => [name, finishCounter(counter)])
    ),
    workflows: Object.fromEntries(
      [...byWorkflow.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, counter]) => [name, finishCounter(counter)])
    )
  };
}

export function sweepExpertCache(
  trace,
  {
    policies = EXPERT_CACHE_POLICIES,
    slots = [4, 8, 16, 32, 64, 96],
    budgetsBytes = []
  } = {}
) {
  const budgetConfigurations = budgetsBytes.map((requestedBudgetBytes) => ({
    slotsPerLayer: slotsForBudget(trace.metadata, requestedBudgetBytes),
    requestedBudgetBytes
  }));
  const budgetSlots = new Set(
    budgetConfigurations
      .filter((configuration) => configuration.slotsPerLayer > 0)
      .map((configuration) => configuration.slotsPerLayer)
  );
  const configurations = [
    ...slots
      .filter((slotsPerLayer) => !budgetSlots.has(slotsPerLayer))
      .map((slotsPerLayer) => ({ slotsPerLayer, requestedBudgetBytes: null })),
    ...budgetConfigurations
  ];
  const results = [];
  for (const policy of policies) {
    for (const configuration of configurations) {
      if (
        configuration.slotsPerLayer < 1 ||
        configuration.slotsPerLayer > trace.metadata.expertsPerLayer
      ) {
        continue;
      }
      results.push({
        ...simulateExpertCache(trace, {
          policy,
          slotsPerLayer: configuration.slotsPerLayer
        }),
        requestedBudgetBytes: configuration.requestedBudgetBytes
      });
    }
  }
  return results.sort((left, right) =>
    right.hitRate - left.hitRate ||
    left.coldBytesPerToken.p95 - right.coldBytesPerToken.p95 ||
    left.cacheFootprintBytes - right.cacheFootprintBytes ||
    left.policy.localeCompare(right.policy)
  );
}

export function slotsForBudget(metadata, totalBudgetBytes) {
  const normalized = normalizeNormalizedMetadata(metadata);
  const budget = boundedInteger(
    totalBudgetBytes,
    1,
    Number.MAX_SAFE_INTEGER,
    "totalBudgetBytes"
  );
  const available = budget - normalized.sharedResidentBytes;
  if (available < normalized.layers * normalized.expertBytes) return 0;
  return Math.min(
    normalized.expertsPerLayer,
    Math.floor(available / (normalized.layers * normalized.expertBytes))
  );
}

function normalizeMetadata(record) {
  requireObject(record, "Expert trace metadata");
  assertAllowedKeys(record, METADATA_KEYS, "Expert trace metadata");
  if (record.type !== "metadata") throw new Error("Expert trace must begin with metadata");
  if (record.schema !== EXPERT_TRACE_SCHEMA) {
    throw new Error(`Unsupported expert trace schema: ${record.schema || "missing"}`);
  }
  if (record.version !== EXPERT_TRACE_VERSION) {
    throw new Error(`Unsupported expert trace version: ${record.version}`);
  }
  const metadata = {
    schema: record.schema,
    version: record.version,
    model: boundedText(record.model, "model", 240),
    layers: boundedInteger(record.layers, 1, 256, "layers"),
    expertsPerLayer: boundedInteger(
      record.experts_per_layer,
      2,
      4_096,
      "experts_per_layer"
    ),
    activeExperts: boundedInteger(record.active_experts, 1, 256, "active_experts"),
    expertBytes: boundedInteger(
      record.expert_bytes,
      1,
      Number.MAX_SAFE_INTEGER,
      "expert_bytes"
    ),
    weightStoreBytes: optionalInteger(record.weight_store_bytes),
    sharedResidentBytes: nonNegativeInteger(record.shared_resident_bytes),
    sourceRevision: optionalText(record.source_revision, 240),
    createdAt: optionalText(record.created_at, 80)
  };
  if (metadata.activeExperts > metadata.expertsPerLayer) {
    throw new Error("active_experts cannot exceed experts_per_layer");
  }
  return metadata;
}

function normalizeToken(record, metadata, lineNumber) {
  requireObject(record, `Expert trace line ${lineNumber}`);
  assertAllowedKeys(record, TOKEN_KEYS, `Expert trace line ${lineNumber}`);
  if (record.type !== "token") {
    throw new Error(`Expert trace line ${lineNumber} must have type token`);
  }
  if (!PHASES.has(record.phase)) {
    throw new Error(`Expert trace line ${lineNumber} has an invalid phase`);
  }
  if (!Array.isArray(record.experts) || record.experts.length !== metadata.layers) {
    throw new Error(
      `Expert trace line ${lineNumber} must contain ${metadata.layers} expert layers`
    );
  }
  const experts = record.experts.map((selected, layer) => {
    if (!Array.isArray(selected) || selected.length !== metadata.activeExperts) {
      throw new Error(
        `Expert trace line ${lineNumber}, layer ${layer} must select ` +
        `${metadata.activeExperts} experts`
      );
    }
    const ids = selected.map((value) =>
      boundedInteger(value, 0, metadata.expertsPerLayer - 1, `expert at layer ${layer}`)
    );
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Expert trace line ${lineNumber}, layer ${layer} repeats an expert`);
    }
    return ids;
  });
  const normalized = {
    traceId: boundedText(record.trace_id, "trace_id", 160),
    tokenIndex: boundedInteger(record.token_index, 0, Number.MAX_SAFE_INTEGER, "token_index"),
    phase: record.phase,
    workflow: boundedText(record.workflow || "unspecified", "workflow", 120),
    experts
  };
  return normalized;
}

function normalizeNormalizedMetadata(metadata) {
  requireObject(metadata, "Expert trace metadata");
  const normalized = {
    schema: EXPERT_TRACE_SCHEMA,
    version: EXPERT_TRACE_VERSION,
    model: boundedText(metadata.model, "model", 240),
    layers: boundedInteger(metadata.layers, 1, 256, "layers"),
    expertsPerLayer: boundedInteger(
      metadata.expertsPerLayer,
      2,
      4_096,
      "expertsPerLayer"
    ),
    activeExperts: boundedInteger(metadata.activeExperts, 1, 256, "activeExperts"),
    expertBytes: boundedInteger(
      metadata.expertBytes,
      1,
      Number.MAX_SAFE_INTEGER,
      "expertBytes"
    ),
    weightStoreBytes: optionalInteger(metadata.weightStoreBytes),
    sharedResidentBytes: nonNegativeInteger(metadata.sharedResidentBytes)
  };
  if (normalized.activeExperts > normalized.expertsPerLayer) {
    throw new Error("activeExperts cannot exceed expertsPerLayer");
  }
  return normalized;
}

function normalizeNormalizedToken(token, metadata) {
  requireObject(token, "Expert token");
  if (!PHASES.has(token.phase)) throw new Error("Expert token has an invalid phase");
  if (!Array.isArray(token.experts) || token.experts.length !== metadata.layers) {
    throw new Error(`Expert token must contain ${metadata.layers} expert layers`);
  }
  const experts = token.experts.map((selected, layer) => {
    if (!Array.isArray(selected) || selected.length !== metadata.activeExperts) {
      throw new Error(`Each layer must select ${metadata.activeExperts} experts`);
    }
    const ids = selected.map((value) =>
      boundedInteger(value, 0, metadata.expertsPerLayer - 1, `expert at layer ${layer}`)
    );
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Expert token layer ${layer} repeats an expert`);
    }
    return ids;
  });
  return {
    phase: token.phase,
    workflow: boundedText(token.workflow || "unspecified", "workflow", 120),
    experts
  };
}

function normalizePolicy(value) {
  const policy = String(value || "").trim().toLowerCase();
  if (!EXPERT_CACHE_POLICIES.includes(policy)) {
    throw new Error(`Unknown ExpertCache policy: ${value}`);
  }
  return policy;
}

function createCache(policy, capacity, activeExperts) {
  if (policy === "lru") return new LruCache(capacity);
  if (policy === "lfu") return new LfuCache(capacity);
  if (policy === "slru") return new SlruCache(capacity, activeExperts);
  return new TinyLfuCache(capacity);
}

class LruCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = new Map();
  }

  access(id) {
    if (this.items.has(id)) {
      touch(this.items, id);
      return true;
    }
    evictOldest(this.items, this.capacity);
    this.items.set(id, true);
    return false;
  }
}

class LfuCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = new Map();
    this.tick = 0;
  }

  access(id) {
    this.tick += 1;
    const current = this.items.get(id);
    if (current) {
      current.frequency += 1;
      current.lastUsed = this.tick;
      return true;
    }
    if (this.items.size >= this.capacity) {
      let victim = null;
      for (const [candidateId, candidate] of this.items) {
        if (
          !victim ||
          candidate.frequency < victim.value.frequency ||
          (
            candidate.frequency === victim.value.frequency &&
            candidate.lastUsed < victim.value.lastUsed
          )
        ) {
          victim = { id: candidateId, value: candidate };
        }
      }
      this.items.delete(victim.id);
    }
    this.items.set(id, { frequency: 1, lastUsed: this.tick });
    return false;
  }
}

class SlruCache {
  constructor(capacity, activeExperts) {
    this.fallback = capacity < activeExperts * 2 ? new LruCache(capacity) : null;
    this.protectedCapacity = Math.max(activeExperts, Math.floor(capacity * 0.5));
    this.probationCapacity = Math.max(1, capacity - this.protectedCapacity);
    this.protected = new Map();
    this.probation = new Map();
  }

  access(id) {
    if (this.fallback) return this.fallback.access(id);
    if (this.protected.has(id)) {
      touch(this.protected, id);
      return true;
    }
    if (this.probation.has(id)) {
      this.probation.delete(id);
      if (this.protected.size >= this.protectedCapacity) {
        const demoted = oldestKey(this.protected);
        this.protected.delete(demoted);
        evictOldest(this.probation, this.probationCapacity);
        this.probation.set(demoted, true);
      }
      this.protected.set(id, true);
      return true;
    }
    evictOldest(this.probation, this.probationCapacity);
    this.probation.set(id, true);
    return false;
  }
}

class TinyLfuCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = new Map();
    this.frequencies = new Map();
  }

  access(id) {
    const frequency = (this.frequencies.get(id) || 0) + 1;
    this.frequencies.set(id, frequency);
    if (this.items.has(id)) {
      touch(this.items, id);
      return true;
    }
    if (this.items.size < this.capacity) {
      this.items.set(id, true);
      return false;
    }
    const victim = oldestKey(this.items);
    const victimFrequency = this.frequencies.get(victim) || 0;
    if (frequency > victimFrequency) {
      this.items.delete(victim);
      this.items.set(id, true);
    }
    return false;
  }
}

function touch(map, key) {
  const value = map.get(key);
  map.delete(key);
  map.set(key, value);
}

function evictOldest(map, capacity) {
  if (map.size < capacity) return;
  map.delete(oldestKey(map));
}

function oldestKey(map) {
  return map.keys().next().value;
}

function emptyCounter() {
  return { accesses: 0, hits: 0, misses: 0 };
}

function incrementCounter(counter, hit) {
  counter.accesses += 1;
  if (hit) counter.hits += 1;
  else counter.misses += 1;
}

function finishCounter(counter) {
  return {
    ...counter,
    hitRate: counter.accesses > 0 ? counter.hits / counter.accesses : 0
  };
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

function contiguousRangeCount(values) {
  const ids = [...new Set(values)].sort((left, right) => left - right);
  if (ids.length === 0) return 0;
  let ranges = 1;
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index] !== ids[index - 1] + 1) ranges += 1;
  }
  return ranges;
}

function assertAllowedKeys(value, allowed, label) {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new Error(
      `${label} contains unsupported field ${unexpected}; traces must not contain payload data`
    );
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return number;
}

function boundedText(value, label, maximum) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) {
    throw new Error(`${label} must contain 1 through ${maximum} characters`);
  }
  return text;
}

function optionalText(value, maximum) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > maximum) throw new Error(`Optional text exceeds ${maximum} characters`);
  return text;
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, "optional integer");
}

function nonNegativeInteger(value) {
  if (value === undefined || value === null || value === "") return 0;
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, "non-negative integer");
}
