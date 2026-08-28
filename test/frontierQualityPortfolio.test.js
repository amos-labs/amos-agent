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
  assert.deepEqual(pilot.deferredControls.map((control) => control.id), [
    "fable-control",
    "sol-5.6-control"
  ]);
});
