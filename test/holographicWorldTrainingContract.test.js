import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the learned shared-world contract preserves host authority and causal ablations", async () => {
  const contract = JSON.parse(await readFile(
    new URL("../benchmarks/swarm-holographic-world-training-v1.json", import.meta.url),
    "utf8"
  ));

  assert.equal(contract.schema, "amos.holographic-world-training");
  assert.equal(contract.version, 1);
  assert.equal(contract.authority.authoritativeState, "host-verified-evidence-board");
  assert.equal(contract.authority.vectorIsAuthority, false);
  assert.equal(contract.authority.onlyHostReceiptedEventsMayUpdateWorld, true);
  assert.equal(contract.authority.modelProposalsMayUpdateWorld, false);
  assert.equal(contract.substrate.weightsFrozen, true);
  assert.equal(contract.baseline.qualityClaimAllowed, false);
  assert.deepEqual(contract.learnedRepresentation.dimensionCandidates, [512, 1024, 2048]);
  assert.equal(contract.learnedRepresentation.binding, "fft-circular-convolution");
  assert.equal(contract.ablation.arms.length, 4);
  assert.equal(contract.ablation.matchedQwenDigest, true);
  assert.equal(contract.ablation.matchedOrganismPolicyDigest, true);
  assert.equal(contract.promotion.automaticallyPromotes, false);
  assert.equal(contract.factorialFollowup.arms.length, 4);
  assert.equal(contract.data.forbidden.includes(
    "private-data-authorized-only-for-organism-policy-simulation"
  ), true);
});
