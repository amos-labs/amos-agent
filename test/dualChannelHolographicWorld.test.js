import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DualChannelHolographicWorld } from
  "../src/research/dualChannelHolographicWorld.js";
import {
  runDualChannelHolographicExperiment,
  validateDualChannelExperimentContract
} from "../src/research/dualChannelHolographicExperiment.js";
import { UnitaryHolographicMemory } from "../src/research/holographicWorldV2.js";
import {
  buildDualChannelActive,
  buildDualChannelShadow,
  rankHarborHolographicBids
} from "../scripts/rankHolographicSwarmBids.js";

const contractUrl = new URL(
  "../benchmarks/swarm-holographic-world-dual-channel-experiment-v1.json",
  import.meta.url
);

test("semantic similarity cannot become exact identity authority", () => {
  const memory = new UnitaryHolographicMemory({ dimension: 1024, namespace: "dual-test" });
  const world = new DualChannelHolographicWorld({ memory, identityThreshold: 0.5 });
  const entry = fixture(1);
  world.observe(entry);
  world.observe(fixture(2));

  const exact = world.retrieve(query(entry));
  const wrongPhase = world.retrieve({ ...query(entry), phase: "proposed" });
  const paraphrase = world.retrieve({
    ...query(entry),
    text: "verified fact record for entity 1 in region 1 group 1"
  });

  assert.equal(exact.authorized, true);
  assert.equal(exact.identity.matches[0].id, entry.id);
  assert.equal(wrongPhase.authorized, false);
  assert.equal(wrongPhase.identity.matches.length, 0);
  assert.equal(paraphrase.authorized, false);
  assert.ok(paraphrase.semantic.results.some(({ id }) => id === entry.id));
});

test("dual-channel snapshots expose digests and exact state but no vectors", () => {
  const world = new DualChannelHolographicWorld({
    memory: new UnitaryHolographicMemory({ dimension: 256, namespace: "snapshot-test" })
  });
  world.observe(fixture(1));
  const snapshot = world.snapshot();

  assert.equal(snapshot.identityWorldProjected, false);
  assert.equal(snapshot.exactEntriesRemainAuthoritative, true);
  assert.equal(snapshot.semanticAuthority, false);
  assert.equal(snapshot.entries[0].id, "entry-1");
  assert.equal("identityWorldVector" in snapshot, false);
  assert.match(snapshot.identityRepresentationDigest, /^[a-f0-9]{64}$/);
});

test("the frozen dual-channel contract executes only the isolated treatment", async () => {
  const contract = validateDualChannelExperimentContract(
    JSON.parse(await readFile(contractUrl, "utf8"))
  );
  const small = structuredClone(contract);
  small.fixture.sizes = [10];
  small.fixture.dimensions = [256];
  small.fixture.evaluationLimit = 10;
  small.promotionGate.fixtureSize = 10;
  small.promotionGate.dimension = 256;
  small.promotionGate.minimumExactPositiveRate = 0;
  small.promotionGate.maximumExactFalsePositiveRate = 1;
  small.promotionGate.maximumPerFamilyFalsePositiveRate = 1;
  small.promotionGate.minimumSemanticParaphraseTop5Rate = 0;
  small.promotionGate.maximumAuthorityLeakRate = 1;
  small.promotionGate.minimumCleanupScanReduction = 0;

  const result = runDualChannelHolographicExperiment(small);

  assert.equal(result.rows.length, 1);
  assert.equal(result.isolation.harbor, false);
  assert.equal(result.isolation.qwen, false);
  assert.equal(result.gate.passed, true);
});

test("Harbor shadow telemetry cannot change bids or grant authority", () => {
  const input = {
    dimension: 128,
    namespace: "harbor-shadow-test",
    cycle: 1,
    claimCost: 1,
    agents: [{
      id: "builder",
      identity: "Build exact artifacts",
      skills: ["solver engineering"],
      experiences: [],
      energy: 5,
      initialEnergy: 5,
      reputation: 0.5,
      activeTaskId: null
    }],
    tasks: [{
      id: "solver-builder",
      objective: "Construct the production plan",
      requirements: [],
      tags: ["solver-engineering"]
    }],
    worldEntries: [fixture(1)]
  };

  const control = rankHarborHolographicBids(input, { shadowEnabled: false });
  const treatment = rankHarborHolographicBids(input, { shadowEnabled: true });

  assert.deepEqual(treatment.bids, control.bids);
  assert.equal(treatment.dualChannelShadow.mode, "read-only-shadow");
  assert.equal(treatment.dualChannelShadow.authorityEnabled, false);
  assert.equal(treatment.dualChannelShadow.behaviorInfluence, false);
  assert.equal(treatment.dualChannelShadow.authorityLeakRate, 0);
  assert.equal(treatment.dualChannelShadow.exactPositiveRate, 1);
});

