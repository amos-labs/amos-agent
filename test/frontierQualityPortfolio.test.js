import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  frontierQualityPortfolioDigest,
  validateFrontierQualityPortfolio
} from "../src/research/frontierQualityPortfolio.js";

const portfolioUrl = new URL(
  "../benchmarks/frontier-quality-portfolio-v1.json",
  import.meta.url
);
const hardPilotUrl = new URL(
  "../benchmarks/terminal-bench-quality-pilot-v1.json",
  import.meta.url
);
const holographicPilotUrl = new URL(
  "../benchmarks/terminal-bench-holographic-swarm-v1.json",
  import.meta.url
);
const organismTrainingUrl = new URL(
  "../benchmarks/swarm-organism-policy-training-v1.json",
  import.meta.url
);
const adapterTrainingUrl = new URL(
  "../benchmarks/swarm-qwen-adapter-training-v1.json",
  import.meta.url
);

test("the frontier quality portfolio makes Opus 5 the blind best-quality control", async () => {
  const portfolio = validateFrontierQualityPortfolio(
    JSON.parse(await readFile(portfolioUrl, "utf8"))
  );
  assert.equal(portfolio.promotion.frontierControlId, "opus-control");
  assert.equal(portfolio.promotion.primaryRegimeId, "best-quality");
  assert.deepEqual(portfolio.promotion.matchedRegimeIds, []);
  assert.equal(portfolio.promotion.maximumSignificantTrackLosses, 0);
  assert.equal(portfolio.promotion.requireBlindJudging, true);
  assert.equal(
    portfolio.tracks.filter((track) => track.countsTowardFrontierWin).length,
    8
  );
  assert.match(frontierQualityPortfolioDigest(portfolio), /^[a-f0-9]{64}$/);
});

test("the portfolio rejects a frontier claim without a time-separated control", async () => {
  const portfolio = JSON.parse(await readFile(portfolioUrl, "utf8"));
  for (const track of portfolio.tracks) track.source.timeSeparated = false;
  assert.throws(
    () => validateFrontierQualityPortfolio(portfolio),
    /time-separated contamination control/
  );
});

test("the portfolio cannot freeze before every required adapter is ready", async () => {
  const portfolio = JSON.parse(await readFile(portfolioUrl, "utf8"));
  portfolio.status = "frozen";
  assert.throws(
    () => validateFrontierQualityPortfolio(portfolio),
    /planned required tracks/
  );
});

test("the first hard pilot makes verified quality primary and defers easier controls", async () => {
  const pilot = JSON.parse(await readFile(hardPilotUrl, "utf8"));
  assert.equal(pilot.dataset.version, "3.0.0");
  assert.equal(pilot.dataset.task, "terminal-bench/production-planning");
  assert.equal(pilot.comparison.primaryRegime, "best-quality");
  assert.equal(pilot.comparison.matchedComputeRequired, false);
  assert.equal(pilot.comparison.minimumAttemptsPerControl, 3);
  assert.equal(pilot.agent.proactiveSummarizationThreshold, 0);
  assert.equal(pilot.candidate.scaffold, "amos-task-swarm-v2");
  assert.equal(pilot.candidate.inferenceRoute, "direct-vllm");
  assert.equal(
    pilot.candidate.harborAgent,
    "benchmarks.harbor_agents.amos_task_swarm:AmosTaskSwarm"
  );
  assert.equal(pilot.candidate.verifiedReceiptGate, true);
  assert.deepEqual(pilot.candidate.specialists.slice(0, 3), [
    "interface-scanner",
    "data-scanner",
    "state-compiler"
  ]);
  assert.ok(
    Object.values(pilot.candidate.phaseMaxTurns).every((turns) => turns <= 10)
  );
  assert.equal(pilot.candidate.maxConstructionCycles, 3);
  assert.deepEqual(pilot.developmentControls.map((control) => control.id), [
    "qwen-turn-swarm"
  ]);
  assert.deepEqual(pilot.deferredControls.map((control) => control.id), [
    "fable-control",
    "sol-5.6-control"
  ]);
});

test("the original holographic swarm remains distinct from the fixed task control", async () => {
  const pilot = JSON.parse(await readFile(holographicPilotUrl, "utf8"));
  assert.equal(pilot.candidate.coordination, "stigmergic-contract-net");
  assert.equal(pilot.candidate.routerAuthority, "dependency-and-governance-only");
  assert.equal(pilot.candidate.sharedBackbone, true);
  assert.equal(pilot.candidate.tokenEconomics, false);
  assert.equal(pilot.candidate.emotionalVector, false);
  assert.equal(pilot.candidate.officialVerifierModified, false);
  assert.equal(pilot.control.scaffold, "amos-task-swarm-v2");
  assert.equal(pilot.promotion.minimumValidRuns, 3);
});

test("the organism training pilot freezes Qwen and contamination-partitions public development data", async () => {
  const plan = JSON.parse(await readFile(organismTrainingUrl, "utf8"));
  assert.equal(plan.substrate.weightsFrozen, true);
  assert.equal(plan.substrate.parallelLoraTrackAllowed, true);
  assert.ok(plan.data.allowed.includes(
    "rights-cleared-public-development-trajectories-with-evaluation-exclusions"
  ));
  assert.ok(plan.data.forbidden.includes(
    "public-benchmark-tasks-reused-for-evaluation-after-training"
  ));
  assert.equal(plan.reward.primary, "independent-verifier-pass-rate");
  assert.ok(plan.reward.hardZero.includes("receipt-forgery"));
  assert.equal(plan.promotion.requireThreeSeedReplication, true);
  assert.equal(plan.promotion.deployment, "canary-only");
});

test("parallel Qwen adapter training preserves organism attribution and data rights", async () => {
  const plan = JSON.parse(await readFile(adapterTrainingUrl, "utf8"));
  assert.equal(plan.base.trainingMethod, "qlora");
  assert.equal(plan.base.inferenceEndpointMutable, false);
  assert.equal(plan.target.type, "system-competence");
  assert.equal(plan.target.preserveGeneralReasoning, true);
  assert.ok(
    plan.target.teach.includes("proposal-versus-host-authority-boundary")
  );
  assert.ok(plan.target.doNotTeach.includes(
    "sealed-or-evaluation-held-public-benchmark-solutions"
  ));
  assert.equal(plan.experiment.design, "two-by-two-factorial");
  assert.deepEqual(plan.experiment.arms.map((arm) => arm.id), [
    "base-direct",
    "base-swarm",
    "adapter-direct",
    "adapter-swarm"
  ]);
  assert.ok(plan.data.allowed.includes(
    "rights-cleared-public-development-trajectories-with-evaluation-exclusions"
  ));
  assert.ok(plan.data.forbidden.includes(
    "public-benchmark-tasks-reused-for-evaluation-after-training"
  ));
  assert.equal(plan.data.requireEpisodePermissionTrainingApproved, true);
  assert.equal(plan.adapters.trainOnHiddenReasoning, false);
  assert.equal(plan.curriculum.includeSuccessFailureCorrectionTriples, true);
  assert.equal(plan.curriculum.holdOutUnseenToolsAndSchemaRevisions, true);
  assert.equal(plan.training.parallelToOrganismPolicySearch, true);
  assert.equal(plan.promotion.primary, "independent-verifier-pass-rate");
  assert.equal(plan.promotion.latencyIsPromotionGate, false);
});
