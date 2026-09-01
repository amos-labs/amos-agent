import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HolographicWorldV2,
  UnitaryHolographicMemory
} from "../src/research/holographicWorldV2.js";
import {
  runHolographicWorldV2Experiment,
  validateExperimentContract
} from "../src/research/holographicWorldV2Experiment.js";

const contractUrl = new URL(
  "../benchmarks/swarm-holographic-world-v2-experiment-v1.json",
  import.meta.url
);

test("frequency-unitary codes support exact multi-key unbinding", () => {
  const memory = new UnitaryHolographicMemory({ dimension: 256, namespace: "unit-test" });
  const phase = memory.symbol("slot:phase:recorded");
  const kind = memory.symbol("slot:kind:fact");
  const filler = memory.encode("customer 41 has a verified invoice", { mode: "unitary" });
  const bound = memory.bindMany([phase, kind, filler]);
  const recovered = memory.unbindMany(bound, [phase, kind]);

  assert.ok(memory.maximumUnitaryError(phase) < 1e-9);
  assert.ok(memory.maximumUnitaryError(kind) < 1e-9);
  assert.ok(memory.maximumUnitaryError(filler) < 1e-9);
  assert.ok(memory.similarity(filler, recovered) > 0.999999999);
});

test("the shared W remains a raw sum while exact entries stay authoritative", () => {
  const memory = new UnitaryHolographicMemory({ dimension: 256, namespace: "world-test" });
  const world = new HolographicWorldV2({ memory });
  world.observe(fixture(1, { kind: "fact" }));
  world.observe(fixture(2, { kind: "requirement" }));

  const snapshot = world.snapshot();
  assert.equal(snapshot.worldProjected, false);
  assert.equal(snapshot.entries.length, 2);
  assert.equal(snapshot.entries[0].text, fixture(1).text);
  assert.equal("worldVector" in snapshot, false);
  assert.equal("vector" in snapshot, false);
  assert.match(snapshot.representationDigest, /^[a-f0-9]{64}$/);
  assert.ok(memory.maximumUnitaryError(world.worldVector) > 0.1);
});

test("item and true-hologram arms recover exact typed entries", () => {
  const memory = new UnitaryHolographicMemory({ dimension: 512, namespace: "retrieval-test" });
  const world = new HolographicWorldV2({ memory });
  const entries = [
    fixture(1, { kind: "fact", phase: "recorded", polarity: "positive" }),
    fixture(2, { kind: "fact", phase: "recorded", polarity: "positive" }),
    fixture(3, { kind: "fact", phase: "proposed", polarity: "positive" }),
    fixture(4, { kind: "fact", phase: "recorded", polarity: "negative" })
  ];
  for (const entry of entries) world.observe(entry);
  const query = typedQuery(entries[1]);

  const item = world.itemSearch(query);
  const hologram = world.hologramSearch(query);
  const wrongPhase = world.hologramSearch({ ...query, phase: "superseded" });

  assert.equal(item.results[0].id, entries[1].id);
  assert.equal(hologram.results[0].id, entries[1].id);
  assert.ok(hologram.presenceScore > 0.5);
  assert.ok(wrongPhase.presenceScore < 0.5);
  assert.equal(item.scanned, 4);
  assert.equal(hologram.scanned, 2);
});

test("the frozen development contract runs without touching live systems", async () => {
  const contract = validateExperimentContract(
    JSON.parse(await readFile(contractUrl, "utf8"))
  );
  const small = structuredClone(contract);
  small.fixture.sizes = [10];
  small.promotionGate.fixtureSize = 10;
  small.promotionGate.minimumExactTop1Rate = 0;
  small.promotionGate.minimumExactTop5Rate = 0;
  small.promotionGate.minimumPositiveNegativeGap = -10;
  small.promotionGate.maximumHardNegativeFalsePositiveRate = 1;
  small.promotionGate.maximumPerFamilyFalsePositiveRate = 1;
  small.promotionGate.minimumCleanupScanReduction = 0;

  const result = runHolographicWorldV2Experiment(small);

  assert.equal(result.rows.length, 3);
  assert.equal(result.isolation.harbor, false);
  assert.equal(result.isolation.qwen, false);
  assert.equal(result.gate.passed, true);
  assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/);
});

function fixture(index, overrides = {}) {
  return {
    id: `entry-${index}`,
    kind: "fact",
    text: `entity ${index} exact record token ${index}`,
    phase: "recorded",
    polarity: "positive",
    receiptStatus: "verified",
    evidenceRefs: [`receipt-${index}`],
    verifiedBy: "amos-host-test",
    ...overrides
  };
}

function typedQuery({ kind, text, phase, polarity, receiptStatus }) {
  return { kind, text, phase, polarity, receiptStatus };
}