test("standalone shadow observations carry only compact candidate IDs", () => {
  const shadow = buildDualChannelShadow({
    namespace: "compact-shadow-test",
    tasks: [{ id: "task-1", objective: "Find the verified fact" }],
    worldEntries: [fixture(1), fixture(2)]
  });

  assert.equal(shadow.semanticTaskObservations.length, 1);
  assert.ok(Array.isArray(shadow.semanticTaskObservations[0].proposedEntryIds));
  assert.equal("results" in shadow.semanticTaskObservations[0], false);
  assert.match(shadow.representationDigest, /^[a-f0-9]{64}$/);
});

test("active dual-channel HRR changes bounded routing but never grants authority", () => {
  const input = {
    dimension: 128,
    namespace: "harbor-active-test",
    dualChannelMode: "active",
    cycle: 2,
    claimCost: 1,
    policy: { "bid.affinityWeight": 1 },
    agents: [
      {
        id: "builder",
        identity: "Deliver-first solver engineer",
        skills: ["solver engineering", "python programming"],
        experiences: [],
        energy: 5,
        initialEnergy: 5,
        reputation: 0.5,
        activeTaskId: null
      },
      {
        id: "scout",
        identity: "Environmental interface scout",
        skills: ["interface discovery"],
        experiences: [],
        energy: 5,
        initialEnergy: 5,
        reputation: 0.5,
        activeTaskId: null
      }
    ],
    tasks: [{
      id: "solver-builder",
      objective: "Finish and execute the Python solver",
      requirements: ["Write candidate status and self-check"],
      tags: ["solver-engineering", "python-programming"]
    }],
    worldEntries: [
      {
        ...fixture(1),
        id: "construction-action-1",
        kind: "required-action",
        text: "Finish and execute solver.py, then write candidate status and self-check."
      },
      {
        ...fixture(2),
        id: "construction-state-1",
        kind: "construction-state",
        text: "The host observed a partial Python solver but no execution receipt."
      }
    ]
  };
  const control = rankHarborHolographicBids(
    { ...input, dualChannelMode: "shadow" },
    { shadowEnabled: false }
  );
  const treatment = rankHarborHolographicBids(input);

  assert.equal(treatment.dualChannelWorld.mode, "bounded-active-retrieval");
  assert.equal(treatment.dualChannelWorld.behaviorInfluence, true);
  assert.equal(treatment.dualChannelWorld.authorityEnabled, false);
  assert.equal(treatment.dualChannelWorld.authorityLeakRate, 0);
  assert.ok(treatment.bids.every(({ worldAuthorityGranted }) => worldAuthorityGranted === false));
  assert.ok(treatment.bids.every(({ worldContext }) =>
    worldContext.every(({ authorityGranted }) => authorityGranted === false)
  ));
  assert.notDeepEqual(treatment.bids, control.bids);
  assert.ok(treatment.bids.some(({ baseAffinity, affinity }) => baseAffinity !== affinity));

  const direct = buildDualChannelActive(input, control.bids);
  assert.equal(direct.dualChannelWorld.retrievals[0].exactDictionaryResolved, true);
});

function fixture(index) {
  return {
    id: `entry-${index}`,
    kind: "fact",
    text: `entity ${index} operating signal fact cohort ${index} region ${index} exact record token ${index}`,
    phase: "recorded",
    polarity: "positive",
    receiptStatus: "verified",
    evidenceRefs: [`receipt-${index}`],
    verifiedBy: "amos-host-test"
  };
}

function query({ kind, text, phase, polarity, receiptStatus }) {
  return { kind, text, phase, polarity, receiptStatus };
}
